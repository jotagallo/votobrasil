import { describe, expect, it } from 'vitest';
import { electoralQuotient, highestAverages } from '../src/systems/divisors.js';
import { planDistricts } from '../src/systems/districts.js';
import { allocateOpenList, RULES_LEI_14211, RULES_STF_2024 } from '../src/systems/open-list.js';
import { computeMetrics, effectiveNumber, gallagher } from '../src/metrics.js';
import {
  mergeResults,
  mixedDistrictSeats,
  officialResult,
  partyVotes,
  simulate,
} from '../src/simulate.js';
import { SYSTEM_IDS, type Dataset, type UnitRecord } from '../src/types.js';

describe('highestAverages', () => {
  it("reproduz o exemplo clássico de D'Hondt (100k/80k/30k/20k, 8 cadeiras)", () => {
    expect(highestAverages([100000, 80000, 30000, 20000], 8)).toEqual([4, 3, 1, 0]);
  });

  it('reproduz o exemplo clássico de Sainte-Laguë (53k/24k/23k, 7 cadeiras)', () => {
    expect(highestAverages([53000, 24000, 23000], 7, { method: 'sainte-lague' })).toEqual([
      3, 2, 2,
    ]);
  });

  it('respeita cadeiras iniciais (compensação AMS)', () => {
    // A começa com 2 cadeiras (divisor 3 → média 20): B(40), A(20 = empate, vence quem tem mais votos), B(20).
    expect(highestAverages([60, 40], 3, { initial: [2, 0] })).toEqual([3, 2]);
  });

  it('respeita elegibilidade', () => {
    expect(highestAverages([100, 50], 3, { eligible: (i) => i === 1 })).toEqual([0, 3]);
  });
});

describe('electoralQuotient', () => {
  it('despreza fração <= 0,5 e arredonda para cima se > 0,5', () => {
    expect(electoralQuotient(1005, 10)).toBe(100);
    expect(electoralQuotient(1006, 10)).toBe(101);
    expect(electoralQuotient(1000, 10)).toBe(100);
  });
});

function grid(n: number, voters = 100): UnitRecord[] {
  const units: UnitRecord[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      units.push({
        mun: 1000 + y * n + x,
        zone: 1,
        lat: -10 + y * 0.1,
        lon: -50 + x * 0.1,
        voters,
      });
    }
  }
  return units;
}

describe('planDistricts', () => {
  it('divide em distritos balanceados e não vazios', () => {
    const units = grid(6);
    const plan = planDistricts(units, 4);
    expect(plan.count).toBe(4);
    expect(plan.voters).toEqual([900, 900, 900, 900]);
    expect(plan.maxDeviationPct).toBe(0);
  });

  it('é determinístico', () => {
    const units = grid(7, 37);
    const a = planDistricts(units, 5);
    const b = planDistricts(units, 5);
    expect(Array.from(a.unitDistrict)).toEqual(Array.from(b.unitDistrict));
  });

  it('nunca produz mais distritos que unidades', () => {
    const plan = planDistricts(grid(2), 10);
    expect(plan.count).toBe(4);
  });

  it('mantém todos os distritos com ao menos uma unidade mesmo com pesos desiguais', () => {
    const units = grid(3).map((u, i) => ({ ...u, voters: i === 0 ? 10000 : 10 }));
    const plan = planDistricts(units, 5);
    expect(new Set(plan.unitDistrict).size).toBe(5);
  });
});

/** Estado sintético com 3 partidos, 4x4 zonas: A forte no oeste, B forte no leste, C uniforme. */
function syntheticDataset(seats: number): Dataset {
  const units = grid(4, 1000);
  const comps = ['A', 'B', 'C'].map((id) => ({
    id,
    label: id,
    parties: [id],
    legend: 0,
    legendByParty: {} as Record<string, number>,
    legendByUnit: [] as number[],
  }));
  const candidates: Dataset['candidates'] = [];
  let n = 0;
  const add = (comp: number, name: string, base: (x: number) => number) => {
    const u: number[] = [];
    let total = 0;
    units.forEach((_, i) => {
      const x = i % 4;
      const v = Math.round(base(x));
      u.push(i, v);
      total += v;
    });
    candidates.push({
      id: String(n++),
      name,
      number: n,
      party: comps[comp]?.id ?? '',
      comp,
      votes: total,
      u,
      status: 'NAO',
    });
  };
  add(0, 'A1', (x) => 400 - x * 100);
  add(0, 'A2', (x) => 100 - x * 20);
  add(1, 'B1', (x) => 100 + x * 100);
  add(1, 'B2', (x) => 20 + x * 20);
  add(2, 'C1', () => 150);
  add(2, 'C2', () => 40);
  add(0, 'A3', (x) => 60 - x * 10);
  add(0, 'A4', (x) => 30 - x * 5);
  add(1, 'B3', (x) => 50 + x * 10);
  add(1, 'B4', (x) => 10 + x * 5);
  add(2, 'C3', () => 25);
  const validVotes = candidates.reduce((a, c) => a + c.votes, 0);
  return {
    schema: 1,
    key: 'XX',
    year: 2026,
    office: 'state',
    area: { kind: 'state', code: 'XX', name: 'Sintético', uf: 'XX' },
    seats,
    electorate: 16000,
    validVotes,
    units,
    competitors: comps,
    candidates,
  };
}

