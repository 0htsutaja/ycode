/**
 * Shared import pipeline entry point.
 *
 * Source adapters (Webflow, Figma) produce an `ImportDocument`; this runs the
 * common steps — install fonts, convert IR → layers, recover components — and
 * returns the resulting layers plus a summary for the UI. Insertion is left to
 * the caller so both importers share the host's single insertion path.
 */

import { ImportMaterializer } from '@/lib/import/materializer';
import { ImportConverter } from '@/lib/import/convert';
import { componentizeLayers } from '@/lib/import/componentize';
import { useFontsStore } from '@/stores/useFontsStore';
import type { Layer } from '@/types';
import type { ImportDocument, ImportSummary } from '@/lib/import/types';

function countLayers(layers: { children?: unknown[] }[]): number {
  let total = 0;
  const walk = (list: { children?: unknown[] }[]) => {
    for (const layer of list) {
      total += 1;
      if (Array.isArray(layer.children)) walk(layer.children as { children?: unknown[] }[]);
    }
  };
  walk(layers);
  return total;
}

function countCollections(layers: Array<{ variables?: { collection?: unknown }; children?: unknown[] }>): number {
  let total = 0;
  const walk = (list: Array<{ variables?: { collection?: unknown }; children?: unknown[] }>) => {
    for (const layer of list) {
      if (layer.variables?.collection) total += 1;
      if (Array.isArray(layer.children)) walk(layer.children as typeof list);
    }
  };
  walk(layers);
  return total;
}

export interface ImportResult {
  layers: Layer[];
  summary: ImportSummary;
}

/**
 * Run the shared pipeline and return the built layers + summary. The caller is
 * responsible for inserting `layers` onto the canvas (so Webflow and Figma both
 * flow through the host's one robust insertion path).
 */
export async function buildImport(document: ImportDocument): Promise<ImportResult> {
  const mat = new ImportMaterializer(document.source);

  // Install referenced fonts up front (best-effort; needs the catalog loaded).
  if (document.fonts && document.fonts.length > 0) {
    await useFontsStore.getState().loadGoogleFontsCatalog();
    await Promise.all(document.fonts.map((f) => mat.installFont(f.family)));
  }

  const converter = new ImportConverter(mat);
  let layers = await converter.convertNodes(document.roots);
  layers = await componentizeLayers(layers, mat);

  return {
    layers,
    summary: {
      layers: countLayers(layers),
      styles: mat.counts.styles,
      components: mat.counts.components,
      assets: mat.counts.assets,
      fonts: mat.counts.fonts,
      collections: countCollections(layers),
    },
  };
}

export type { ImportDocument, ImportSummary } from '@/lib/import/types';
export type { Layer } from '@/types';
