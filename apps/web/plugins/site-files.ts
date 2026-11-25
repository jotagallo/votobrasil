import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { isOffice } from '../src/lib/routes.ts';
import { buildRobots, buildSitemap, sitePaths, type AreaRef } from '../src/lib/sitemap.ts';

const SITE_TOKEN = '__SITE_URL__';

/** Áreas simuláveis, lidas do `meta.json` do ETL quando ele existe (o CI compila sem dados). */
function readAreas(root: string): AreaRef[] {
  const file = path.resolve(root, '../../data/processed/meta.json');
  if (!existsSync(file)) return [];
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8')) as {
      offices?: Record<string, { areas?: Array<{ code?: string }> }>;
    };
    return Object.entries(meta.offices ?? {}).flatMap(([office, info]) =>
      isOffice(office)
        ? (info.areas ?? []).flatMap((a) => (a.code ? [{ office, code: a.code }] : []))
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Troca `__SITE_URL__` no `index.html` pela origem pública (`VITE_SITE_URL`, sem barra final) e
 * gera `robots.txt` e `sitemap.xml` no build. Sem a origem não há como montar URLs absolutas: o
 * `robots.txt` sai sem a linha `Sitemap` e o `sitemap.xml` não é gerado.
 */
export function siteFiles(): Plugin {
  let origin = '';
  let root = '';
  return {
    name: 'votobr:site-files',
    configResolved(config) {
      origin = String(config.env.VITE_SITE_URL ?? '')
        .trim()
        .replace(/\/+$/, '');
      root = config.root;
    },
    transformIndexHtml: (html) => html.replaceAll(SITE_TOKEN, origin),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: buildRobots(origin) });
      if (!origin) return;
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemap(origin, sitePaths(readAreas(root))),
      });
    },
  };
}
