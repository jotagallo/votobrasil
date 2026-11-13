import { LOCALES, type Locale } from '@votobr/shared';
import { withLocale } from './lib/routes';

const OG_LOCALES: Record<Locale, string> = { 'pt-BR': 'pt_BR', en: 'en_US', es: 'es_ES' };
const HTML_LANG: Record<Locale, string> = { 'pt-BR': 'pt-BR', en: 'en', es: 'es' };

export interface Alternate {
  hreflang: string;
  href: string;
}

export function siteOrigin(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Versões do mesmo caminho em cada idioma (mais `x-default` apontando para pt-BR). */
export function buildAlternates(origin: string, path: string): Alternate[] {
  const alternates = LOCALES.map((locale) => ({
    hreflang: HTML_LANG[locale],
    href: `${origin}${withLocale(locale, path)}`,
  }));
  return [...alternates, { hreflang: 'x-default', href: `${origin}${withLocale('pt-BR', path)}` }];
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function replaceLinks(selector: string, links: Array<Record<string, string>>): void {
  document.head.querySelectorAll(selector).forEach((el) => el.remove());
  for (const attrs of links) {
    const el = document.createElement('link');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.dataset.seo = 'true';
    document.head.appendChild(el);
  }
}

export interface PageMeta {
  locale: Locale;
  title: string;
  description: string;
  /** Caminho sem prefixo de idioma, p.ex. `/sistemas`. */
  path: string;
  noindex?: boolean;
}

export function applyPageMeta(meta: PageMeta): void {
  const origin = siteOrigin();
  const url = `${origin}${withLocale(meta.locale, meta.path)}`;

  document.title = meta.title;
  document.documentElement.lang = HTML_LANG[meta.locale];

  upsertMeta('name', 'description', meta.description);
  upsertMeta('name', 'robots', meta.noindex ? 'noindex, follow' : 'index, follow');
  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:site_name', 'VotoBrasil');
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:locale', OG_LOCALES[meta.locale]);
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);

  document.head
    .querySelectorAll('meta[property="og:locale:alternate"]')
    .forEach((el) => el.remove());
  for (const locale of LOCALES) {
    if (locale === meta.locale) continue;
    const el = document.createElement('meta');
    el.setAttribute('property', 'og:locale:alternate');
    el.setAttribute('content', OG_LOCALES[locale]);
    document.head.appendChild(el);
  }

  replaceLinks('link[rel="canonical"]', [{ rel: 'canonical', href: url }]);
  replaceLinks(
    'link[rel="alternate"][hreflang]',
    buildAlternates(origin, meta.path).map((a) => ({
      rel: 'alternate',
      hreflang: a.hreflang,
      href: a.href,
    })),
  );
}
