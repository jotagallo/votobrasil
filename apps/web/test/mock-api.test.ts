import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ChamberResponse, MetaResponse, SimulateResponse } from '@votobr/shared';
import { createMockApi } from '../dev/mock/handler';

const geoDir = fileURLToPath(new URL('../../../data/processed/geo', import.meta.url));
const api = createMockApi({ geoDir });

function get<T>(path: string): { status: number; body: T } {
  const response = api.handle(new URL(path, 'http://localhost'));
  if (!response) throw new Error(`rota não tratada: ${path}`);
  return { status: response.status, body: JSON.parse(response.body) as T };
}

describe('mock da API de desenvolvimento', () => {
  it('serve /healthz e ignora rotas fora do prefixo', () => {
    expect(get('/healthz').status).toBe(200);
    expect(api.handle(new URL('/outra-coisa', 'http://localhost'))).toBeNull();
  });

  it('descreve as três casas, 27 UFs e 11 cidades', () => {
    const { body } = get<MetaResponse>('/api/v1/meta');
    expect(Object.keys(body.offices).sort()).toEqual(['federal', 'municipal', 'state']);
    expect(body.offices.federal.areas).toHaveLength(27);
    expect(body.offices.municipal.areas).toHaveLength(11);
    expect(body.sources.length).toBeGreaterThan(0);
  }, 60_000);

  it('simula uma UF e preenche unidades apenas em sistemas com distritos', () => {
    const base = '/api/v1/simulate/federal/PE';
    const mixed = get<SimulateResponse>(`${base}?system=distrital-misto&v=mock-1`).body;
    const total = Object.values(mixed.scenario.result.seatsByParty).reduce((a, b) => a + b, 0);
    expect(total).toBe(mixed.seats + mixed.scenario.result.overhangSeats);
    expect(mixed.scenario.result.districtSeats).toBe(Math.ceil(mixed.seats / 2));
    expect(mixed.units).not.toBeNull();
    expect(mixed.scenario.result.districts?.length).toBeGreaterThan(1);
    const closed = get<SimulateResponse>(`${base}?system=lista-fechada`).body;
    expect(closed.units).toBeNull();
    expect(closed.baseline.result.system).toBe('atual');
  }, 60_000);

  it('simula uma cidade com locais de votação', () => {
    const body = get<SimulateResponse>(
      '/api/v1/simulate/municipal/3106200?system=distrital-puro',
    ).body;
    expect(body.area.kind).toBe('municipality');
    expect(body.units?.length).toBeGreaterThan(50);
    expect(body.scenario.result.maxDistrictDeviationPct).toBeDefined();
  }, 60_000);

  it('não expõe cargos majoritários', () => {
    expect(get('/api/v1/simulate/governador/SP').status).toBe(404);
    expect(get('/api/v1/chamber/governador').status).toBe(404);
  });

  it('agrega a Câmara dos Deputados somando as 27 UFs', () => {
    const { body } = get<ChamberResponse>('/api/v1/chamber/federal?system=distritao');
    expect(body.areas).toHaveLength(27);
    expect(Object.values(body.baseline.seatsByParty).reduce((a, b) => a + b, 0)).toBe(body.seats);
    expect(Object.values(body.scenario.seatsByParty).reduce((a, b) => a + b, 0)).toBe(body.seats);
  }, 120_000);

  it('valida parâmetros e rotas', () => {
    expect(get('/api/v1/simulate/federal/PE?system=nao-existe').status).toBe(400);
    expect(get('/api/v1/simulate/federal/PE?system=misto-paralelo').status).toBe(400);
    expect(get('/api/v1/simulate/federal/XX').status).toBe(404);
  });

  it('é determinístico entre instâncias', () => {
    const other = createMockApi({ geoDir });
    const path = '/api/v1/simulate/state/AC?system=distrital-misto';
    const a = api.handle(new URL(path, 'http://localhost'));
    const b = other.handle(new URL(path, 'http://localhost'));
    expect(a?.body).toBe(b?.body);
  }, 60_000);

  it('serve geometrias de BR, UF e cidade', () => {
    const br = get<{ objects: Record<string, unknown> }>('/api/v1/geo/br.topo.json').body;
    expect(Object.keys(br.objects)).toContain('states');
    const uf = get<{ objects: Record<string, unknown> }>('/api/v1/geo/uf/AC.topo.json').body;
    expect(Object.keys(uf.objects)).toEqual(expect.arrayContaining(['municipalities', 'state']));
    const city = get<{ objects: Record<string, unknown> }>(
      '/api/v1/geo/city/3550308.topo.json',
    ).body;
    expect(Object.keys(city.objects)).toContain('city');
    expect(get('/api/v1/geo/city/0000000.topo.json').status).toBe(404);
  });
});
