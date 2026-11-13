import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenKeys, MESSAGES } from '@votobr/shared';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const sources = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => ({ file, text: readFileSync(`${srcDir}/${file}`, 'utf8') }));

const known = new Set(flattenKeys(MESSAGES['pt-BR']));

/** Chaves literais passadas a t()/tl(); chaves montadas dinamicamente ficam de fora. */
const STATIC_KEY = /\b(?:t|tl)\(\s*['"]([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)['"]/g;

describe('chaves de tradução usadas no código', () => {
  it('encontra chamadas estáticas suficientes (guarda contra regex quebrada)', () => {
    const total = sources.reduce((n, s) => n + [...s.text.matchAll(STATIC_KEY)].length, 0);
    expect(total).toBeGreaterThan(100);
  });

  it('toda chave estática existe em pt-BR (e, por paridade, em en e es)', () => {
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const match of text.matchAll(STATIC_KEY)) {
        const key = match[1] as string;
        if (!known.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('nenhum texto de interface está fixo no código das páginas e componentes', () => {
    // Heurística: texto JSX com letras minúsculas acentuadas ou palavras em português entre tags.
    const suspicious: string[] = [];
    const jsxText = />\s*([A-Za-zÀ-ÿ][^<>{}\n]{12,})\s*</g;
    for (const { file, text } of sources) {
      if (!/^(pages|components)\//.test(file)) continue;
      for (const match of text.matchAll(jsxText)) {
        const value = (match[1] as string).trim();
        if (/\s/.test(value)) suspicious.push(`${file}: ${value}`);
      }
    }
    expect(suspicious).toEqual([]);
  });
});