describe('simulate', () => {
  const ds = syntheticDataset(8);

  it.each(SYSTEM_IDS.filter((s) => s !== 'atual'))(
    '%s distribui exatamente as cadeiras',
    (system) => {
      const r = simulate(ds, system);
      expect(r.seats).toBe(8 + r.overhangSeats);
      expect(r.winners).toHaveLength(r.seats);
      expect(Object.values(r.seatsByParty).reduce((a, b) => a + b, 0)).toBe(r.seats);
      expect(new Set(r.winners.map((w) => w.name)).size).toBe(r.seats);
    },
  );

  it("lista fechada é proporcional aos votos (D'Hondt)", () => {
    const totals = [0, 1, 2].map((c) =>
      ds.candidates.filter((x) => x.comp === c).reduce((a, x) => a + x.votes, 0),
    );
    const expected = highestAverages(totals, 8);
    const r = simulate(ds, 'lista-fechada');
    expect(['A', 'B', 'C'].map((p) => r.seatsByParty[p] ?? 0)).toEqual(expected);
  });

  it('distritão elege os mais votados', () => {
    const r = simulate(ds, 'distritao');
    const top = [...ds.candidates]
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 8)
      .map((c) => c.name);
    expect(r.winners.map((w) => w.name).sort()).toEqual(top.sort());
  });

  it('distrital puro: 1 cadeira por distrito e distritos equilibrados', () => {
    const r = simulate(ds, 'distrital-puro');
    expect(r.districts).toHaveLength(8);
    expect(r.maxDistrictDeviationPct).toBe(0);
    expect(r.unitDistrict).toHaveLength(16);
  });

  it('distrital misto (PEC 2/2025): metade das cadeiras em distritos, arredondada para cima', () => {
    expect(mixedDistrictSeats(8)).toBe(4);
    expect(mixedDistrictSeats(9)).toBe(5);
    expect(mixedDistrictSeats(70)).toBe(35);
    const r = simulate(ds, 'distrital-misto');
    expect(r.districtSeats).toBe(4);
    expect(r.listSeats).toBe(r.seats - 4);
  });

  it('distrital misto é mais proporcional que o distrital puro', () => {
    const votes = partyVotes(ds);
    const mixed = simulate(ds, 'distrital-misto');
    const pure = simulate(ds, 'distrital-puro');
    expect(computeMetrics(mixed.seatsByParty, votes, mixed.seats).gallagher).toBeLessThanOrEqual(
      computeMetrics(pure.seatsByParty, votes, 8).gallagher,
    );
  });

  it('resultado oficial usa o status do TSE', () => {
    const copy: Dataset = {
      ...ds,
      candidates: ds.candidates.map((c, i) => ({ ...c, status: i < 3 ? 'QP' : 'NAO' })),
    };
    expect(officialResult(copy).winners).toHaveLength(3);
  });

  it('mergeResults soma circunscrições', () => {
    const a = simulate(ds, 'lista-fechada');
    const m = mergeResults('BR', 'lista-fechada', [a, a]);
    expect(m.seats).toBe(16);
    expect(Object.values(m.seatsByParty).reduce((x, y) => x + y, 0)).toBe(16);
  });
});

describe('allocateOpenList', () => {
  const ds = syntheticDataset(8);

  it('elege exatamente as cadeiras e respeita a barreira de 10% do QE', () => {
    const elected = allocateOpenList(ds, RULES_STF_2024);
    expect(elected).toHaveLength(8);
    expect(new Set(elected.map((e) => e.candidate)).size).toBe(8);
  });

  it('regras da Lei 14.211 também fecham o total', () => {
    expect(allocateOpenList(ds, RULES_LEI_14211)).toHaveLength(8);
  });
});

