import type { DistrictLabel, UnitPoint, Winner } from '@votobr/shared';
import type { Box } from './voronoi';

export interface MunicipalityDistrict {
  mun: number;
  /** Distrito com mais eleitores no município (empate: menor número). */
  district: number;
  /** Município com unidades em mais de um distrito. */
  split: boolean;
  /** Distritos presentes, em ordem crescente. */
  districts: number[];
  voters: number;
}

/**
 * Para cada município, o distrito dominante (maioria dos eleitores de suas unidades) e se há
 * divisão entre distritos.
 */
export function dominantDistricts(units: readonly UnitPoint[]): Map<number, MunicipalityDistrict> {
  const votersByMun = new Map<number, Map<number, number>>();
  for (const [, , district, voters, mun] of units) {
    let byDistrict = votersByMun.get(mun);
    if (!byDistrict) {
      byDistrict = new Map();
      votersByMun.set(mun, byDistrict);
    }
    byDistrict.set(district, (byDistrict.get(district) ?? 0) + voters);
  }
  const out = new Map<number, MunicipalityDistrict>();
  for (const [mun, byDistrict] of votersByMun) {
    let best = -1;
    let bestVoters = -1;
    let total = 0;
    for (const [district, voters] of byDistrict) {
      total += voters;
      if (voters > bestVoters || (voters === bestVoters && district < best)) {
        best = district;
        bestVoters = voters;
      }
    }
    out.set(mun, {
      mun,
      district: best,
      split: byDistrict.size > 1,
      districts: [...byDistrict.keys()].sort((a, b) => a - b),
      voters: total,
    });
  }
  return out;
}

export interface DistrictSummary {
  id: number;
  voters: number;
  units: number;
  municipalities: number;
}

export function summarizeDistricts(units: readonly UnitPoint[]): DistrictSummary[] {
  const map = new Map<number, { voters: number; units: number; muns: Set<number> }>();
  for (const [, , district, voters, mun] of units) {
    let entry = map.get(district);
    if (!entry) {
      entry = { voters: 0, units: 0, muns: new Set() };
      map.set(district, entry);
    }
    entry.voters += voters;
    entry.units += 1;
    entry.muns.add(mun);
  }
  return [...map.entries()]
    .map(([id, e]) => ({ id, voters: e.voters, units: e.units, municipalities: e.muns.size }))
    .sort((a, b) => a.id - b.id);
}

/**
 * Coloração gulosa: cada distrito recebe o menor índice de cor que nenhum vizinho usa, para que
 * distritos adjacentes tenham cores diferentes com uma paleta curta.
 */
export function greedyColoring(
  count: number,
  edges: Iterable<readonly [number, number]>,
): number[] {
  const neighbors: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= count || b >= count) continue;
    neighbors[a]?.add(b);
    neighbors[b]?.add(a);
  }
  const colors = new Array<number>(count).fill(-1);
  // Mais vizinhos primeiro (heurística de Welsh–Powell) usa menos cores.
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (neighbors[b]?.size ?? 0) - (neighbors[a]?.size ?? 0) || a - b,
  );
  for (const d of order) {
    const taken = new Set<number>();
    for (const n of neighbors[d] ?? []) {
      const c = colors[n];
      if (c !== undefined && c >= 0) taken.add(c);
    }
    let c = 0;
    while (taken.has(c)) c++;
    colors[d] = c;
  }
  return colors;
}

function winnerKey(w: Winner): string {
  return `${w.name}|${w.party}|${w.votes}`;
}

export interface WinnersDiff {
  /** Eleitos só no cenário. */
  gained: Winner[];
  /** Eleitos oficialmente que perderiam a cadeira. */
  lost: Winner[];
  /** Eleitos nos dois. */
  kept: number;
}

export function diffWinners(baseline: readonly Winner[], scenario: readonly Winner[]): WinnersDiff {
  const remaining = new Map<string, number>();
  for (const w of baseline) remaining.set(winnerKey(w), (remaining.get(winnerKey(w)) ?? 0) + 1);
  const gained: Winner[] = [];
  let kept = 0;
  for (const w of scenario) {
    const key = winnerKey(w);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      kept++;
    } else {
      gained.push(w);
    }
  }
  const lost: Winner[] = [];
  const pending = new Map(remaining);
  for (const w of baseline) {
    const key = winnerKey(w);
    const left = pending.get(key) ?? 0;
    if (left > 0) {
      lost.push(w);
      pending.set(key, left - 1);
    }
  }
  const byVotes = (a: Winner, b: Winner) => b.votes - a.votes || a.name.localeCompare(b.name);
  return { gained: gained.sort(byVotes), lost: lost.sort(byVotes), kept };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Nome de referência do distrito: "Campinas e mais 4 municípios", "São Paulo (Itaquera,
 * Guaianases)" ou, nas cidades, os bairros principais ("Copacabana, Ipanema, Leblon").
 */
export function districtName(
  label: DistrictLabel | undefined,
  id: number,
  kind: 'state' | 'city',
  t: Translate,
): string {
  if (!label?.main) return t('districtMap.unnamed', { n: id + 1 });
  if (kind === 'city') return [label.main, ...(label.hoods ?? [])].join(', ');
  const base = label.hoods?.length ? `${label.main} (${label.hoods.join(', ')})` : label.main;
  if (!label.others) return base;
  return label.others === 1
    ? t('districtMap.plusOne', { name: base })
    : t('districtMap.plusMany', { name: base, count: label.others });
}

/** Texto sem acentos e em minúsculas, para a busca. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export interface ZoomView {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ZoomView = { k: 1, x: 0, y: 0 };

/**
 * Transformação (escala `k`, deslocamento `x`, `y`) que enquadra `box`, com folga, no `viewBox`.
 * Distritos que já ocupam boa parte do mapa não aproximam.
 */
export function fitView(box: Box, viewBox: Box, maxScale: number): ZoomView {
  const [vx0, vy0, vx1, vy1] = viewBox;
  const vw = vx1 - vx0;
  const vh = vy1 - vy0;
  const bw = Math.max(box[2] - box[0], vw / maxScale / 1.4);
  const bh = Math.max(box[3] - box[1], vh / maxScale / 1.4);
  const k = Math.min(maxScale, vw / (bw * 1.4), vh / (bh * 1.4));
  if (k < 1.25) return IDENTITY_VIEW;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return { k, x: vx0 + vw / 2 - k * cx, y: vy0 + vh / 2 - k * cy };
}

export interface BadgeCandidate {
  district: number;
  x: number;
  y: number;
  /** Área do distrito no mapa (já na escala do zoom). */
  area: number;
}

/**
 * Números do mapa: só nos distritos com área suficiente e sem sobrepor outro número, dos maiores
 * para os menores. O distrito em destaque (se houver) sempre aparece.
 */
export function placeBadges(
  candidates: readonly BadgeCandidate[],
  radius: number,
  viewBox: Box,
  active: number | null,
): BadgeCandidate[] {
  const minArea = (radius * 3.4) ** 2;
  const inside = (c: BadgeCandidate) =>
    c.x >= viewBox[0] + radius &&
    c.x <= viewBox[2] - radius &&
    c.y >= viewBox[1] + radius &&
    c.y <= viewBox[3] - radius;
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(b.district === active) - Number(a.district === active) ||
      b.area - a.area ||
      a.district - b.district,
  );
  const placed: BadgeCandidate[] = [];
  for (const c of ordered) {
    if (!inside(c)) continue;
    if (c.district !== active && c.area < minArea) continue;
    if (placed.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < radius * 2.3)) continue;
    placed.push(c);
  }
  return placed;
}
