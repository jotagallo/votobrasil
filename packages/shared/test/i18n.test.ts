import { describe, expect, it } from 'vitest';
import { flattenKeys, MESSAGES, translate, translateList, type MessageNode } from '../src/i18n.js';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../src/types.js';

function lookup(root: MessageNode, key: string): MessageNode | undefined {
  let node: MessageNode | undefined = root;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return node;
}

function textOf(node: MessageNode | undefined): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.join('\n\n');
  return '';
}

function placeholders(text: string): string[] {
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
}

const baseKeys = flattenKeys(MESSAGES[DEFAULT_LOCALE]).sort();

describe('locales', () => {
  it('tem exatamente os três idiomas esperados', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it('pt-BR tem conteúdo (não é placeholder)', () => {
    expect(baseKeys.length).toBeGreaterThan(300);
  });

  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    it(`${locale} tem exatamente o mesmo conjunto de chaves que ${DEFAULT_LOCALE}`, () => {
      const keys = flattenKeys(MESSAGES[locale]).sort();
      expect(keys.filter((k) => !baseKeys.includes(k))).toEqual([]);
      expect(baseKeys.filter((k) => !keys.includes(k))).toEqual([]);
    });
  }

  for (const locale of LOCALES) {
    it(`${locale}: nenhum valor vazio`, () => {
      const empty = flattenKeys(MESSAGES[locale]).filter((key) => {
        const node = lookup(MESSAGES[locale], key);
        if (Array.isArray(node)) return node.length === 0 || node.some((s) => s.trim() === '');
        return typeof node !== 'string' || node.trim() === '';
      });
      expect(empty).toEqual([]);
    });
  }

  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    it(`${locale}: placeholders {param} e formato (lista × texto) coincidem com ${DEFAULT_LOCALE}`, () => {
      const placeholderDiffs: string[] = [];
      const shapeDiffs: string[] = [];
      for (const key of baseKeys) {
        const base = lookup(MESSAGES[DEFAULT_LOCALE], key);
        const other = lookup(MESSAGES[locale], key);
        if (Array.isArray(base) !== Array.isArray(other)) shapeDiffs.push(key);
        if (Array.isArray(base) && Array.isArray(other) && base.length !== other.length) {
          shapeDiffs.push(key);
        }
        const a = placeholders(textOf(base));
        const b = placeholders(textOf(other));
        if (a.join() !== b.join()) placeholderDiffs.push(`${key}: ${a.join()} ≠ ${b.join()}`);
      }
      expect(shapeDiffs).toEqual([]);
      expect(placeholderDiffs).toEqual([]);
    });
  }

  it('links internos e externos em Markdown leve aparecem igualmente em todos os idiomas', () => {
    const linkTargets = (text: string) =>
      [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]).sort();
    const diffs: string[] = [];
    for (const key of baseKeys) {
      const base = linkTargets(textOf(lookup(MESSAGES[DEFAULT_LOCALE], key))).join();
      for (const locale of LOCALES) {
        if (linkTargets(textOf(lookup(MESSAGES[locale], key))).join() !== base) {
          diffs.push(`${locale}:${key}`);
        }
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe('translate', () => {
  it('interpola parâmetros e preserva placeholders ausentes', () => {
    expect(translate('en', 'chamber.others', { count: 3 })).toBe('Others (3)');
    expect(translate('es', 'chamber.others', { count: 3 })).toBe('Otros (3)');
    expect(translate('pt-BR', 'chamber.changed', { count: 5 })).toContain('{total}');
  });

  it('devolve a chave quando ela não existe', () => {
    expect(translate('en', 'nao.existe')).toBe('nao.existe');
  });

  it('translateList devolve listas e [] para chaves inexistentes', () => {
    const list = translateList('es', 'systems.intro');
    expect(list.length).toBeGreaterThan(1);
    expect(translateList('en', 'nao.existe')).toEqual([]);
  });

  it('cada idioma traduz de fato (textos diferentes do pt-BR)', () => {
    const sample = ['home.title', 'systems.title', 'methodology.title'];
    for (const locale of ['en', 'es'] as Locale[]) {
      for (const key of sample) {
        expect(translate(locale, key)).not.toBe(translate('pt-BR', key));
      }
    }
  });
});
