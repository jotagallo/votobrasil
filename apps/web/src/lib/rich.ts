export type RichNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string; external: boolean };

const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function safeHref(href: string): { href: string; external: boolean } | null {
  if (href.startsWith('/') && !href.startsWith('//')) return { href, external: false };
  if (/^https:\/\//i.test(href) || /^mailto:/i.test(href)) return { href, external: true };
  return null;
}

/**
 * Marcação mínima e segura usada nos textos de tradução: **negrito**, `código` e
 * [rótulo](link). Links internos começam com "/" (recebem o prefixo de idioma).
 */
export function parseRich(text: string): RichNode[] {
  const nodes: RichNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', value: text.slice(last, index) });
    if (match[1] !== undefined) {
      nodes.push({ type: 'strong', value: match[1] });
    } else if (match[2] !== undefined) {
      nodes.push({ type: 'code', value: match[2] });
    } else {
      const target = safeHref(match[4] ?? '');
      if (target) {
        nodes.push({ type: 'link', label: match[3] ?? '', ...target });
      } else {
        nodes.push({ type: 'text', value: match[0] });
      }
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes;
}
