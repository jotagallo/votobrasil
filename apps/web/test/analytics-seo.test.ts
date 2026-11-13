import { describe, expect, it } from 'vitest';
import { analyticsCspOrigins, ANALYTICS_CSP, privacyOptOut } from '../src/analytics';
import { buildAlternates } from '../src/seo';

describe('analytics: CSP', () => {
  it('Umami Cloud: script de cloud.umami.is e envio ao gateway', () => {
    expect(ANALYTICS_CSP).toEqual({
      scriptSrc: ['https://cloud.umami.is'],
      connectSrc: ['https://gateway.umami.is'],
    });
  });

  it('Umami próprio: script e conexão usam a mesma origem', () => {
    expect(analyticsCspOrigins('https://stats.exemplo.org/script.js')).toEqual({
      scriptSrc: ['https://stats.exemplo.org'],
      connectSrc: ['https://stats.exemplo.org'],
    });
  });

  it('URL inválida não libera nenhuma origem', () => {
    expect(analyticsCspOrigins('nao-e-url')).toEqual({ scriptSrc: [], connectSrc: [] });
  });
});

describe('analytics: privacidade', () => {
  it('respeita Do Not Track e Global Privacy Control', () => {
    expect(privacyOptOut({ doNotTrack: '1' })).toBe(true);
    expect(privacyOptOut({ doNotTrack: 'yes' })).toBe(true);
    expect(privacyOptOut({ doNotTrack: null, globalPrivacyControl: true })).toBe(true);
    expect(privacyOptOut({ doNotTrack: '0' })).toBe(false);
    expect(privacyOptOut({ doNotTrack: null })).toBe(false);
  });
});

describe('seo: alternates', () => {
  it('lista cada idioma e x-default apontando para pt-BR', () => {
    expect(buildAlternates('https://votobr.example', '/sistemas')).toEqual([
      { hreflang: 'pt-BR', href: 'https://votobr.example/sistemas' },
      { hreflang: 'en', href: 'https://votobr.example/en/sistemas' },
      { hreflang: 'es', href: 'https://votobr.example/es/sistemas' },
      { hreflang: 'x-default', href: 'https://votobr.example/sistemas' },
    ]);
  });

  it('a raiz não ganha barra extra', () => {
    const alternates = buildAlternates('https://votobr.example', '/');
    expect(alternates.map((a) => a.href)).toEqual([
      'https://votobr.example/',
      'https://votobr.example/en',
      'https://votobr.example/es',
      'https://votobr.example/',
    ]);
  });
});
