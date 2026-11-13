import { describe, expect, it } from 'vitest';
import { districtPlanFor, tallyDistricts } from '../src/systems/districts.js';
import { partitionGraph, type PartitionNode } from '../src/systems/partition.js';
import type { Dataset } from '../src/types.js';

/** Grade n×n com vizinhança de 4 e pesos dados por `weight(x, y)`. */
function gridGraph(n: number, weight: (x: number, y: number) => number) {
  const nodes: PartitionNode[] = [];
  const adj: number[][] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      nodes.push({ x, y, w: weight(x, y) });
      const list: number[] = [];
      if (x > 0) list.push(y * n + x - 1);
      if (x < n - 1) list.push(y * n + x + 1);
      if (y > 0) list.push((y - 1) * n + x);
      if (y < n - 1) list.push((y + 1) * n + x);
      adj.push(list);
    }
  }
  return { nodes, adj };
}

/** Cada distrito forma um único bloco conexo no grafo. */
function contiguous(assignment: Int32Array, adj: readonly (readonly number[])[], k: number) {
  for (let d = 0; d < k; d++) {
    const members = [...assignment.keys()].filter((i) => assignment[i] === d);
    if (!members.length) return false;
    const seen = new Set([members[0] as number]);
    const stack = [members[0] as number];
    while (stack.length) {
      const i = stack.pop() as number;
      for (const j of adj[i] ?? []) {
        if (assignment[j] === d && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    if (seen.size !== members.length) return false;
  }
  return true;
}

describe('partitionGraph', () => {
  it('produz distritos contíguos dentro de ±5% da cota', () => {
    const { nodes, adj } = gridGraph(16, (x, y) => 50 + ((x * 7 + y * 13) % 11) * 10);
    const part = partitionGraph(nodes, adj, 10);
    expect(part.count).toBe(10);
    expect(part.maxDeviation).toBeLessThanOrEqual(0.05);
    expect(contiguous(part.assignment, adj, 10)).toBe(true);
  });

  it('equilibra uma cidade densa cercada de área rural', () => {
    const { nodes, adj } = gridGraph(20, (x, y) => (Math.hypot(x - 6, y - 6) < 4 ? 400 : 20));
    const part = partitionGraph(nodes, adj, 8);
    expect(part.maxDeviation).toBeLessThanOrEqual(0.1);
    expect(contiguous(part.assignment, adj, 8)).toBe(true);
  });

  it('é determinístico', () => {
    const { nodes, adj } = gridGraph(12, (x, y) => 10 + ((x * y) % 5));
    const a = partitionGraph(nodes, adj, 6);
    const b = partitionGraph(nodes, adj, 6);
    expect(Array.from(a.assignment)).toEqual(Array.from(b.assignment));
  });

  it('liga ilhas (componentes sem aresta) ao nó mais próximo', () => {
    const { nodes, adj } = gridGraph(8, () => 10);
    nodes.push({ x: 9, y: 9, w: 10 });
    adj.push([]);
    const part = partitionGraph(nodes, adj, 4);
    expect(new Set(part.assignment).size).toBe(4);
    expect(part.maxDeviation).toBeLessThanOrEqual(0.1);
  });
});

describe('distritos com municípios divididos', () => {
  /** Dois municípios: a unidade 0 tem locais nos distritos 0 e 1 (30% e 70% dos eleitores). */
  const ds: Dataset = {
    schema: 1,
    key: 'XX',
    year: 2026,
    office: 'state',
    area: { kind: 'state', code: 'XX', name: 'Teste', uf: 'XX' },
    seats: 2,
    electorate: 200,
    validVotes: 200,
    units: [
      { mun: 1, zone: 1, lat: 0, lon: 0, voters: 100, pop: 1000 },
      { mun: 2, zone: 1, lat: 0, lon: 1, voters: 100, pop: 1000 },
    ],
    competitors: [
      { id: 'A', label: 'A', parties: ['A'], legend: 0, legendByParty: {}, legendByUnit: [] },
    ],
    candidates: [
      {
        id: '1',
        name: 'X',
        number: 1,
        party: 'A',
        comp: 0,
        votes: 200,
        u: [0, 100, 1, 100],
        status: 'NAO',
      },
    ],
    districtPlans: {
      '2': {
        unitDistrict: [1, 1],
        labels: [{ main: 'Um' }, { main: 'Dois' }],
        points: [
          [0, 0, 0, 30, 0],
          [0, 0.1, 1, 70, 0],
        ],
      },
    },
  };

  it('reparte eleitores, população e votos da unidade pelas frações dos locais', () => {
    const plan = districtPlanFor(ds, 2);
    expect(plan.shares.get(0)).toEqual([
      [0, 0.3],
      [1, 0.7],
    ]);
    expect(plan.voters).toEqual([30, 170]);
    expect(plan.population).toEqual([300, 1700]);
    const tally = tallyDistricts(ds, plan);
    expect(tally.candVotes[0]?.get(0)).toBeCloseTo(30);
    expect(tally.candVotes[1]?.get(0)).toBeCloseTo(170);
  });
});
