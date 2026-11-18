import { describe, expect, it } from 'vitest';
import {
  CONSENT_KEY,
  acknowledgeCookies,
  cookieNoticePending,
  cookiesAcknowledged,
  hostAllowed,
  parseMeasurementId,
  privacyOptOut,
} from '../src/analytics';
import { buildRobots, buildSitemap, sitePaths } from '../src/lib/sitemap';
import { buildAlternates } from '../src/seo';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('analytics: configuração', () => {
  it('aceita só IDs de medição no formato G-XXXXXXXXXX (case-insensitive)', () => {
    expect(parseMeasurementId('G-ABC123XYZ9')).toBe('G-ABC123XYZ9');
    expect(parseMeasurementId(' g-abc123xyz9 ')).toBe('G-ABC123XYZ9');
    expect(parseMeasurementId('UA-12345-1')).toBeNull();
    expect(parseMeasurementId('G-')).toBeNull();
    expect(parseMeasurementId('')).toBeNull();
    expect(parseMeasurementId(undefined)).toBeNull();
  });

  it('só mede o domínio do site quando VITE_SITE_URL existe', () => {
    expect(hostAllowed('votobrasil.org', 'https://votobrasil.org')).toBe(true);
    expect(hostAllowed('localhost', 'https://votobrasil.org')).toBe(false);
    expect(hostAllowed('localhost', undefined)).toBe(true);
    expect(hostAllowed('localhost', '  ')).toBe(true);
  });
});

describe('analytics: aviso de cookies', () => {
  it('mostra o aviso até o "Entendi", mesmo sem ID de medição configurado', () => {
    expect(cookieNoticePending(fakeStorage())).toBe(true);
    expect(cookieNoticePending(null)).toBe(true);
    expect(cookieNoticePending(fakeStorage({ [CONSENT_KEY]: '1' }))).toBe(false);
  });

  it('só considera ciente quem clicou em "Entendi"', () => {
    expect(cookiesAcknowledged(fakeStorage())).toBe(false);
    expect(cookiesAcknowledged(fakeStorage({ [CONSENT_KEY]: '0' }))).toBe(false);
    expect(cookiesAcknowledged(fakeStorage({ [CONSENT_KEY]: '1' }))).toBe(true);
    expect(cookiesAcknowledged(null)).toBe(false);
  });

  it('registra o "Entendi" e tolera armazenamento indisponível', () => {
    const storage = fakeStorage();
    acknowledgeCookies(storage);
    expect(storage.getItem(CONSENT_KEY)).toBe('1');

    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(() => acknowledgeCookies(broken)).not.toThrow();
    expect(cookiesAcknowledged(broken)).toBe(false);
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

describe('seo: sitemap e robots', () => {
  it('inclui páginas fixas, casas e as áreas informadas', () => {
    const paths = sitePaths([{ office: 'federal', code: 'SP' }]);
    expect(paths).toContain('/');
    expect(paths).toContain('/sobre');
    expect(paths).toContain('/casa/federal');
    expect(paths).toContain('/casa/federal/SP');
    expect(sitePaths()).not.toContain('/casa/federal/SP');
  });

  it('gera uma entrada por idioma, cada uma com todas as alternativas', () => {
    const xml = buildSitemap('https://votobr.example', ['/sistemas']);
    expect(xml.match(/<url>/g)).toHaveLength(3);
    expect(xml).toContain('<loc>https://votobr.example/sistemas</loc>');
    expect(xml).toContain('<loc>https://votobr.example/en/sistemas</loc>');
    expect(xml).toContain('<loc>https://votobr.example/es/sistemas</loc>');
    expect(xml.match(/hreflang="x-default"/g)).toHaveLength(3);
  });

  it('escapa caracteres especiais do XML', () => {
    const xml = buildSitemap('https://votobr.example', ['/a&b']);
    expect(xml).toContain('/a&amp;b');
    expect(xml).not.toContain('/a&b');
  });

  it('robots.txt só aponta o sitemap quando há origem', () => {
    expect(buildRobots('https://votobr.example')).toContain(
      'Sitemap: https://votobr.example/sitemap.xml',
    );
    expect(buildRobots('')).not.toContain('Sitemap');
    expect(buildRobots('')).toContain('Disallow: /api/');
  });
});
