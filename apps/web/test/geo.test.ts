import { describe, expect, it } from 'vitest';
import { geoArea } from 'd3-geo';
import type { Polygon } from 'geojson';
import type { Topology } from 'topojson-specification';
import { collectionOf, fixWinding, singleFeature } from '../src/lib/geo';

// Anel externo horário (convenção do d3-geo): área esférica pequena.
const CLOCKWISE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-50, -20],
      [-50, -10],
      [-40, -10],
      [-40, -20],
      [-50, -20],
    ],
  ],
};

const COUNTER_CLOCKWISE: Polygon = {
  type: 'Polygon',
  coordinates: [[...CLOCKWISE.coordinates[0]!].reverse()],
};

describe('fixWinding', () => {
  it('mantém um polígono já no enrolamento do d3-geo', () => {
    expect(geoArea(CLOCKWISE)).toBeLessThan(1);
    expect(fixWinding(CLOCKWISE)).toBe(CLOCKWISE);
  });

  it('inverte um polígono cujo anel externo está anti-horário', () => {
    expect(geoArea(COUNTER_CLOCKWISE)).toBeGreaterThan(2 * Math.PI);
    const fixed = fixWinding(COUNTER_CLOCKWISE);
    expect(geoArea(fixed)).toBeCloseTo(geoArea(CLOCKWISE), 10);
  });

  it('corrige só o polígono invertido de um MultiPolygon', () => {
    const fixed = fixWinding({
      type: 'MultiPolygon',
      coordinates: [CLOCKWISE.coordinates, COUNTER_CLOCKWISE.coordinates],
    });
    expect(geoArea(fixed)).toBeCloseTo(2 * geoArea(CLOCKWISE), 10);
  });

  it('percorre GeometryCollection', () => {
    const fixed = fixWinding({ type: 'GeometryCollection', geometries: [COUNTER_CLOCKWISE] });
    expect(geoArea(fixed)).toBeCloseTo(geoArea(CLOCKWISE), 10);
  });
});

describe('collectionOf / singleFeature', () => {
  const topology: Topology = {
    type: 'Topology',
    arcs: [
      [
        [-50, -20],
        [-50, -10],
        [-40, -10],
        [-40, -20],
        [-50, -20],
      ],
      [
        [-30, -20],
        [-40, -20],
        [-40, -10],
        [-30, -10],
        [-30, -20],
      ],
    ],
    objects: {
      states: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', arcs: [[0]], properties: { id: 'XX' } },
          { type: 'Polygon', arcs: [[1]], properties: { id: 'YY' } },
        ],
      },
      city: { type: 'Polygon', arcs: [[0]], properties: { id: '1' } },
    },
  };

  it('devolve todas as feições com área pequena, mesmo se algum anel vier invertido', () => {
    const collection = collectionOf(topology, 'states');
    expect(collection?.features).toHaveLength(2);
    for (const feat of collection!.features) expect(geoArea(feat)).toBeLessThan(1);
  });

  it('devolve null para objeto inexistente', () => {
    expect(collectionOf(topology, 'nada')).toBeNull();
    expect(singleFeature(topology, 'nada')).toBeNull();
  });

  it('singleFeature funde coleções em uma feição', () => {
    const single = singleFeature(topology, 'states');
    expect(single?.geometry.type).toBe('GeometryCollection');
    expect(geoArea(single!)).toBeLessThan(1);
    expect(singleFeature(topology, 'city')?.properties?.id).toBe('1');
  });
});
