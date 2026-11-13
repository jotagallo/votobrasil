import { describe, expect, it } from 'vitest';
import { geoContains } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { DatasetBuilder, competitorOf, statusOf } from '../src/builder.js';
import { checkDataset } from '../src/checks.js';
import { parseCoord, parseIntSafe, splitLine } from '../src/csv.js';
import { dropSlivers, normalizeName, rewindGeometry } from '../src/geo.js';
import { distribute } from '../src/municipal.js';

describe('csv', () => {
  it('divide linhas com ; e aspas', () => {
    expect(splitLine('"A";"B;C";"D ""E"""')).toEqual(['A', 'B;C', 'D "E"']);
    expect(splitLine('a;;c')).toEqual(['a', '', 'c']);
    expect(splitLine('"";"x"')).toEqual(['', 'x']);
    expect(splitLine('a;')).toEqual(['a', '']);
  });

  it('converte números do TSE', () => {
    expect(parseCoord('-9,97499')).toBeCloseTo(-9.97499);
    expect(parseCoord('-9.97')).toBeCloseTo(-9.97);
    expect(parseCoord('#NULO')).toBeNaN();
    expect(parseIntSafe('12')).toBe(12);
    expect(parseIntSafe('#NULO')).toBe(0);
  });
});

describe('builder', () => {
  const row = (r: Record<string, string>) => (c: string) => r[c] ?? '';

  it('identifica federações e partidos isolados', () => {
    expect(
      competitorOf(
        row({
          NR_FEDERACAO: '1',
          SG_FEDERACAO: 'BRASIL DA ESPERANÇA',
          DS_COMPOSICAO_FEDERACAO: 'PT/PC do B/PV',
        }),
      ),
    ).toEqual({ id: 'F1', label: 'BRASIL DA ESPERANÇA', parties: ['PT', 'PC do B', 'PV'] });
    expect(competitorOf(row({ NR_FEDERACAO: '-1', NR_PARTIDO: '22', SG_PARTIDO: 'PL' }))).toEqual({
      id: 'P22',
      label: 'PL',
      parties: ['PL'],
    });
  });

  it('mapeia a situação oficial', () => {
    expect(statusOf('Eleito por QP')).toBe('QP');
    expect(statusOf('ELEITO POR MÉDIA')).toBe('MEDIA');
    expect(statusOf('Eleito')).toBe('MAJ');
    expect(statusOf('Suplente')).toBe('SUPLENTE');
    expect(statusOf('Não eleito')).toBe('NAO');
  });

  it('acumula votos por unidade e gera um dataset consistente', () => {
    const b = new DatasetBuilder('2026-federal-XX', 2026, 'federal', {
      kind: 'state',
      code: 'AC',
      name: 'Acre',
      uf: 'AC',
    });
    const u0 = b.unit('1550:1', () => ({
      mun: 1200401,
      zone: 1,
      lat: -9.97,
      lon: -67.8,
      voters: 100,
    }));
    const u1 = b.unit('1550:2', () => ({
      mun: 1200401,
      zone: 2,
      lat: -9.9,
      lon: -67.7,
      voters: 50,
    }));
    expect(b.unit('1550:1', () => ({ mun: 0, zone: 0, lat: 0, lon: 0, voters: 0 }))).toBe(u0);
    const comp = b.competitor({ id: 'P22', label: 'PL', parties: ['PL'] });
    b.addCandidate('1', { name: 'A', number: 2201, party: 'PL', comp, status: 'QP' }, u0, 60);
    b.addCandidate('1', { name: 'A', number: 2201, party: 'PL', comp, status: 'QP' }, u1, 15);
    b.addCandidate('2', { name: 'B', number: 2202, party: 'PL', comp, status: 'NAO' }, u0, 10);
    b.addLegend(comp, 'PL', u1, 5);
    const ds = b.build();
    expect(ds.seats).toBe(1);
    expect(ds.electorate).toBe(150);
    expect(ds.validVotes).toBe(90);
    expect(ds.candidates[0]?.u).toEqual([0, 60, 1, 15]);
    expect(checkDataset(ds)).toEqual([]);
  });

  it('checkDataset aponta inconsistências', () => {
    const b = new DatasetBuilder('k', 2026, 'federal', {
      kind: 'state',
      code: 'AC',
      name: 'Acre',
      uf: 'AC',
    });
    const u = b.unit('a', () => ({ mun: 1, zone: 1, lat: 10, lon: -67, voters: 10 }));
    const comp = b.competitor({ id: 'P1', label: 'X', parties: ['X'] });
    b.addCandidate('1', { name: 'A', number: 1, party: 'X', comp, status: 'NAO' }, u, 5);
    const ds = b.build();
    ds.validVotes += 1;
    const problems = checkDataset(ds).join('\n');
    expect(problems).toContain('coordenada fora do Brasil');
    expect(problems).toContain('votos válidos');
  });
});

describe('distribute', () => {
  it('conserva o total e respeita as proporções (maior resto)', () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distribute(7, [0, 0])).toEqual([7, 0]);
    expect(distribute(0, [3, 4])).toEqual([0, 0]);
    const w = [17, 3, 9, 1, 30];
    const out = distribute(1234, w);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1234);
  });
});

describe('geo', () => {
  it('normaliza nomes', () => {
    expect(normalizeName("São Luís D'Oeste")).toBe('SAOLUISDOESTE');
  });

  it('reorienta anéis do IBGE (anti-horário) para a convenção do d3-geo', () => {
    const ccw: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-10, -10],
          [-9, -10],
          [-9, -9],
          [-10, -9],
          [-10, -10],
        ],
      ],
    };
    expect(geoContains({ type: 'Feature', properties: {}, geometry: ccw }, [-9.5, -9.5])).toBe(
      false,
    );
    const fixed = rewindGeometry(ccw);
    expect(geoContains({ type: 'Feature', properties: {}, geometry: fixed }, [-9.5, -9.5])).toBe(
      true,
    );
    expect(geoContains({ type: 'Feature', properties: {}, geometry: fixed }, [20, 20])).toBe(false);
  });

  it('descarta ilhotas que colapsariam na quantização, preservando o maior polígono', () => {
    const square = (x: number, y: number, s: number) => [
      [
        [x, y],
        [x + s, y],
        [x + s, y + s],
        [x, y + s],
        [x, y],
      ],
    ];
    const g = dropSlivers({
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 1), square(5, 5, 0.001)],
    } as MultiPolygon);
    expect(g.coordinates).toHaveLength(1);
    const tiny = dropSlivers({
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 0.001), square(5, 5, 0.0005)],
    } as MultiPolygon);
    expect(tiny.coordinates).toHaveLength(1);
    expect(tiny.coordinates[0]?.[0]?.[2]).toEqual([0.001, 0.001]);
  });
});
