import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';

export type GeoProps = { id?: string | number; name?: string; uf?: string };
export type GeoFeature = Feature<Geometry, GeoProps>;

/** Identificador da feição: `feature.id` (quando o TopoJSON usa id nativo) ou `properties.id`. */
export function featureId(f: Feature<Geometry, GeoProps | null>): string | number | undefined {
  return f.id ?? f.properties?.id;
}

const HEMISPHERE = 2 * Math.PI;

function reversePolygon(rings: Position[][]): Position[][] {
  return rings.map((ring) => [...ring].reverse());
}

/**
 * O d3-geo trata o enrolamento como parte da geometria: um polígono com anel externo anti-horário
 * vira o "complemento" da esfera (área ≈ 4π) e quebra `fitExtent`/`geoPath`. Os dados devem vir no
 * enrolamento do d3-geo; este reparo por polígono só protege o mapa contra uma feição invertida.
 */
export function fixWinding<G extends Geometry>(geometry: G): G {
  switch (geometry.type) {
    case 'Polygon': {
      return geoArea(geometry) > HEMISPHERE
        ? { ...geometry, coordinates: reversePolygon(geometry.coordinates) }
        : geometry;
    }
    case 'MultiPolygon': {
      const polygons = geometry.coordinates.map((coordinates) =>
        geoArea({ type: 'Polygon', coordinates }) > HEMISPHERE
          ? reversePolygon(coordinates)
          : coordinates,
      );
      return { ...geometry, coordinates: polygons };
    }
    case 'GeometryCollection':
      return { ...geometry, geometries: geometry.geometries.map((part) => fixWinding(part)) };
    default:
      return geometry;
  }
}

function repaired<F extends Feature<Geometry, GeoProps>>(feat: F): F {
  return { ...feat, geometry: fixWinding(feat.geometry) };
}

export function collectionOf(
  topology: Topology,
  name: string,
): FeatureCollection<Geometry, GeoProps> | null {
  const object = topology.objects[name];
  if (!object) return null;
  const converted = feature<GeoProps>(topology, object as GeometryCollection<GeoProps>);
  const collection = converted as FeatureCollection<Geometry, GeoProps>;
  return { ...collection, features: collection.features.map((feat) => repaired(feat)) };
}

export function singleFeature(topology: Topology, name: string): GeoFeature | null {
  const object = topology.objects[name];
  if (!object) return null;
  const converted = feature<GeoProps>(topology, object as GeometryCollection<GeoProps>) as
    GeoFeature | FeatureCollection<Geometry, GeoProps>;
  if (converted.type === 'FeatureCollection') {
    const first = converted.features[0];
    if (!first) return null;
    // `objects.state` pode vir como coleção com uma ou mais partes: funde em uma só feição.
    if (converted.features.length === 1) return repaired(first);
    return {
      type: 'Feature',
      properties: first.properties,
      geometry: {
        type: 'GeometryCollection',
        geometries: converted.features.map((f) => fixWinding(f.geometry)),
      },
    };
  }
  return repaired(converted);
}
