import ptBR from './locales/pt-BR.json';
import en from './locales/en.json';
import es from './locales/es.json';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './types.js';

export type MessageNode = string | string[] | { [key: string]: MessageNode };

export const MESSAGES: Record<Locale, MessageNode> = {
  'pt-BR': ptBR as MessageNode,
  en: en as MessageNode,
  es: es as MessageNode,
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

function lookup(root: MessageNode, key: string): MessageNode | undefined {
  let node: MessageNode | undefined = root;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Traduz uma chave; cai para PT-BR (idioma padrão) e, por fim, devolve a própria chave. */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const node = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key);
  if (typeof node === 'string') return interpolate(node, params);
  if (Array.isArray(node)) return node.join('\n\n');
  return key;
}

/** Lista de parágrafos/itens (valores array nos arquivos de tradução). */
export function translateList(locale: Locale, key: string): string[] {
  const node = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key);
  if (Array.isArray(node)) return node;
  if (typeof node === 'string') return [node];
  return [];
}

export function flattenKeys(node: MessageNode, prefix = ''): string[] {
  if (typeof node === 'string' || Array.isArray(node)) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}
