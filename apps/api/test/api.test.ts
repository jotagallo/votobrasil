import { brotliCompressSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ChamberResponse,
  Dataset,
  MetaResponse,
  OfficeId,
  SimulateResponse,
} from '@votobr/shared';
import { buildApp, type App } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

const VERSION = 'testversion1';

function makeDataset(
  office: OfficeId,
  area: { code: string; name: string; kind: 'state' | 'municipality'; uf: string },
  seats: number,
): Dataset {
  const year = office === 'municipal' ? 2024 : 2026;
  const units = Array.from({ length: 8 }, (_, i) => ({
    mun: 1200000 + i,
    zone: i + 1,
    lat: -10 - (i % 4) * 0.5,
    lon: -68 - Math.floor(i / 4) * 0.5,
    voters: 1000 + i * 100,
  }));
  const comps = [
    { id: 'PA', party: 'PA', base: 900 },
    { id: 'PB', party: 'PB', base: 600 },
    { id: 'PC', party: 'PC', base: 300 },
  ];
  const competitors = comps.map((c) => ({
    id: c.id,
    label: c.party,
    parties: [c.party],
    legend: 100,
    legendByParty: { [c.party]: 100 },
    legendByUnit: [0, 100],
  }));
  const first = Math.ceil(seats / 2);
  const second = Math.floor(seats / 3);
  const quotaSeats = [first, second, seats - first - second];
  const candidates = comps
    .flatMap((c, ci) =>
      Array.from({ length: 6 }, (_, k) => {
        const votes = Math.round((c.base * 8) / (k + 1) / 8) * 8;
        return {
          id: `${c.id}${k}`,
          name: `${c.party} Candidato ${k}`,
          number: ci * 1000 + k,
          party: c.party,
          comp: ci,
          votes,
          u: units.flatMap((_, i) => [i, votes / 8]),
          status: (k < (quotaSeats[ci] ?? 0) ? 'QP' : 'NAO') as 'QP' | 'NAO',
        };
      }),
    )
    .sort((a, b) => b.votes - a.votes);
  const validVotes = candidates.reduce((a, c) => a + c.votes, 0) + 300;
  return {
    schema: 1,
    key: `${year}-${office}-${area.code}`,
    year,
    office,
    area,
    seats,
    electorate: units.reduce((a, u) => a + u.voters, 0),
    validVotes,
    units,
    competitors,
    candidates,
  };
}

function writeFixtures(dir: string): void {
  const datasets: Dataset[] = [
    makeDataset('federal', { code: 'AC', name: 'Acre', kind: 'state', uf: 'AC' }, 6),
    makeDataset('federal', { code: 'AL', name: 'Alagoas', kind: 'state', uf: 'AL' }, 8),
    makeDataset(
      'municipal',
      { code: '1200401', name: 'Rio Branco', kind: 'municipality', uf: 'AC' },
      9,
    ),
  ];
  mkdirSync(join(dir, 'datasets'), { recursive: true });
  mkdirSync(join(dir, 'geo', 'uf'), { recursive: true });
  mkdirSync(join(dir, 'geo', 'city'), { recursive: true });
  const offices = {} as MetaResponse['offices'];
  for (const office of ['federal', 'state', 'municipal'] as const) {
    const list = datasets.filter((d) => d.office === office);
    offices[office] = {
      office,
      year: office === 'municipal' ? 2024 : 2026,
      seats: list.reduce((a, d) => a + d.seats, 0),
      electorate: list.reduce((a, d) => a + d.electorate, 0),
      systems: ['atual', 'lista-fechada', 'distritao', 'distrital-puro', 'distrital-misto'],
      areas: list.map((d) => ({
        code: d.area.code,
        name: d.area.name,
        uf: d.area.uf,
        kind: d.area.kind,
        seats: d.seats,
        electorate: d.electorate,
        validVotes: d.validVotes,
      })),
    };
  }
  for (const ds of datasets) {
    writeFileSync(
      join(dir, 'datasets', `${ds.key}.json.br`),
      brotliCompressSync(Buffer.from(JSON.stringify(ds))),
    );
  }
  const meta: MetaResponse = {
    dataVersion: VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    offices,
    sources: [],
    validation: { areas: 3, exact: 3 },
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  writeFileSync(
    join(dir, 'validation.json'),
    JSON.stringify({
      generatedAt: meta.generatedAt,
      rules: 'teste',
      areas: 3,
      exact: 3,
      entries: [],
    }),
  );
  writeFileSync(
    join(dir, 'geo', 'br.topo.json'),
    '{"type":"Topology","objects":{"states":{}},"arcs":[]}',
  );
  writeFileSync(
    join(dir, 'geo', 'uf', 'AC.topo.json'),
    '{"type":"Topology","objects":{},"arcs":[]}',
  );
  writeFileSync(
    join(dir, 'geo', 'city', '1200401.topo.json'),
    '{"type":"Topology","objects":{},"arcs":[]}',
  );
}

let root: string;
let dataDir: string;
let webDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'votobr-api-'));
  dataDir = join(root, 'data');
  webDir = join(root, 'web');
  mkdirSync(dataDir);
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFixtures(dataDir);
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>VotoBrasil</title>');
  writeFileSync(join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(webDir, 'robots.txt'), 'User-agent: *');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function start(overrides: Partial<Config> = {}): Promise<App> {
  const config: Config = {
    ...loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, WEB_DIR: webDir, LOG_LEVEL: 'silent' }),
    ...overrides,
  };
  return buildApp(config);
}

