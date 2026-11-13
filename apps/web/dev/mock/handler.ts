/** Implementação das rotas `/api/v1/*` do mock, sem dependência do Vite (testável isoladamente). */
import { createHash } from 'node:crypto';
import {
  API_PREFIX,
  UF_CODES,
  computeMetrics,
  isSystemId,
  mergeResults,
  partyVotes,
  simulate,
  SYSTEMS,
  type ChamberAreaRow,
  type ChamberResponse,
  type Dataset,
  type MetaResponse,
  type OfficeId,
  type SimulateResponse,
  type SimulationResult,
  type SimulationView,
  type SystemId,
  type UfCode,
  type UnitPoint,
  type ValidationReport,
} from '@votobr/shared';
import { createMockData, MOCK_YEAR } from './data.js';
import { createGeoProvider, CITIES } from './geo.js';

export interface MockResponse {
  status: number;
  body: string;
  contentType?: string;
}

const OFFICES: readonly OfficeId[] = ['federal', 'state', 'municipal'];
const DATA_VERSION = 'mock-1';

const json = (status: number, payload: unknown): MockResponse => ({
  status,
  body: JSON.stringify(payload),
});
const failure = (status: number, code: string, message: string): MockResponse =>
  json(status, { error: { code, message } });

export function createMockApi(options: { geoDir: string }) {
  const geo = createGeoProvider(options.geoDir);
  const data = createMockData(geo);
  const results = new Map<string, SimulationResult>();

  const resultOf = (ds: Dataset, system: SystemId): SimulationResult => {
    const key = `${ds.key}|${system}`;
    const hit = results.get(key);
    if (hit) return hit;
    const computed = simulate(ds, system);
    results.set(key, computed);
    return computed;
  };

  const viewOf = (result: SimulationResult, votes: Record<string, number>): SimulationView => ({
    result,
    metrics: computeMetrics(result.seatsByParty, votes, result.seats),
  });

  const parseQuery = (url: URL): { system: SystemId } | MockResponse => {
    const system = url.searchParams.get('system') ?? 'atual';
    if (!isSystemId(system)) return failure(400, 'bad_request', `Sistema inválido: ${system}`);
    return { system };
  };

  let meta: MetaResponse | null = null;
  const buildMeta = (): MetaResponse => {
    if (meta) return meta;
    const offices = {} as MetaResponse['offices'];
    for (const office of OFFICES) {
      const datasets = data.allDatasets(office);
      offices[office] = {
        office,
        year: office === 'municipal' ? MOCK_YEAR.municipal : MOCK_YEAR.national,
        seats: datasets.reduce((a, ds) => a + ds.seats, 0),
        electorate: datasets.reduce((a, ds) => a + ds.electorate, 0),
        systems: SYSTEMS.map((s) => s.id),
        areas: datasets.map((ds) => ({
          code: ds.area.code,
          name: ds.area.name,
          uf: ds.area.uf,
          kind: ds.area.kind,
          seats: ds.seats,
          electorate: ds.electorate,
          validVotes: ds.validVotes,
        })),
      };
    }
    const sources = [
      ['MOCK — TSE: resultados das eleições 2026 (sintético)', 'https://dadosabertos.tse.jus.br/'],
      [
        'MOCK — TSE: resultados das eleições municipais 2024 (sintético)',
        'https://dadosabertos.tse.jus.br/',
      ],
      [
        'MOCK — IBGE: malhas municipais (sintético)',
        'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html',
      ],
    ].map(([name, url], i) => ({
      name: name as string,
      url: url as string,
      sha256: createHash('sha256').update(`mock-${i}`).digest('hex'),
      etag: null,
      bytes: 48_000_000 + i * 7_300_000,
      downloadedAt: '2026-01-01T12:00:00.000Z',
    }));
    const keys = OFFICES.flatMap((office) => data.allDatasets(office).map((ds) => ds.key));
    meta = {
      dataVersion: DATA_VERSION,
      generatedAt: '2026-01-01T12:00:00.000Z',
      offices,
      sources,
      validation: { areas: keys.length, exact: keys.length - 2 },
    };
    return meta;
  };

  const validation = (): ValidationReport => {
    const info = buildMeta();
    const keys = OFFICES.flatMap((office) =>
      data.allDatasets(office).map((ds) => ({ key: ds.key, seats: ds.seats })),
    );
    // Duas áreas "inexatas" fictícias para exercitar a tela de metodologia.
    const inexact = new Set([keys[3]?.key, keys[keys.length - 4]?.key]);
    return {
      generatedAt: info.generatedAt,
      rules: 'Mock: lista aberta (interpretação do STF, 2024) sobre dados sintéticos',
      areas: keys.length,
      exact: keys.length - inexact.size,
      entries: keys.map((k) => ({
        key: k.key,
        seats: k.seats,
        missing: inexact.has(k.key) ? 1 : 0,
      })),
    };
  };

  const simulateArea = (url: URL, office: OfficeId, code: string): MockResponse => {
    const query = parseQuery(url);
    if ('status' in query) return query;
    const ds = data.dataset(office, code);
    if (!ds) return failure(404, 'not_found', `Área inexistente: ${office}/${code}`);
    const votes = partyVotes(ds);
    const baseline = viewOf(resultOf(ds, 'atual'), votes);
    const scenario =
      query.system === 'atual' ? baseline : viewOf(resultOf(ds, query.system), votes);
    const usesDistricts = SYSTEMS.find((s) => s.id === query.system)?.usesDistricts ?? false;
    const unitDistrict = scenario.result.unitDistrict;
    const units: UnitPoint[] | null =
      usesDistricts && unitDistrict
        ? ds.units.map((u, i) => [
            Number(u.lon.toFixed(4)),
            Number(u.lat.toFixed(4)),
            unitDistrict[i] ?? 0,
            u.voters,
            u.mun,
          ])
        : null;
    const body: SimulateResponse = {
      office,
      year: ds.year,
      area: ds.area,
      seats: ds.seats,
      electorate: ds.electorate,
      validVotes: ds.validVotes,
      system: query.system,
      baseline,
      scenario,
      partyVotes: votes,
      units,
    };
    return json(200, body);
  };

  const chamber = (url: URL, office: OfficeId): MockResponse => {
    if (office !== 'federal' && office !== 'state') {
      return failure(400, 'bad_request', 'A visão agregada só existe para federal e state.');
    }
    const query = parseQuery(url);
    if ('status' in query) return query;
    const datasets = data.allDatasets(office);
    const votes: Record<string, number> = {};
    const areas: ChamberAreaRow[] = [];
    const baselineParts: SimulationResult[] = [];
    const scenarioParts: SimulationResult[] = [];
    for (const ds of datasets) {
      for (const [party, v] of Object.entries(partyVotes(ds)))
        votes[party] = (votes[party] ?? 0) + v;
      const baseline = resultOf(ds, 'atual');
      const scenario = resultOf(ds, query.system);
      baselineParts.push(baseline);
      scenarioParts.push(scenario);
      areas.push({
        code: ds.area.code,
        name: ds.area.name,
        seats: ds.seats,
        scenarioSeats: scenario.seats,
        baseline: baseline.seatsByParty,
        scenario: scenario.seatsByParty,
      });
    }
    const baseline = mergeResults(office, 'atual', baselineParts);
    const scenario = mergeResults(office, query.system, scenarioParts);
    const body: ChamberResponse = {
      office,
      year: MOCK_YEAR.national,
      system: query.system,
      seats: baseline.seats,
      baseline: {
        seatsByParty: baseline.seatsByParty,
        metrics: computeMetrics(baseline.seatsByParty, votes, baseline.seats),
      },
      scenario: {
        seatsByParty: scenario.seatsByParty,
        metrics: computeMetrics(scenario.seatsByParty, votes, scenario.seats),
      },
      partyVotes: votes,
      areas,
    };
    return json(200, body);
  };

  const handle = (url: URL): MockResponse | null => {
    const { pathname } = url;
    if (pathname === '/healthz') return json(200, { status: 'ok', dataVersion: DATA_VERSION });
    if (!pathname.startsWith(`${API_PREFIX}/`)) return null;
    const parts = pathname
      .slice(API_PREFIX.length + 1)
      .split('/')
      .map(decodeURIComponent);
    const [route, a, b] = parts;

    if (route === 'meta') return json(200, buildMeta());
    if (route === 'validation') return json(200, validation());

    if (route === 'simulate' && a && b) {
      if (!(OFFICES as readonly string[]).includes(a))
        return failure(404, 'not_found', `Casa inexistente: ${a}`);
      return simulateArea(url, a as OfficeId, b);
    }
    if (route === 'chamber' && a) {
      if (!(OFFICES as readonly string[]).includes(a))
        return failure(404, 'not_found', `Casa inexistente: ${a}`);
      return chamber(url, a as OfficeId);
    }

    if (route === 'geo' && a) {
      if (a === 'br.topo.json') return json(200, geo.brazil());
      if (a === 'uf' && b?.endsWith('.topo.json')) {
        const uf = b.replace('.topo.json', '');
        return (UF_CODES as readonly string[]).includes(uf)
          ? json(200, geo.state(uf as UfCode))
          : failure(404, 'not_found', `UF inexistente: ${uf}`);
      }
      if (a === 'city' && b?.endsWith('.topo.json')) {
        const ibge = b.replace('.topo.json', '');
        const topology = CITIES.some((c) => c.ibge === ibge) ? geo.city(ibge) : null;
        return topology
          ? json(200, topology)
          : failure(404, 'not_found', `Município sem geometria: ${ibge}`);
      }
    }
    return failure(404, 'not_found', `Rota inexistente: ${pathname}`);
  };

  return { handle, describe: () => geo.describe() };
}

export type MockApi = ReturnType<typeof createMockApi>;
