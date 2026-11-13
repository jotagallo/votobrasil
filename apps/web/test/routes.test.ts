import { describe, expect, it } from 'vitest';
import {
  areaPath,
  housePath,
  isOffice,
  localePrefix,
  PATHS,
  splitLocale,
  withLocale,
} from '../src/lib/routes';

describe('splitLocale', () => {
  it('sem prefixo é pt-BR', () => {
    expect(splitLocale('/')).toEqual({ locale: 'pt-BR', path: '/' });
    expect(splitLocale('/sistemas')).toEqual({ locale: 'pt-BR', path: '/sistemas' });
    expect(splitLocale('')).toEqual({ locale: 'pt-BR', path: '/' });
  });

  it('reconhece /en e /es, com ou sem subcaminho', () => {
    expect(splitLocale('/en')).toEqual({ locale: 'en', path: '/' });
    expect(splitLocale('/en/')).toEqual({ locale: 'en', path: '/' });
    expect(splitLocale('/es/sistemas')).toEqual({ locale: 'es', path: '/sistemas' });
    expect(splitLocale('/en/casa/federal/SP')).toEqual({ locale: 'en', path: '/casa/federal/SP' });
  });

  it('não confunde caminhos que apenas começam com as letras do idioma', () => {
    expect(splitLocale('/entrada')).toEqual({ locale: 'pt-BR', path: '/entrada' });
    expect(splitLocale('/esquerda/x')).toEqual({ locale: 'pt-BR', path: '/esquerda/x' });
  });

  it('remove barras finais', () => {
    expect(splitLocale('/sobre/')).toEqual({ locale: 'pt-BR', path: '/sobre' });
  });
});

describe('withLocale / localePrefix', () => {
  it('pt-BR não tem prefixo; en e es têm', () => {
    expect(localePrefix('pt-BR')).toBe('');
    expect(localePrefix('en')).toBe('/en');
    expect(withLocale('pt-BR', '/sistemas')).toBe('/sistemas');
    expect(withLocale('en', '/sistemas')).toBe('/en/sistemas');
    expect(withLocale('es', '/')).toBe('/es');
    expect(withLocale('pt-BR', '/')).toBe('/');
  });

  it('é o inverso de splitLocale', () => {
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      for (const path of ['/', PATHS.systems, '/casa/state/SP']) {
        expect(splitLocale(withLocale(locale, path))).toEqual({ locale, path });
      }
    }
  });
});

describe('caminhos de casas e áreas', () => {
  it('monta caminhos e escapa o identificador da área', () => {
    expect(housePath('federal')).toBe('/casa/federal');
    expect(areaPath('municipal', '3550308')).toBe('/casa/municipal/3550308');
    expect(areaPath('state', 'a b/c')).toBe('/casa/state/a%20b%2Fc');
  });

  it('isOffice valida os três cargos e rejeita os demais', () => {
    for (const office of ['federal', 'state', 'municipal']) expect(isOffice(office)).toBe(true);
    expect(isOffice('governador')).toBe(false);
    expect(isOffice(undefined)).toBe(false);
  });
});