describe('metrics', () => {
  it('Gallagher é 0 quando proporcional', () => {
    expect(gallagher([0.5, 0.3, 0.2], [0.5, 0.3, 0.2])).toBe(0);
  });

  it('Gallagher de exemplo conhecido', () => {
    // votos 50/30/20, cadeiras 60/30/10 -> sqrt((100+0+100)/2) = 10
    expect(gallagher([0.5, 0.3, 0.2], [0.6, 0.3, 0.1])).toBeCloseTo(10, 10);
  });

  it('número efetivo de partidos', () => {
    expect(effectiveNumber([0.5, 0.5])).toBeCloseTo(2);
    expect(effectiveNumber([1])).toBeCloseTo(1);
  });

  it('partidos para maioria e votos sem cadeira', () => {
    const m = computeMetrics({ A: 50, B: 30, C: 20 }, { A: 40, B: 30, C: 20, D: 10 }, 100);
    expect(m.majority).toBe(51);
    expect(m.partiesForMajority).toBe(2);
    expect(m.votesWithoutSeatPct).toBeCloseTo(10);
    expect(m.partiesWithSeats).toBe(3);
  });
});

/** Duas zonas distantes (dois distritos no distrital puro com 2 cadeiras). */
function twoZoneDataset(
  seats: number,
  cands: Array<[comp: number, name: string, zone0: number, zone1: number]>,
  legend: number[] = [],
): Dataset {
  const units: UnitRecord[] = [
    { mun: 1, zone: 1, lat: -10, lon: -50, voters: 1000 },
    { mun: 2, zone: 1, lat: -10, lon: -40, voters: 1000 },
  ];
  const ids = ['X', 'Y', 'Z'];
  const competitors = ids.map((id, c) => ({
    id,
    label: id,
    parties: [id],
    legend: legend[c] ?? 0,
    legendByParty: { [id]: legend[c] ?? 0 },
    legendByUnit: legend[c] ? [0, legend[c] as number] : [],
  }));
  const candidates: Dataset['candidates'] = cands.map(([comp, name, v0, v1], i) => ({
    id: String(i),
    name,
    number: i + 1,
    party: ids[comp] as string,
    comp,
    votes: v0 + v1,
    u: [0, v0, 1, v1],
    status: 'NAO',
  }));
  const validVotes =
    candidates.reduce((a, c) => a + c.votes, 0) + legend.reduce((a, b) => a + b, 0);
  return {
    schema: 1,
    key: 'YY',
    year: 2026,
    office: 'state',
    area: { kind: 'state', code: 'YY', name: 'Duas zonas', uf: 'YY' },
    seats,
    electorate: 2000,
    validVotes,
    units,
    competitors,
    candidates,
  };
}

describe('regra distrital', () => {
  it('vence o candidato mais votado, não o partido com mais votos somados', () => {
    // Na zona 0, X soma 120 votos em dois candidatos, mas Y1 tem a maior votação individual.
    const ds = twoZoneDataset(2, [
      [0, 'X1', 60, 0],
      [0, 'X2', 60, 0],
      [1, 'Y1', 100, 0],
      [2, 'Z1', 0, 50],
    ]);
    const r = simulate(ds, 'distrital-puro');
    expect(r.winners.map((w) => w.name).sort()).toEqual(['Y1', 'Z1']);
  });

  it('cada candidato disputa só o distrito da sua maior votação', () => {
    // X1 é o mais votado nas duas zonas, mas concorre só na zona 0; a zona 1 fica com Y1.
    const ds = twoZoneDataset(2, [
      [0, 'X1', 300, 200],
      [1, 'Y1', 10, 150],
    ]);
    const r = simulate(ds, 'distrital-puro');
    const byDistrict = Object.fromEntries(r.winners.map((w) => [w.name, w.district]));
    expect(byDistrict.X1).not.toBe(byDistrict.Y1);
    expect(r.winners.map((w) => w.name).sort()).toEqual(['X1', 'Y1']);
  });

  it('distrital misto: vitórias distritais além da cota proporcional aumentam a casa (§ 4º)', () => {
    // X vence os 2 distritos com poucos votos; Y tem a maior votação partidária (legenda).
    const ds = twoZoneDataset(
      4,
      [
        [0, 'X1', 100, 0],
        [0, 'X2', 0, 100],
        [1, 'Y1', 90, 0],
        [1, 'Y2', 0, 90],
        [1, 'Y3', 1, 0],
        [1, 'Y4', 0, 1],
      ],
      [0, 1000],
    );
    const r = simulate(ds, 'distrital-misto');
    expect(r.districtSeats).toBe(2);
    expect(r.seatsByParty).toEqual({ X: 2, Y: 4 });
    expect(r.overhangSeats).toBe(2);
    expect(r.seats).toBe(6);
  });
});
