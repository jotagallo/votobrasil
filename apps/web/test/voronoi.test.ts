import { describe, expect, it } from 'vitest';
import type { UnitPoint } from '@votobr/shared';
import {
  dedupePoints,
  districtBoundaries,
  segmentsPath,
  weightedCentroids,
  labelAnchors,
  ringArea,
  voronoiDistricts,
  type DistrictCell,
} from '../src/lib/voronoi';

describe('dedupePoints', () => {
  it('une locais com a mesma coordenada, somando eleitores e usando o distrito dominante', () => {
    const units: UnitPoint[] = [
      [-46.6, -23.5, 0, 100, 1],
      [-46.6, -23.5, 1, 300, 1],
      [-46.7, -23.6, 1, 50, 1],
    ];
    expect(dedupePoints(units)).toEqual([
      { lon: -46.6, lat: -23.5, district: 1, voters: 400 },
      { lon: -46.7, lat: -23.6, district: 1, voters: 50 },
    ]);
  });
});

describe('districtBoundaries', () => {
  const square = (x: number, district: number): DistrictCell => ({
    district,
    ring: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
      [x, 0],
    ],
  });

  it('encontra a aresta compartilhada entre distritos distintos e a adjacência', () => {
    const { segments, adjacency } = districtBoundaries([square(0, 0), square(10, 1)]);
    expect(segments).toHaveLength(1);
    expect(adjacency).toEqual([[0, 1]]);
    const [x1, , x2] = segments[0] as [number, number, number, number];
    expect(x1).toBe(10);
    expect(x2).toBe(10);
  });

  it('não considera fronteira a aresta entre células do mesmo distrito', () => {
    const { segments, adjacency } = districtBoundaries([square(0, 0), square(10, 0)]);
    expect(segments).toEqual([]);
    expect(adjacency).toEqual([]);
  });

  it('gera um caminho SVG com um segmento por aresta', () => {
    expect(segmentsPath([[0, 0, 10, 5]])).toBe('M0.0,0.0L10.0,5.0');
    expect(segmentsPath([])).toBe('');
  });
});

describe('weightedCentroids', () => {
  it('pondera por eleitores e agrupa por distrito', () => {
    const centroids = weightedCentroids([
      { x: 0, y: 0, district: 0, voters: 100 },
      { x: 10, y: 10, district: 0, voters: 300 },
      { x: 5, y: 5, district: 1, voters: 0 },
    ]);
    expect(centroids.get(0)).toEqual({ x: 7.5, y: 7.5 });
    expect(centroids.get(1)).toEqual({ x: 5, y: 5 });
  });
});

describe('labelAnchors', () => {
  it('usa um ponto do próprio distrito, mesmo quando o centro ponderado cai fora (forma de "C")', () => {
    const anchors = labelAnchors([
      { x: 0, y: 0, district: 0, voters: 100 },
      { x: 10, y: 0, district: 0, voters: 100 },
      { x: 0, y: 10, district: 0, voters: 100 },
      { x: 10, y: 10, district: 0, voters: 100 },
      { x: 3, y: 3, district: 1, voters: 5 },
    ]);
    expect(anchors.get(0)).toEqual({ x: 0, y: 0 });
    expect(anchors.get(1)).toEqual({ x: 3, y: 3 });
  });
});

describe('voronoiDistricts', () => {
  it('agrupa as células por distrito, com área e extensão dentro do recorte', () => {
    const result = voronoiDistricts(
      [
        { x: 25, y: 50, district: 0, voters: 1 },
        { x: 75, y: 50, district: 1, voters: 1 },
      ],
      [0, 0, 100, 100],
    );
    expect(result.areas.get(0)).toBeCloseTo(5000);
    expect(result.areas.get(1)).toBeCloseTo(5000);
    expect(result.boxes.get(0)).toEqual([0, 0, 50, 100]);
    expect(result.boundaries.adjacency).toEqual([[0, 1]]);
    expect(result.paths.size).toBe(2);
  });
});

describe('ringArea', () => {
  it('calcula a área de um polígono fechado', () => {
    expect(
      ringArea([
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
        [0, 0],
      ]),
    ).toBe(50);
  });
});
