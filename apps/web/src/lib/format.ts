import type { Locale } from '@votobr/shared';

const INTL_TAGS: Record<Locale, string> = { 'pt-BR': 'pt-BR', en: 'en-US', es: 'es' };

export const MINUS = '\u2212';

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(INTL_TAGS[locale], options);
    numberFormats.set(key, nf);
  }
  return nf;
}

export function intlTag(locale: Locale): string {
  return INTL_TAGS[locale];
}

/** Inteiro com separador de milhar sempre visível (inclusive em es, que omite em 4 dígitos). */
export function formatInt(value: number, locale: Locale): string {
  return numberFormat(locale, { maximumFractionDigits: 0, useGrouping: 'always' }).format(value);
}

export function formatDecimal(value: number, locale: Locale, digits = 1): string {
  return numberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: 'always',
  }).format(value);
}

/** `pct` já em pontos percentuais (12,3 → "12,3%"). */
export function formatPercent(pct: number, locale: Locale, digits = 1): string {
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(pct / 100);
}

/** Fração de 0 a 1. */
export function formatShare(fraction: number, locale: Locale, digits = 0): string {
  return formatPercent(fraction * 100, locale, digits);
}

/** Diferença com sinal explícito: +12, −5, 0. */
export function formatSigned(value: number, locale: Locale, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return formatDecimal(0, locale, digits);
  const body = formatDecimal(Math.abs(rounded), locale, digits);
  return `${rounded > 0 ? '+' : MINUS}${body}`;
}

export function formatCompact(value: number, locale: Locale): string {
  return numberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_TAGS[locale], {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${formatDecimal(value, locale, unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export interface Formatters {
  int: (value: number) => string;
  dec: (value: number, digits?: number) => string;
  pct: (pct: number, digits?: number) => string;
  share: (fraction: number, digits?: number) => string;
  signed: (value: number, digits?: number) => string;
  compact: (value: number) => string;
  date: (iso: string) => string;
  bytes: (bytes: number) => string;
}

export function createFormatters(locale: Locale): Formatters {
  return {
    int: (v) => formatInt(v, locale),
    dec: (v, d) => formatDecimal(v, locale, d),
    pct: (v, d) => formatPercent(v, locale, d),
    share: (v, d) => formatShare(v, locale, d),
    signed: (v, d) => formatSigned(v, locale, d),
    compact: (v) => formatCompact(v, locale),
    date: (iso) => formatDate(iso, locale),
    bytes: (b) => formatBytes(b, locale),
  };
}
