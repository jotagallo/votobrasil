import { describe, expect, it } from 'vitest';
import { districtPlanFor, type Dataset } from '@votobr/shared';
import { checkDataset } from '../src/checks.js';
import { attachDistrictPlans, type DistrictPlace } from '../src/districting.js';
import type { GeoData } from '../src/geo.js';
import type { LocalRecord, Locations } from '../src/locations.js';
import { pickMunicipalities } from '../src/municipal.js';

const geo: GeoData = {
  municipalities: [],
  byCode: new Map(
    [1, 2, 3].map((code) => [code, { code, name: `Cidade ${code}`, uf: 'SP', region: 1 }]),
  ),
  features: new Map(),
  stateFeatures: new Map(),
};

function local(tse: string, voters: number, number = 1): LocalRecord {
  return {
    tse,
    voters,
    zone: 1,
    local: number,
    name: `Escola ${number}`,
    hood: 'Bairro',
    lon: -46,
    lat: -23,
    quality: 'local',
  };
}

function locations(): Locations {
  const locals = [
    local('00001', 999_999),
    local('00002', 600_000),
    local('00002', 400_000, 2),
    local('00003', 1_000_001),
  ];
  return {
    year: 2024,
    tseToIbge: new Map([
      ['00001', 1],
      ['00002', 2],
      ['00003', 3],
    ]),
    tseUf: new Map([
      ['00001', 'SP'],
      ['00002', 'SP'],
      ['00003', 'SP'],
    ]),
    locals: new Map(locals.map((l) => [`${l.tse}:${l.zone}:${l.local}`, l])),
    zones: new Map(),
    sectionLocal: new Map(),
    stats: {
      locals: locals.length,
      localsWithCoordinates: locals.length,
      localsOutsideMunicipality: 0,
      localsWithPlaceholder: 0,
      localsFromReference: 0,
      localsByHood: 0,
      zones: 3,
      zonesWithoutOwnCoordinates: 0,
      municipalitiesResolvedByPolygon: 0,
    },
  };
}

describe('cobertura municipal por eleitorado', () => {
  it('inclui exatamente 1 milhão, soma locais e exclui cidades abaixo do corte', () => {
    expect(pickMunicipalities(locations(), geo, 1_000_000)).toEqual([
      { ibge: 3, tse: '00003', uf: 'SP', name: 'Cidade 3', voters: 1_000_001 },
      { ibge: 2, tse: '00002', uf: 'SP', name: 'Cidade 2', voters: 1_000_000 },
    ]);
  });

  it('não impõe um top 10 e só limita quando solicitado para desenvolvimento', () => {
    const loc = locations();
    const manyGeo: GeoData = { ...geo, byCode: new Map(geo.byCode) };
    for (let code = 4; code <= 15; code++) {
      const tse = String(code).padStart(5, '0');
      manyGeo.byCode.set(code, { code, name: `Cidade ${code}`, uf: 'SP', region: 1 });
      loc.tseToIbge.set(tse, code);
      loc.locals.set(`${tse}:1:1`, local(tse, 1_000_000));
    }
    expect(pickMunicipalities(loc, manyGeo, 1_000_000)).toHaveLength(14);
    expect(pickMunicipalities(loc, manyGeo, 1_000_000, 1)).toHaveLength(1);
  });

  it('não omite silenciosamente uma cidade elegível sem correspondência no IBGE', () => {
    const loc = locations();
    loc.tseToIbge.delete('00002');
    expect(() => pickMunicipalities(loc, geo, 1_000_000)).toThrow('sem correspondência no IBGE');
  });
});

function cityDataset(): Dataset {
  return {
    schema: 1,
    key: '2024-municipal-1',
    year: 2024,
    office: 'municipal',
    area: { kind: 'municipality', code: '1', name: 'Cidade 1', uf: 'SP' },
    seats: 4,
    electorate: 1600,
    validVotes: 400,
    units: Array.from({ length: 16 }, (_, i) => ({
      mun: 1,
      zone: 1,
      lon: -46 + (i % 4) * 0.01,
      lat: -23 + Math.floor(i / 4) * 0.01,
      voters: 100,
    })),
    competitors: [
      { id: 'A', label: 'A', parties: ['A'], legend: 0, legendByParty: {}, legendByUnit: [] },
    ],
    candidates: Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      name: `Candidato ${i}`,
      number: i,
      party: 'A',
      comp: 0,
      votes: 100,
      u: [i, 100],
      status: 'QP',
    })),
  };
}

function draw(ds: Dataset) {
  const places: DistrictPlace[] = ds.units.map((u, unit) => ({
    unit,
    lon: u.lon,
    lat: u.lat,
    voters: u.voters,
    hood: `Bairro ${Math.floor(unit / 4)}`,
  }));
  return attachDistrictPlans(
    ds,
    {
      geo,
      population: new Map([[1, 16000]]),
      neighbors: new Map([[1, []]]),
    },
    places,
  );
}

describe('desenhos persistidos pelo ETL', () => {
  it('conserva o Censo e gera os dois desenhos dentro da meta de 5%', () => {
    const ds = cityDataset();
    const stats = draw(ds);
    expect(stats.map((s) => s.k)).toEqual([4, 2]);
    expect(ds.units.reduce((sum, u) => sum + (u.pop ?? 0), 0)).toBe(16000);
    for (const { k, maxDeviation } of stats) {
      expect(maxDeviation).toBeLessThanOrEqual(0.05);
      const plan = districtPlanFor(ds, k);
      expect(new Set(plan.unitDistrict).size).toBe(k);
      expect(plan.population.reduce((sum, p) => sum + p, 0)).toBe(16000);
      expect(plan.voters.reduce((sum, p) => sum + p, 0)).toBe(1600);
    }
    expect(checkDataset(ds)).toEqual([]);
  });

  it('é reprodutível e não usa partidos nem votos para traçar fronteiras', () => {
    const ds = cityDataset();
    draw(ds);
    const before = structuredClone(ds.districtPlans);
    ds.candidates.reverse();
    for (const c of ds.candidates) {
      c.party = 'B';
      c.votes *= 10;
      c.u = [15 - Number(c.id), c.votes];
    }
    draw(ds);
    expect(ds.districtPlans).toEqual(before);
  });

  it('rejeita índices, locais e populações inválidos em vez de aceitar NaN ou fallback', () => {
    const ds = cityDataset();
    draw(ds);
    const stored = ds.districtPlans?.['4'];
    if (!stored) throw new Error('Desenho ausente');
    stored.unitDistrict[0] = 0.5;
    expect(checkDataset(ds).join('\n')).toContain('índice inválido');
    stored.unitDistrict.pop();
    expect(checkDataset(ds).join('\n')).toContain('unidades faltando');

    draw(ds);
    const plan = ds.districtPlans?.['4'];
    if (!plan) throw new Error('Desenho ausente');
    plan.points = [[-46, -23, 4, 100, 0]];
    expect(checkDataset(ds).join('\n')).toContain('local de votação inválido');
    plan.points = [];
    for (const u of ds.units) u.pop = NaN;
    expect(checkDataset(ds).join('\n')).toContain('população ausente ou inválida');
  });
});