describe('API', () => {
  let app: App;
  beforeAll(async () => {
    app = await start();
  });
  afterAll(async () => {
    await app.server.close();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.server.inject({ method: 'GET', url, headers });

  it('responde /healthz com a versão dos dados', async () => {
    const res = await get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', dataVersion: VERSION });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('expõe /meta com cache curto', async () => {
    const res = await get('/api/v1/meta');
    const meta = res.json<MetaResponse>();
    expect(meta.dataVersion).toBe(VERSION);
    expect(meta.offices.federal.areas.map((a) => a.code)).toEqual(['AC', 'AL']);
    expect(res.headers['cache-control']).toContain('s-maxage=300');
  });

  it('simula o sistema atual sem unidades e com baseline igual ao cenário', async () => {
    const res = await get(`/api/v1/simulate/federal/AC?v=${VERSION}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<SimulateResponse>();
    expect(body.system).toBe('atual');
    expect(body.units).toBeNull();
    expect(body.scenario.result.seatsByParty).toEqual(body.baseline.result.seatsByParty);
    expect(body.baseline.result.seatsByParty).toEqual({ PA: 3, PB: 2, PC: 1 });
    expect(Object.values(body.baseline.result.seatsByParty).reduce((a, b) => a + b, 0)).toBe(6);
    expect(body.partyVotes.PA).toBeGreaterThan(0);
  });

  it('simula sistemas distritais devolvendo as unidades por distrito sem vazar unitDistrict', async () => {
    const res = await get(`/api/v1/simulate/federal/AC?system=distrital-puro&v=${VERSION}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<SimulateResponse>();
    expect(body.units).toHaveLength(8);
    for (const u of body.units ?? []) {
      expect(u).toHaveLength(5);
      expect(u[2]).toBeGreaterThanOrEqual(0);
    }
    expect(body.scenario.result.unitDistrict).toBeUndefined();
    expect(body.scenario.result.seats).toBe(6);
    expect(body.scenario.result.districtSeats).toBe(6);
  });

  it('distrital misto da PEC 2/2025: metade das cadeiras em distritos, arredondada para cima', async () => {
    const mixed = (
      await get('/api/v1/simulate/federal/AL?system=distrital-misto')
    ).json<SimulateResponse>();
    const result = mixed.scenario.result;
    expect(result.districtSeats).toBe(4);
    expect(result.seats).toBe(8 + result.overhangSeats);
    expect(result.districtSeats + result.listSeats).toBe(result.seats);
    expect(mixed.scenario.metrics.seats).toBe(result.seats);
    const total = Object.values(result.seatsByParty).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.seats);
  });

  it('valida parâmetros', async () => {
    expect((await get('/api/v1/simulate/federal/AC?system=inexistente')).statusCode).toBe(400);
    expect((await get('/api/v1/simulate/federal/AC?system=misto-paralelo')).statusCode).toBe(400);
    expect((await get('/api/v1/simulate/federal/ZZ')).statusCode).toBe(404);
    expect((await get('/api/v1/simulate/presidente/AC')).statusCode).toBe(404);
    const senate = await get('/api/v1/simulate/senate/AC');
    expect(senate.statusCode).toBe(404);
    expect(senate.json().error.code).toBe('not_found');
    expect((await get('/api/v1/chamber/municipal')).statusCode).toBe(400);
  });

  it('usa cache imutável com ?v= correto e ETag condicional', async () => {
    const res = await get(`/api/v1/simulate/federal/AC?system=distritao&v=${VERSION}`);
    expect(res.headers['cache-control']).toContain('immutable');
    const etag = res.headers.etag as string;
    expect(etag).toContain(VERSION);
    const again = await get(`/api/v1/simulate/federal/AC?system=distritao&v=${VERSION}`, {
      'if-none-match': etag,
    });
    expect(again.statusCode).toBe(304);
    const stale = await get('/api/v1/simulate/federal/AC?system=distritao&v=antiga');
    expect(stale.headers['cache-control']).toBe('public, max-age=60, s-maxage=60');
  });

  it('agrega a câmara somando as circunscrições', async () => {
    const res = await get(`/api/v1/chamber/federal?system=lista-fechada&v=${VERSION}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<ChamberResponse>();
    expect(body.seats).toBe(14);
    expect(body.areas.map((a) => a.code)).toEqual(['AC', 'AL']);
    expect(Object.values(body.scenario.seatsByParty).reduce((a, b) => a + b, 0)).toBe(14);
    expect(Object.values(body.baseline.seatsByParty).reduce((a, b) => a + b, 0)).toBe(14);
    expect(body.scenario.metrics.seats).toBe(14);
    expect(body.scenario.metrics.majority).toBe(8);
  });

  it('entrega geometrias válidas e rejeita as desconhecidas', async () => {
    expect((await get('/api/v1/geo/br.topo.json')).statusCode).toBe(200);
    expect((await get('/api/v1/geo/uf/AC.topo.json')).statusCode).toBe(200);
    expect((await get('/api/v1/geo/city/1200401.topo.json')).statusCode).toBe(200);
    expect((await get('/api/v1/geo/uf/XX.topo.json')).statusCode).toBe(404);
    expect((await get('/api/v1/geo/uf/..%2F..%2Fmeta.json')).statusCode).toBe(404);
    expect((await get('/api/v1/geo/city/9999999.topo.json')).statusCode).toBe(404);
  });

  it('expõe o relatório de validação', async () => {
    const res = await get(`/api/v1/validation?v=${VERSION}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().exact).toBe(3);
  });

  it('serve o SPA com cache adequado e fallback de rotas', async () => {
    const home = await get('/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('VotoBrasil');
    expect(home.headers['cache-control']).toBe('no-cache');
    const route = await get('/pt/sistemas');
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('VotoBrasil');
    const asset = await get('/assets/app-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await get('/missing.js')).statusCode).toBe(404);
    const api404 = await get('/api/v1/nao-existe');
    expect(api404.statusCode).toBe(404);
    expect(api404.json().error.code).toBe('not_found');
  });

  it('envia cabeçalhos de segurança e CSP com o Umami', async () => {
    const res = await get('/');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://cloud.umami.is");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('proteções', () => {
  it('exige o segredo de origem, exceto em /healthz', async () => {
    const app = await start({ originVerifySecret: 'segredo-de-teste' });
    try {
      expect((await app.server.inject('/api/v1/meta')).statusCode).toBe(403);
      const wrong = await app.server.inject({
        url: '/api/v1/meta',
        headers: { 'x-origin-verify': 'errado' },
      });
      expect(wrong.statusCode).toBe(403);
      const ok = await app.server.inject({
        url: '/api/v1/meta',
        headers: { 'x-origin-verify': 'segredo-de-teste' },
      });
      expect(ok.statusCode).toBe(200);
      expect((await app.server.inject('/healthz')).statusCode).toBe(200);
    } finally {
      await app.server.close();
    }
  });

  it('aplica CORS somente às origens configuradas', async () => {
    const app = await start({ corsOrigins: ['http://localhost:5173'] });
    try {
      const ok = await app.server.inject({
        url: '/api/v1/meta',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const other = await app.server.inject({
        url: '/api/v1/meta',
        headers: { origin: 'https://exemplo.com' },
      });
      expect(other.headers['access-control-allow-origin']).toBeUndefined();
      const pre = await app.server.inject({
        method: 'OPTIONS',
        url: '/api/v1/meta',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
      });
      expect(pre.statusCode).toBe(204);
    } finally {
      await app.server.close();
    }
  });

  it('limita requisições por IP na API, sem afetar /healthz', async () => {
    const app = await start({ rateLimitPerMinute: 10 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await app.server.inject('/api/v1/meta')).statusCode);
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes[11]).toBe(429);
      expect((await app.server.inject('/healthz')).statusCode).toBe(200);
    } finally {
      await app.server.close();
    }
  });

  it('falha com mensagem clara quando não há dados', async () => {
    await expect(start({ dataDir: join(root, 'vazio') })).rejects.toThrow(/data:build/);
  });
});
