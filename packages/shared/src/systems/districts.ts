import type { Dataset, DistrictLabel, PlanPoint, UnitRecord } from '../types.js';
import { kdPartition } from './partition.js';

export interface DistrictPlan {
  /** Distrito (0..k-1) de cada unidade (o da maior parte dos eleitores, se repartida). */
  unitDistrict: Int32Array;
  /** Unidades repartidas entre distritos → pares [distrito, fração dos eleitores]. */
  shares: Map<number, [number, number][]>;
  /** Locais de votação dos municípios divididos (ver `DistrictPlanRecord.points`). */
  points: PlanPoint[];
  count: number;
  /** Eleitores por distrito. */
  voters: number[];
  /** População por distrito (Censo 2022; eleitores quando a população não está disponível). */
  population: number[];
  /** Maior desvio relativo (%) entre a população de um distrito e a média. */
  maxDeviationPct: number;
  labels?: DistrictLabel[];
}

const weightOf = (u: UnitRecord) => u.pop ?? u.voters;

/** Frações de cada unidade presente em `points` (só as que caem em mais de um distrito). */
function sharesOf(points: readonly PlanPoint[]): Map<number, [number, number][]> {
  const byUnit = new Map<number, Map<number, number>>();
  for (const [, , d, v, unit] of points) {
    const m = byUnit.get(unit) ?? new Map<number, number>();
    m.set(d, (m.get(d) ?? 0) + Math.max(v, 0));
    byUnit.set(unit, m);
  }
  const out = new Map<number, [number, number][]>();
  for (const [unit, m] of byUnit) {
    if (m.size < 2) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    out.set(
      unit,
      [...m.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([d, v]) => [d, v / total] as [number, number]),
    );
  }
  return out;
}

/** Chama `fn(distrito, fração)` para cada distrito em que a unidade `i` tem eleitores. */
export function forEachShare(
  plan: DistrictPlan,
  i: number,
  fn: (district: number, share: number) => void,
): void {
  const split = plan.shares.get(i);
  if (!split) {
    fn(plan.unitDistrict[i] as number, 1);
    return;
  }
  for (const [d, f] of split) fn(d, f);
}

function finishPlan(
  units: readonly UnitRecord[],
  unitDistrict: Int32Array,
  count: number,
  labels?: DistrictLabel[],
  points: PlanPoint[] = [],
): DistrictPlan {
  const voters = new Array<number>(count).fill(0);
  const population = new Array<number>(count).fill(0);
  const plan: DistrictPlan = {
    unitDistrict,
    shares: sharesOf(points),
    points,
    count,
    voters,
    population,
    maxDeviationPct: 0,
    labels,
  };
  units.forEach((u, i) => {
    forEachShare(plan, i, (d, f) => {
      voters[d] = (voters[d] ?? 0) + u.voters * f;
      population[d] = (population[d] ?? 0) + weightOf(u) * f;
    });
  });
  const mean = population.reduce((a, b) => a + b, 0) / count;
  plan.maxDeviationPct =
    mean > 0 ? Math.max(...population.map((v) => (Math.abs(v - mean) / mean) * 100)) : 0;
  return plan;
}

/**
 * Fallback sem desenho pré-calculado: bisseção recursiva ponderada (k-d tree) sobre os centroides
 * das unidades — corta o eixo de maior extensão no ponto que melhor reparte a população entre os
 * dois lados. Compacto e equilibrado, mas sem garantia de contiguidade nem de municípios inteiros.
 */
export function planDistricts(units: readonly UnitRecord[], k: number): DistrictPlan {
  const count = Math.max(1, Math.min(k, units.length));
  const meanLat = units.reduce((a, u) => a + u.lat, 0) / Math.max(1, units.length);
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const unitDistrict = kdPartition(
    units.map((u, id) => ({ id, x: u.lon * kx, y: u.lat, w: weightOf(u) })),
    count,
    units.length,
  );
  return finishPlan(units, unitDistrict, count);
}

/** Desenho de `k` distritos do dataset: o pré-calculado no ETL, se houver; senão, `planDistricts`. */
export function districtPlanFor(ds: Dataset, k: number): DistrictPlan {
  const stored = ds.districtPlans?.[String(k)];
  if (stored && stored.unitDistrict.length === ds.units.length) {
    return finishPlan(
      ds.units,
      Int32Array.from(stored.unitDistrict),
      k,
      stored.labels,
      stored.points,
    );
  }
  return planDistricts(ds.units, k);
}

export interface DistrictTally {
  /** votos por competidor em cada distrito. */
  compVotes: Map<number, number>[];
  /** votos por candidato em cada distrito. */
  candVotes: Map<number, number>[];
}

/**
 * Soma votos de cada competidor (nominais + legenda) e de cada candidato por distrito. Os votos
 * de uma unidade repartida entre distritos são divididos na proporção dos eleitores de cada parte
 * (a menor desagregação oficial dos votos é a zona eleitoral).
 */
export function tallyDistricts(ds: Dataset, plan: DistrictPlan): DistrictTally {
  const compVotes = Array.from({ length: plan.count }, () => new Map<number, number>());
  const candVotes = Array.from({ length: plan.count }, () => new Map<number, number>());
  ds.competitors.forEach((comp, c) => {
    const pairs = comp.legendByUnit;
    for (let i = 0; i < pairs.length; i += 2) {
      const v = pairs[i + 1] as number;
      forEachShare(plan, pairs[i] as number, (d, f) => {
        const map = compVotes[d] as Map<number, number>;
        map.set(c, (map.get(c) ?? 0) + v * f);
      });
    }
  });
  ds.candidates.forEach((cand, idx) => {
    const pairs = cand.u;
    for (let i = 0; i < pairs.length; i += 2) {
      const v = pairs[i + 1] as number;
      forEachShare(plan, pairs[i] as number, (d, f) => {
        const cm = compVotes[d] as Map<number, number>;
        cm.set(cand.comp, (cm.get(cand.comp) ?? 0) + v * f);
        const km = candVotes[d] as Map<number, number>;
        km.set(idx, (km.get(idx) ?? 0) + v * f);
      });
    }
  });
  return { compVotes, candVotes };
}

/**
 * Pontos do mapa [lon, lat, distrito, eleitores, município]: unidades inteiras e, no lugar das
 * unidades dos municípios divididos, os seus locais de votação.
 */
export function districtMapPoints(
  ds: Dataset,
  plan: DistrictPlan,
): [number, number, number, number, number][] {
  const covered = new Set(plan.points.map((p) => p[4]));
  const out: [number, number, number, number, number][] = [];
  ds.units.forEach((u, i) => {
    if (!covered.has(i)) out.push([u.lon, u.lat, plan.unitDistrict[i] as number, u.voters, u.mun]);
  });
  for (const [lon, lat, d, v, unit] of plan.points) {
    out.push([lon, lat, d, v, ds.units[unit]?.mun ?? 0]);
  }
  return out;
}
