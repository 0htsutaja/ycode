/**
 * Static export — orchestration.
 *
 * Pulls every published page, drives the per-page resolver, builds HTML
 * documents, bundles referenced assets, and hands the full output set
 * off to every configured writer.
 */

import { randomUUID } from 'crypto'

import { getSettingByKey } from '@/lib/repositories/settingsRepository'
import { getTranslationsByLocale } from '@/lib/repositories/translationRepository'
import { getSupabaseAdmin } from '@/lib/supabase-server'

import type { Locale, Page, PageFolder } from '@/types'

import { collectPublicAssets, collectSupabaseAssets } from './asset-bundler'
import { getExportConfig, saveLastExportJob } from './config'
import { buildDocument, SWIPER_CSS_PATH } from './document'
import {
  buildTranslationsMap,
  resolvePages,
  type LocaleContext,
} from './resolver'
import type { ExportJob } from './types'
import { contentTypeFor, type OutputFile, type Writer } from './writers/types'
import { createGithubWriter } from './writers/github'
import { createLocalWriter } from './writers/local'
import { createS3Writer } from './writers/s3'

export async function exportSite(): Promise<ExportJob> {
  const jobId = randomUUID()
  const job: ExportJob = {
    id: jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    pagesExported: 0,
    filesWritten: 0,
  }

  try {
    const config = await getExportConfig()

    if (config.outputTargets.length === 0) {
      throw new Error('No output target selected — pick at least one of: local, S3, GitHub')
    }

    const client = await getSupabaseAdmin()
    if (!client) throw new Error('Supabase client not configured')

    // ---- Load pages (one query, all published, all routes) --------------
    const { data: pageRows, error: pagesError } = await client
      .from('pages')
      .select('*')
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('depth', { ascending: true })
      .order('order', { ascending: true })

    if (pagesError) throw new Error(`Failed to fetch pages: ${pagesError.message}`)
    const pages = (pageRows ?? []) as Page[]
    if (pages.length === 0) {
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      await saveLastExportJob(job).catch(() => { /* non-fatal */ })
      return job
    }

    // ---- Folders + shared CSS + locales in parallel ----------------------
    const [folderResult, publishedCss, colorVariablesCss, localeResult] = await Promise.all([
      client
        .from('page_folders')
        .select('*')
        .is('deleted_at', null)
        .order('depth', { ascending: true }),
      getSettingByKey('published_css').catch(() => null),
      getSettingByKey('color_variables_css').catch(() => null),
      client
        .from('locales')
        .select('*')
        .eq('is_published', true)
        .is('deleted_at', null),
    ])
    if (folderResult.error) {
      throw new Error(`Failed to fetch folders: ${folderResult.error.message}`)
    }
    const folders = (folderResult.data ?? []) as PageFolder[]
    const locales = (localeResult.data ?? []) as Locale[]

    // The export always covers the default locale, plus one pass per
    // non-default published locale (writing to `<code>/...`).
    const defaultLocale = locales.find((l) => l.is_default) ?? null
    const additionalLocales = locales.filter((l) => !l.is_default)

    if (!publishedCss) {
      console.warn(
        '[Static Export] No published_css found — publish the site once to generate the CSS bundle.',
      )
    }

    // ---- Render every page (default locale + per non-default locale) ----
    const outputs: OutputFile[] = []
    const referencedAssetPaths = new Set<string>()

    const renderPage = async (page: Page, ctx: LocaleContext): Promise<void> => {
      let yieldedAny = false
      try {
        for await (const resolved of resolvePages(page, folders, pages, ctx)) {
          yieldedAny = true
          const html = buildDocument({
            page: resolved.page,
            bodyHtml: resolved.bodyHtml,
            bodyClasses: resolved.bodyClasses,
            publishedCss: publishedCss ?? null,
            colorVariablesCss: colorVariablesCss ?? null,
            includeSwiper: resolved.hasSlider,
            interactions: resolved.interactions,
          })

          // Collect Ycode's built-in placeholder URLs referenced from this
          // page so we can ship them alongside the HTML for fully
          // self-contained hosting.
          for (const match of html.matchAll(/\/ycode\/layouts\/assets\/[^"'\s)]+/g)) {
            referencedAssetPaths.add(match[0])
          }

          // When a page contains a slider, bundle Ycode's minimal Swiper CSS
          // from /public — the export's <link> in <head> points at this path.
          if (resolved.hasSlider) {
            referencedAssetPaths.add(SWIPER_CSS_PATH)
          }

          outputs.push({
            key: resolved.outputKey,
            body: html,
            contentType: contentTypeFor(resolved.outputKey),
          })
          job.pagesExported++
        }
      } catch (err) {
        const label = ctx.locale && !ctx.locale.is_default ? `[${ctx.locale.code}] ` : ''
        console.warn(
          `[Static Export] Failed to resolve ${label}"${page.name}" (${page.id}): ${
            err instanceof Error ? err.message : err
          }`,
        )
        return
      }
      if (!yieldedAny) {
        // Only warn for default-locale gaps; non-default locales legitimately
        // produce no routes for error pages etc.
        if (!ctx.locale || ctx.locale.is_default) {
          console.warn(`[Static Export] Skipping "${page.name}" — no routes produced`)
        }
      }
    }

    {
      const ctx: LocaleContext = { locale: defaultLocale, translations: {} }
      for (const page of pages) {
        await renderPage(page, ctx)
      }
    }

    for (const locale of additionalLocales) {
      const translations = await getTranslationsByLocale(locale.id, true)
      const translationsMap = buildTranslationsMap(translations)
      const ctx: LocaleContext = { locale, translations: translationsMap }
      for (const page of pages) {
        await renderPage(page, ctx)
      }
    }

    // ---- Bundle referenced /public placeholders -------------------------
    if (referencedAssetPaths.size > 0) {
      const assetFiles = await collectPublicAssets(Array.from(referencedAssetPaths))
      outputs.push(...assetFiles)
    }

    // ---- Bundle referenced Supabase-hosted assets -----------------------
    const supabaseAssetFiles = await collectSupabaseAssets(
      outputs.filter((o) => o.key.endsWith('.html')),
    )
    if (supabaseAssetFiles.length > 0) {
      outputs.push(...supabaseAssetFiles)
    }

    // ---- Flush to every configured target -------------------------------
    const writers: Writer[] = []
    for (const target of config.outputTargets) {
      if (target === 'local') writers.push(createLocalWriter(config))
      else if (target === 's3') writers.push(await createS3Writer(config))
      else if (target === 'github') writers.push(await createGithubWriter(config))
    }

    for (const writer of writers) {
      try {
        const count = await writer.flush(outputs)
        job.filesWritten += count
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Writer "${writer.name}" failed: ${message}`)
      }
    }

    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    await saveLastExportJob(job).catch(() => { /* non-fatal */ })
    return job
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown export error'
    console.error(`[Static Export] Export ${jobId} failed:`, message)
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.error = message
    await saveLastExportJob(job).catch(() => { /* non-fatal */ })
    return job
  }
}
