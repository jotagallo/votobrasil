import { describe, expect, it } from 'vitest';
import type { UnitPoint, Winner } from '@votobr/shared';
import {
  diffWinners,
  districtName,
  dominantDistricts,
  fitView,
  greedyColoring,
  IDENTITY_VIEW,
  placeBadges,
  searchKey,
  summarizeDistricts,
} from '../src/lib/districts';

const unit = (district: number, voters: number, mun: number): UnitPoint => [
  -47,
  -23,
  district,
  voters,
  mun,
];

describe('dominantDistricts', () => {
  it('escolhe o distrito com mais eleitores no município e marca divisão', () => {
    const map = dominantDistricts([
      unit(0, 100, 1),
      unit(1, 300, 1),
      unit(1, 50, 2),
      unit(2, 10, 3),
      unit(2, 20, 3),
    ]);
    expect(map.get(1)).toEqual({
      mun: 1,
      district: 1,
      split: true,
      districts: [0, 1],
      voters: 400,
    });
    expect(map.get(2)).toMatchObject({ district: 1, split: false, districts: [1], voters: 50 });
    expect(map.get(3)).toMatchObject({ district: 2, split: false, voters: 30 });
  });

  it('desempata pelo menor número de distrito, independentemente da ordem das unidades', () => {
    const a = dominantDistricts([unit(3, 100, 1), unit(1, 100, 1)]);
    const b = dominantDistricts([unit(1, 100, 1), unit(3, 100, 1)]);
    expect(a.get(1)?.district).toBe(1);
    expect(b.get(1)?.district).toBe(1);
  });

  it('devolve mapa vazio sem unidades', () => {
    expect(dominantDistricts([]).size).toBe(0);
  });
});

describe('summarizeDistricts', () => {
  it('soma eleitores, unidades e municípios por distrito, em ordem', () => {
    expect(
      summarizeDistricts([unit(1, 10, 5), unit(0, 20, 5), unit(1, 30, 6), unit(1, 5, 6)]),
    ).toEqual([
      { id: 0, voters: 20, units: 1, municipalities: 1 },
      { id: 1, voters: 45, units: 3, municipalities: 2 },
    ]);
  });
});

describe('greedyColoring', () => {
  it('colore um caminho com duas cores e um triângulo com três', () => {
    const path = greedyColoring(4, [
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(new Set(path).size).toBe(2);
    const triangle = greedyColoring(3, [
      [0, 1],
      [1, 2],
      [0, 2],
    ]);
    expect(new Set(triangle).size).toBe(3);
  });

  it('nunca atribui a mesma cor a vizinhos', () => {
    const edges: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [4, 5],
      [5, 1],
    ];
    const colors = greedyColoring(6, edges);
    for (const [a, b] of edges) expect(colors[a]).not.toBe(colors[b]);
  });

  it('ignora laços e índices inválidos', () => {
    expect(
      greedyColoring(2, [
        [0, 0],
        [0, 9],
        [-1, 1],
      ]),
    ).toEqual([0, 0]);
  });
});

describe('diffWinners', () => {
  const w = (name: string, party: string, votes: number): Winner => ({
    name,
    party,
    competitor: party,
    votes,
    tier: 'oficial',
  });

  it('separa eleitos só no cenário, só no oficial e nos dois', () => {
    const baseline = [w('Ana', 'A', 100), w('Bia', 'B', 90), w('Caio', 'A', 80)];
    const scenario = [w('Ana', 'A', 100), w('Davi', 'C', 95), w('Eva', 'B', 70)];
    const diff = diffWinners(baseline, scenario);
    expect(diff.kept).toBe(1);
    expect(diff.gained.map((x) => x.name)).toEqual(['Davi', 'Eva']);
    expect(diff.lost.map((x) => x.name)).toEqual(['Bia', 'Caio']);
  });

  it('trata homônimos com os mesmos dados como entradas distintas', () => {
    const twin = w('Silva', 'A', 10);
    const diff = diffWinners([twin], [twin, twin]);
    expect(diff.kept).toBe(1);
    expect(diff.gained).toHaveLength(1);
    expect(diff.lost).toHaveLength(0);
  });

  it('resultado idêntico não tem ganhos nem perdas', () => {
    const list = [w('Ana', 'A', 100), w('Bia', 'B', 90)];
    expect(diffWinners(list, list)).toEqual({ gained: [], lost: [], kept: 2 });
  });
});

describe('districtName', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    `${key}:${JSON.stringify(params ?? {})}`;

  it('usa o município principal e conta os demais', () => {
    expect(districtName({ main: 'Campinas' }, 0, 'state', t)).toBe('Campinas');
    expect(districtName({ main: 'Campinas', others: 1 }, 0, 'state', t)).toBe(
      'districtMap.plusOne:{"name":"Campinas"}',
    );
    expect(
      districtName(
        { main: 'São Paulo', hoods: ['Itaquera', 'Guaianases'], others: 2 },
        0,
        'state',
        t,
      ),
    ).toBe('districtMap.plusMany:{"name":"São Paulo (Itaquera, Guaianases)","count":2}');
  });

  it('nas cidades, lista os bairros de referência', () => {
    expect(districtName({ main: 'Copacabana', hoods: ['Leme'] }, 3, 'city', t)).toBe(
      'Copacabana, Leme',
    );
  });

  it('sem rótulo, usa o número', () => {
    expect(districtName(undefined, 4, 'state', t)).toBe('districtMap.unnamed:{"n":5}');
  });
});

describe('searchKey', () => {
  it('ignora acentos e caixa', () => {
    expect(searchKey('São José dos Pinhais')).toBe('sao jose dos pinhais');
  });
});

describe('fitView', () => {
  const viewBox: [number, number, number, number] = [0, 0, 400, 400];

  it('aproxima um distrito pequeno e o centraliza', () => {
    const view = fitView([100, 100, 120, 120], viewBox, 10);
    expect(view.k).toBeGreaterThan(5);
    expect(view.k).toBeLessThanOrEqual(10);
    expect(view.x + view.k * 110).toBeCloseTo(200);
    expect(view.y + view.k * 110).toBeCloseTo(200);
  });

  it('não aproxima um distrito que já ocupa boa parte do mapa', () => {
    expect(fitView([20, 20, 380, 300], viewBox, 10)).toEqual(IDENTITY_VIEW);
  });
});

describe('placeBadges', () => {
  const viewBox: [number, number, number, number] = [0, 0, 400, 400];

  it('omite distritos pequenos e números sobrepostos, preferindo os maiores', () => {
    const placed = placeBadges(
      [
        { district: 0, x: 100, y: 100, area: 5000 },
        { district: 1, x: 105, y: 100, area: 4000 },
        { district: 2, x: 300, y: 300, area: 10 },
        { district: 3, x: 200, y: 200, area: 3000 },
      ],
      7,
      viewBox,
      null,
    );
    expect(placed.map((b) => b.district)).toEqual([0, 3]);
  });

  it('o distrito em destaque sempre aparece, mesmo pequeno', () => {
    const placed = placeBadges(
      [
        { district: 0, x: 100, y: 100, area: 5000 },
        { district: 1, x: 105, y: 100, area: 10 },
      ],
      7,
      viewBox,
      1,
    );
    expect(placed.map((b) => b.district)).toEqual([1]);
  });

  it('ignora números fora da área visível', () => {
    expect(placeBadges([{ district: 0, x: -50, y: 10, area: 5000 }], 7, viewBox, null)).toEqual([]);
  });
});
