import { LOCALES, OFFICE_IDS, type OfficeId } from '@votobr/shared';
import { buildAlternates } from '../seo';
import { PATHS, areaPath, housePath, withLocale } from './routes';

export interface AreaRef {
  office: OfficeId;
  code: string;
}

/** Caminhos indexáveis (sem prefixo de idioma): páginas fixas, casas e, se houver dados, as áreas. */
export function sitePaths(areas: AreaRef[] = []): string[] {
  return [
    PATHS.home,
    PATHS.systems,
    PATHS.methodology,
    PATHS.semipresidentialism,
    PATHS.about,
    ...OFFICE_IDS.map(housePath),
    ...areas.map((area) => areaPath(area.office, area.code)),
  ];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Sitemap com uma entrada por idioma, cada uma listando todas as versões (hreflang). */
export function buildSitemap(origin: string, paths: string[]): string {
  const entries = paths.flatMap((path) => {
    const links = buildAlternates(origin, path)
      .map(
        (a) =>
          `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeXml(a.href)}"/>`,
      )
      .join('\n');
    return LOCALES.map(
      (locale) =>
        `  <url>\n    <loc>${escapeXml(`${origin}${withLocale(locale, path)}`)}</loc>\n${links}\n  </url>`,
    );
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

/** `robots.txt`; a linha `Sitemap` exige URL absoluta, então só existe com a origem do site. */
export function buildRobots(origin: string): string {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/'];
  if (origin) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}
