import { Delaunay } from 'd3-delaunay';
import type { UnitPoint } from '@votobr/shared';

export interface DistrictPoint {
  lon: number;
  lat: number;
  district: number;
  voters: number;
}

/**
 * Locais de votação com a mesma coordenada viram um só ponto (o Voronoi não distingue pontos
 * coincidentes): soma de eleitores e distrito com mais eleitores no ponto.
 */
export function dedupePoints(units: readonly UnitPoint[]): DistrictPoint[] {
  const groups = new Map<string, { lon: number; lat: number; voters: Map<number, number> }>();
  for (const [lon, lat, district, voters] of units) {
    const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
    let group = groups.get(key);
    if (!group) {
      group = { lon, lat, voters: new Map() };
      groups.set(key, group);
    }
    group.voters.set(district, (group.voters.get(district) ?? 0) + voters);
  }
  const out: DistrictPoint[] = [];
  for (const group of groups.values()) {
    let best = -1;
    let bestVoters = -1;
    let total = 0;
    for (const [district, voters] of group.voters) {
      total += voters;
      if (voters > bestVoters || (voters === bestVoters && district < best)) {
        best = district;
        bestVoters = voters;
      }
    }
    out.push({ lon: group.lon, lat: group.lat, district: best, voters: total });
  }
  return out;
}

export type Ring = ReadonlyArray<readonly [number, number]>;

export interface DistrictCell {
  district: number;
  ring: Ring;
}

export interface BoundaryResult {
  /** Segmentos [x1, y1, x2, y2] entre células de distritos diferentes. */
  segments: Array<[number, number, number, number]>;
  /** Pares de distritos vizinhos (a < b). */
  adjacency: Array<[number, number]>;
}

function pointKey(x: number, y: number): string {
  return `${Math.round(x * 100)}:${Math.round(y * 100)}`;
}

/** Arestas compartilhadas por células de distritos distintos (fronteiras internas dos distritos). */
export function districtBoundaries(cells: readonly DistrictCell[]): BoundaryResult {
  const edges = new Map<
    string,
    { segment: [number, number, number, number]; districts: Set<number>; count: number }
  >();
  for (const cell of cells) {
    const ring = cell.ring;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || !b) continue;
      const ka = pointKey(a[0], a[1]);
      const kb = pointKey(b[0], b[1]);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let entry = edges.get(key);
      if (!entry) {
        entry = { segment: [a[0], a[1], b[0], b[1]], districts: new Set(), count: 0 };
        edges.set(key, entry);
      }
      entry.districts.add(cell.district);
      entry.count++;
    }
  }
  const segments: BoundaryResult['segments'] = [];
  const pairs = new Map<string, [number, number]>();
  for (const entry of edges.values()) {
    if (entry.districts.size < 2) continue;
    segments.push(entry.segment);
    const [a, b] = [...entry.districts].sort((x, y) => x - y);
    if (a !== undefined && b !== undefined) pairs.set(`${a}-${b}`, [a, b]);
  }
  return { segments, adjacency: [...pairs.values()] };
}

export function segmentsPath(segments: BoundaryResult['segments']): string {
  return segments
    .map(
      ([x1, y1, x2, y2]) => `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`,
    )
    .join('');
}

/** Centro de cada distrito, ponderado por eleitores (posição do rótulo). */
export function weightedCentroids(
  points: ReadonlyArray<{ x: number; y: number; district: number; voters: number }>,
): Map<number, { x: number; y: number }> {
  const sums = new Map<number, { x: number; y: number; w: number }>();
  for (const p of points) {
    const w = Math.max(1, p.voters);
    const sum = sums.get(p.district) ?? { x: 0, y: 0, w: 0 };
    sum.x += p.x * w;
    sum.y += p.y * w;
    sum.w += w;
    sums.set(p.district, sum);
  }
  const out = new Map<number, { x: number; y: number }>();
  for (const [district, sum] of sums) out.set(district, { x: sum.x / sum.w, y: sum.y / sum.w });
  return out;
}

/**
 * Posição do rótulo de cada distrito: o ponto do próprio distrito mais próximo do centro
 * ponderado. Garante que o rótulo caia dentro do distrito mesmo quando ele tem forma de "C".
 */
export function labelAnchors(
  points: ReadonlyArray<{ x: number; y: number; district: number; voters: number }>,
): Map<number, { x: number; y: number }> {
  const centers = weightedCentroids(points);
  const best = new Map<number, { x: number; y: number; d: number }>();
  for (const p of points) {
    const c = centers.get(p.district);
    if (!c) continue;
    const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    const current = best.get(p.district);
    if (!current || d < current.d) best.set(p.district, { x: p.x, y: p.y, d });
  }
  return new Map([...best].map(([district, { x, y }]) => [district, { x, y }]));
}

/** Retângulo [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

export function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return [...b];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function ringBox(ring: Ring): Box {
  let box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring)
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  return box;
}

export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function intersectBox(a: Box, b: Box): Box {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

export interface ProjectedPoint {
  x: number;
  y: number;
  district: number;
  voters: number;
}

export interface VoronoiDistricts {
  /** Caminho SVG das células de cada distrito. */
  paths: Map<number, string>;
  /** Área das células de cada distrito (dentro de `bounds`). */
  areas: Map<number, number>;
  /** Extensão das células de cada distrito (dentro de `bounds`). */
  boxes: Map<number, Box>;
  boundaries: BoundaryResult;
}

/**
 * Células de Voronoi dos pontos, agrupadas por distrito, dentro de `bounds`. O recorte fino pelo
 * contorno real (município ou cidade) fica a cargo do `clipPath` no SVG.
 */
export function voronoiDistricts(points: readonly ProjectedPoint[], bounds: Box): VoronoiDistricts {
  const voronoi = Delaunay.from(
    points,
    (p) => p.x,
    (p) => p.y,
  ).voronoi(bounds);
  const cells: DistrictCell[] = [];
  const parts = new Map<number, string[]>();
  const areas = new Map<number, number>();
  const boxes = new Map<number, Box>();
  points.forEach((p, i) => {
    const ring = voronoi.cellPolygon(i) as Ring | null;
    if (!ring) return;
    cells.push({ district: p.district, ring });
    const list = parts.get(p.district) ?? [];
    list.push(`M${ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`);
    parts.set(p.district, list);
    areas.set(p.district, (areas.get(p.district) ?? 0) + ringArea(ring));
    boxes.set(p.district, unionBox(boxes.get(p.district), intersectBox(ringBox(ring), bounds)));
  });
  return {
    paths: new Map([...parts].map(([d, list]) => [d, list.join('')])),
    areas,
    boxes,
    boundaries: districtBoundaries(cells),
  };
}
