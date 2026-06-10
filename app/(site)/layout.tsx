import '@/app/site.css';
import type { Metadata } from 'next';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';

export async function generateMetadata(): Promise<Metadata> {
  if (process.env.SKIP_SETUP === 'true') {
    return defaultMetadata;
  }

  try {
    const globalSettings = await fetchGlobalPageSettings();
    const metadata: Metadata = { ...defaultMetadata };

    if (globalSettings.faviconUrl || globalSettings.webClipUrl) {
      metadata.icons = {};
      if (globalSettings.faviconUrl) {
        metadata.icons.icon = globalSettings.faviconUrl;
      }
      if (globalSettings.webClipUrl) {
        metadata.icons.apple = globalSettings.webClipUrl;
      }
    }

    return metadata;
  } catch {
    return defaultMetadata;
  }
}

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let headElements: React.ReactNode[] = [];

  // Cloud mode uses ISR with explicit tenantId — calling headers() here
  // would force all pages dynamic. Cloud injects global head code from PageRenderer instead.
  if (process.env.SKIP_SETUP !== 'true') {
    try {
      const globalSettings = await fetchGlobalPageSettings();
      if (globalSettings.globalCustomCodeHead) {
        headElements = renderRootLayoutHeadCode(globalSettings.globalCustomCodeHead);
      }
    } catch {
      // Supabase not configured — skip custom code
    }
  }

  // Published sites render text with the browser-default (`auto`) font
  // smoothing — matching legacy output. Forcing `antialiased` here would render
  // glyphs thinner/lighter than the original site.
  return (
    <RootLayoutShell headElements={headElements} bodyClassName="font-sans">
      {children}
    </RootLayoutShell>
  );
}
