import { DEFAULT_LOCALE, LOCALES, OFFICE_IDS, type Locale, type OfficeId } from '@votobr/shared';

export const PATHS = {
  home: '/',
  systems: '/sistemas',
  methodology: '/metodologia',
  semipresidentialism: '/semipresidencialismo',
  about: '/sobre',
} as const;

export function housePath(office: OfficeId): string {
  return `/casa/${office}`;
}

export function areaPath(office: OfficeId, area: string): string {
  return `/casa/${office}/${encodeURIComponent(area)}`;
}

export function isOffice(value: string | undefined): value is OfficeId {
  return value !== undefined && (OFFICE_IDS as readonly string[]).includes(value);
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') || '/' : withSlash;
}

/** `/en/sistemas` → `{ locale: 'en', path: '/sistemas' }`; sem prefixo é pt-BR. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const normalized = normalizePath(pathname);
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const prefix = `/${locale}`;
    if (normalized === prefix) return { locale, path: '/' };
    if (normalized.startsWith(`${prefix}/`))
      return { locale, path: normalized.slice(prefix.length) };
  }
  return { locale: DEFAULT_LOCALE, path: normalized };
}

export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

/** Caminho absoluto (sem origem) de `path` no idioma `locale`. */
export function withLocale(locale: Locale, path: string): string {
  const prefix = localePrefix(locale);
  const normalized = normalizePath(path);
  if (!prefix) return normalized;
  return normalized === '/' ? prefix : `${prefix}${normalized}`;
}
