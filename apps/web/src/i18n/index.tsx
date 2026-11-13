import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, translate, translateList, type Locale } from '@votobr/shared';
import { createFormatters, type Formatters } from '../lib/format';

export const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export interface Translator {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Parágrafos/itens (valores array nos arquivos de tradução). */
  tl: (key: string) => string[];
  f: Formatters;
}

export function useT(): Translator {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      tl: (key) => translateList(locale, key),
      f: createFormatters(locale),
    }),
    [locale],
  );
}
