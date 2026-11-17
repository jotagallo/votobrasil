/**
 * Geometrias do mock: serve os arquivos reais de `data/processed/geo/` quando existem;
 * caso contrário gera TopoJSON sintético (grades e elipses). Convenção de enrolamento do d3-geo:
 * anel externo no sentido horário (norte para cima).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import { UF_IBGE, UF_NAMES, type UfCode } from '@votobr/shared';
import { gauss, rngFor } from './rng.js';

export interface Municipality {
  id: number;
  name: string;
  lon: number;
  lat: number;
}

export interface CityDef {
  ibge: string;
  name: string;
  uf: UfCode;
  seats: number;
  electorate: number;
  lon: number;
  lat: number;
  radiusLon: number;
  radiusLat: number;
}

/** Contornos aproximados das UFs usados só quando não há `br.topo.json`/`uf/*.topo.json` reais. */
const UF_CENTERS: Record<UfCode, [number, number]> = {
  AC: [-70.5, -9.0],
  AL: [-36.6, -9.6],
  AM: [-64.5, -4.0],
  AP: [-52.0, 1.4],
  BA: [-41.7, -12.5],
  CE: [-39.3, -5.2],
  DF: [-47.8, -15.8],
  ES: [-40.6, -19.6],
  GO: [-49.6, -15.9],
  MA: [-45.3, -5.1],
  MG: [-44.7, -18.5],
  MS: [-54.8, -20.5],
  MT: [-55.9, -13.0],
  PA: [-52.5, -4.0],
  PB: [-36.8, -7.1],
  PE: [-37.9, -8.4],
  PI: [-42.8, -7.2],
  PR: [-51.6, -24.6],
  RJ: [-42.7, -22.2],
  RN: [-36.5, -5.8],
  RO: [-62.8, -10.9],
  RR: [-61.4, 2.1],
  RS: [-53.2, -29.6],
  SC: [-50.5, -27.3],
  SE: [-37.4, -10.6],
  SP: [-48.7, -22.3],
  TO: [-48.3, -10.2],
};

type Point = [number, number];

interface GridCell {
  properties: Record<string, string | number>;
}

/** Grade com arcos compartilhados (vizinhança válida em `topojson.neighbors`) e vértices levemente deslocados. */
function gridTopology(args: {
  bbox: [number, number, number, number];
  nx: number;
  ny: number;
  cells: GridCell[];
  cellObject: string;
  outlineObject: string;
  outlineProperties: Record<string, string | number>;
  seed: string;
}): Topology {
  const { bbox, nx, ny, cells, cellObject, outlineObject, outlineProperties, seed } = args;
  const [x0, y0, x1, y1] = bbox;
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const corner = (i: number, j: number): Point => {
    const edge = i === 0 || j === 0 || i === nx || j === ny;
    const jitter = edge ? 0.12 : 0.3;
    const r = rngFor(seed, 'corner', i, j);
    return [x0 + (i + (r() - 0.5) * jitter) * dx, y0 + (j + (r() - 0.5) * jitter) * dy];
  };

  const arcs: Point[][] = [];
  const horizontal = new Map<string, number>();
  const vertical = new Map<string, number>();
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      horizontal.set(`${i},${j}`, arcs.length);
      arcs.push([corner(i, j), corner(i + 1, j)]);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      vertical.set(`${i},${j}`, arcs.length);
      arcs.push([corner(i, j), corner(i, j + 1)]);
    }
  }
  const h = (i: number, j: number) => horizontal.get(`${i},${j}`) as number;
  const v = (i: number, j: number) => vertical.get(`${i},${j}`) as number;

  const geometries: GeometryObject[] = [];
  cells.forEach((cell, index) => {
    const i = index % nx;
    const j = Math.floor(index / nx);
    geometries.push({
      type: 'Polygon',
      properties: cell.properties,
      // SO → NO → NE → SE → SO (horário).
      arcs: [[v(i, j), h(i, j + 1), ~v(i + 1, j), ~h(i, j)]],
    });
  });

  const outline: number[] = [];
  for (let j = 0; j < ny; j++) outline.push(v(0, j));
  for (let i = 0; i < nx; i++) outline.push(h(i, ny));
  for (let j = ny - 1; j >= 0; j--) outline.push(~v(nx, j));
  for (let i = nx - 1; i >= 0; i--) outline.push(~h(i, 0));

  return {
    type: 'Topology',
    arcs,
    objects: {
      [cellObject]: { type: 'GeometryCollection', geometries } as GeometryCollection,
      [outlineObject]: {
        type: 'GeometryCollection',
        geometries: [{ type: 'Polygon', properties: outlineProperties, arcs: [outline] }],
      } as GeometryCollection,
    },
  } as unknown as Topology;
}

function syntheticBrazil(): Topology {
  const entries = Object.entries(UF_CENTERS) as Array<[UfCode, [number, number]]>;
  const arcs: Point[][] = [];
  const geometries: GeometryObject[] = [];
  for (const [uf, [cx, cy]] of entries) {
    const half = 1.6;
    // SO → NO → NE → SE → SO (horário).
    const ring: Point[] = [
      [cx - half, cy - half * 0.8],
      [cx - half, cy + half * 0.8],
      [cx + half, cy + half * 0.8],
      [cx + half, cy - half * 0.8],
      [cx - half, cy - half * 0.8],
    ];
    geometries.push({ type: 'Polygon', properties: { id: uf, name: uf }, arcs: [[arcs.length]] });
    arcs.push(ring);
  }
  return {
    type: 'Topology',
    arcs,
    objects: { states: { type: 'GeometryCollection', geometries } as GeometryCollection },
  } as unknown as Topology;
}

function syntheticState(uf: UfCode): Topology {
  const [cx, cy] = UF_CENTERS[uf];
  const rng = rngFor('state-grid', uf);
  const nx = 7 + Math.floor(rng() * 4);
  const ny = 6 + Math.floor(rng() * 4);
  const halfX = 2.4;
  const halfY = 2.0;
  const base = UF_IBGE[uf] * 100000;
  const cells: GridCell[] = [];
  for (let k = 0; k < nx * ny; k++) {
    const code = base + 1000 + k * 5 + 3;
    cells.push({
      properties: { id: code, name: `${UF_NAMES[uf]} ${String(k + 1).padStart(3, '0')}`, uf },
    });
  }
  return gridTopology({
    bbox: [cx - halfX, cy - halfY, cx + halfX, cy + halfY],
    nx,
    ny,
    cells,
    cellObject: 'municipalities',
    outlineObject: 'state',
    outlineProperties: { id: uf, name: UF_NAMES[uf] },
    seed: `state-${uf}`,
  });
}

function syntheticCity(city: CityDef): Topology {
  const rng = rngFor('city-outline', city.ibge);
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const steps = 96;
  const ring: Point[] = [];
  for (let s = 0; s < steps; s++) {
    // Ângulo decrescente: sentido horário com o norte para cima.
    const theta = ((steps - s) / steps) * Math.PI * 2;
    const r =
      1 +
      0.18 * Math.sin(2 * theta + phase1) +
      0.1 * Math.sin(3 * theta + phase2) +
      0.025 * gauss(rng);
    ring.push([
      city.lon + city.radiusLon * r * Math.cos(theta),
      city.lat + city.radiusLat * r * Math.sin(theta),
    ]);
  }
  ring.push(ring[0] as Point);
  return {
    type: 'Topology',
    arcs: [ring],
    objects: {
      city: {
        type: 'Polygon',
        properties: { id: Number(city.ibge), name: city.name, uf: city.uf },
        arcs: [[0]],
      },
    },
  } as unknown as Topology;
}

export const CITIES: CityDef[] = [
  {
    ibge: '3550308',
    name: 'São Paulo',
    uf: 'SP',
    seats: 55,
    electorate: 9_300_000,
    lon: -46.63,
    lat: -23.55,
    radiusLon: 0.26,
    radiusLat: 0.2,
  },
  {
    ibge: '3304557',
    name: 'Rio de Janeiro',
    uf: 'RJ',
    seats: 51,
    electorate: 5_000_000,
    lon: -43.35,
    lat: -22.93,
    radiusLon: 0.3,
    radiusLat: 0.12,
  },
  {
    ibge: '3106200',
    name: 'Belo Horizonte',
    uf: 'MG',
    seats: 41,
    electorate: 1_900_000,
    lon: -43.94,
    lat: -19.92,
    radiusLon: 0.13,
    radiusLat: 0.1,
  },
  {
    ibge: '2927408',
    name: 'Salvador',
    uf: 'BA',
    seats: 43,
    electorate: 2_000_000,
    lon: -38.48,
    lat: -12.95,
    radiusLon: 0.1,
    radiusLat: 0.15,
  },
  {
    ibge: '2304400',
    name: 'Fortaleza',
    uf: 'CE',
    seats: 43,
    electorate: 1_800_000,
    lon: -38.54,
    lat: -3.78,
    radiusLon: 0.12,
    radiusLat: 0.1,
  },
  {
    ibge: '1302603',
    name: 'Manaus',
    uf: 'AM',
    seats: 41,
    electorate: 1_500_000,
    lon: -60.02,
    lat: -3.1,
    radiusLon: 0.2,
    radiusLat: 0.14,
  },
  {
    ibge: '4106902',
    name: 'Curitiba',
    uf: 'PR',
    seats: 38,
    electorate: 1_400_000,
    lon: -49.27,
    lat: -25.45,
    radiusLon: 0.11,
    radiusLat: 0.11,
  },
  {
    ibge: '2611606',
    name: 'Recife',
    uf: 'PE',
    seats: 39,
    electorate: 1_200_000,
    lon: -34.93,
    lat: -8.05,
    radiusLon: 0.09,
    radiusLat: 0.09,
  },
  {
    ibge: '4314902',
    name: 'Porto Alegre',
    uf: 'RS',
    seats: 36,
    electorate: 1_100_000,
    lon: -51.2,
    lat: -30.05,
    radiusLon: 0.13,
    radiusLat: 0.13,
  },
  {
    ibge: '1501402',
    name: 'Belém',
    uf: 'PA',
    seats: 35,
    electorate: 1_000_000,
    lon: -48.47,
    lat: -1.45,
    radiusLon: 0.1,
    radiusLat: 0.12,
  },
  {
    ibge: '5208707',
    name: 'Goiânia',
    uf: 'GO',
    seats: 37,
    electorate: 1_000_000,
    lon: -49.27,
    lat: -16.68,
    radiusLon: 0.12,
    radiusLat: 0.12,
  },
  {
    ibge: '3518800',
    name: 'Guarulhos',
    uf: 'SP',
    seats: 34,
    electorate: 950_000,
    lon: -46.48,
    lat: -23.42,
    radiusLon: 0.1,
    radiusLat: 0.08,
  },
  {
    ibge: '3509502',
    name: 'Campinas',
    uf: 'SP',
    seats: 33,
    electorate: 880_000,
    lon: -47.06,
    lat: -22.86,
    radiusLon: 0.13,
    radiusLat: 0.13,
  },
  {
    ibge: '2111300',
    name: 'São Luís',
    uf: 'MA',
    seats: 31,
    electorate: 750_000,
    lon: -44.25,
    lat: -2.56,
    radiusLon: 0.11,
    radiusLat: 0.09,
  },
  {
    ibge: '2704302',
    name: 'Maceió',
    uf: 'AL',
    seats: 27,
    electorate: 633_031,
    lon: -35.7089,
    lat: -9.6498,
    radiusLon: 0.1,
    radiusLat: 0.12,
  },
  {
    ibge: '5002704',
    name: 'Campo Grande',
    uf: 'MS',
    seats: 29,
    electorate: 646_198,
    lon: -54.6201,
    lat: -20.4697,
    radiusLon: 0.16,
    radiusLat: 0.16,
  },
  {
    ibge: '2211001',
    name: 'Teresina',
    uf: 'PI',
    seats: 29,
    electorate: 587_098,
    lon: -42.8016,
    lat: -5.0892,
    radiusLon: 0.12,
    radiusLat: 0.13,
  },
  {
    ibge: '2507507',
    name: 'João Pessoa',
    uf: 'PB',
    seats: 29,
    electorate: 566_311,
    lon: -34.845,
    lat: -7.1195,
    radiusLon: 0.1,
    radiusLat: 0.08,
  },
  {
    ibge: '2408102',
    name: 'Natal',
    uf: 'RN',
    seats: 29,
    electorate: 575_629,
    lon: -35.2009,
    lat: -5.7793,
    radiusLon: 0.12,
    radiusLat: 0.1,
  },
  {
    ibge: '5103403',
    name: 'Cuiabá',
    uf: 'MT',
    seats: 27,
    electorate: 445_070,
    lon: -56.0974,
    lat: -15.601,
    radiusLon: 0.15,
    radiusLat: 0.12,
  },
  {
    ibge: '2800308',
    name: 'Aracaju',
    uf: 'SE',
    seats: 26,
    electorate: 416_605,
    lon: -37.0731,
    lat: -10.9472,
    radiusLon: 0.08,
    radiusLat: 0.08,
  },
  {
    ibge: '4205407',
    name: 'Florianópolis',
    uf: 'SC',
    seats: 23,
    electorate: 410_812,
    lon: -48.548,
    lat: -27.5954,
    radiusLon: 0.16,
    radiusLat: 0.16,
  },
  {
    ibge: '1100205',
    name: 'Porto Velho',
    uf: 'RO',
    seats: 23,
    electorate: 362_248,
    lon: -63.8999,
    lat: -8.7608,
    radiusLon: 0.13,
    radiusLat: 0.12,
  },
  {
    ibge: '1600303',
    name: 'Macapá',
    uf: 'AP',
    seats: 23,
    electorate: 310_841,
    lon: -51.0694,
    lat: 0.0349,
    radiusLon: 0.1,
    radiusLat: 0.1,
  },
  {
    ibge: '1400100',
    name: 'Boa Vista',
    uf: 'RR',
    seats: 23,
    electorate: 232_172,
    lon: -60.6758,
    lat: 2.8235,
    radiusLon: 0.13,
    radiusLat: 0.1,
  },
  {
    ibge: '1200401',
    name: 'Rio Branco',
    uf: 'AC',
    seats: 21,
    electorate: 271_518,
    lon: -67.8249,
    lat: -9.9754,
    radiusLon: 0.11,
    radiusLat: 0.1,
  },
  {
    ibge: '3205309',
    name: 'Vitória',
    uf: 'ES',
    seats: 21,
    electorate: 266_570,
    lon: -40.3128,
    lat: -20.3155,
    radiusLon: 0.05,
    radiusLat: 0.07,
  },
  {
    ibge: '1721000',
    name: 'Palmas',
    uf: 'TO',
    seats: 23,
    electorate: 209_524,
    lon: -48.3336,
    lat: -10.184,
    radiusLon: 0.15,
    radiusLat: 0.12,
  },
];

const CITY_POPULATION_2022 = new Map<string, number>([
  ['3550308', 11_451_999],
  ['3304557', 6_211_223],
  ['2304400', 2_428_708],
  ['2927408', 2_417_678],
  ['3106200', 2_315_560],
  ['1302603', 2_063_689],
  ['4106902', 1_773_718],
  ['2611606', 1_488_920],
  ['5208707', 1_437_366],
  ['4314902', 1_332_845],
  ['1501402', 1_303_403],
  ['3518800', 1_291_771],
  ['3509502', 1_139_047],
  ['2111300', 1_037_775],
  ['2704302', 957_916],
  ['5002704', 898_100],
  ['2211001', 866_300],
  ['2507507', 833_932],
  ['2408102', 751_300],
  ['5103403', 650_877],
  ['2800308', 602_757],
  ['4205407', 537_211],
  ['1100205', 460_434],
  ['1600303', 442_933],
  ['1400100', 413_486],
  ['1200401', 364_756],
  ['3205309', 322_869],
  ['1721000', 302_692],
]);

CITIES.sort(
  (a, b) =>
    (CITY_POPULATION_2022.get(b.ibge) ?? 0) - (CITY_POPULATION_2022.get(a.ibge) ?? 0) ||
    a.ibge.localeCompare(b.ibge),
);

export interface GeoProvider {
  brazil(): Topology;
  state(uf: UfCode): Topology;
  city(ibge: string): Topology | null;
  municipalities(uf: UfCode): Municipality[];
  /** Feição do contorno do município (para sortear locais de votação dentro dele). */
  cityFeature(ibge: string): Feature<Polygon | MultiPolygon> | null;
  /** Indica de onde vêm as geometrias, para o log do mock. */
  describe(): string;
}

export function createGeoProvider(geoDir: string): GeoProvider {
  const cache = new Map<string, Topology>();
  const readReal = (relative: string): Topology | null => {
    const file = path.join(geoDir, relative);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Topology;
    } catch {
      return null;
    }
  };
  const memo = (key: string, build: () => Topology | null): Topology | null => {
    const hit = cache.get(key);
    if (hit) return hit;
    const built = build();
    if (built) cache.set(key, built);
    return built;
  };

  const brazil = () => memo('br', () => readReal('br.topo.json') ?? syntheticBrazil()) as Topology;
  const state = (uf: UfCode) =>
    memo(`uf-${uf}`, () => readReal(`uf/${uf}.topo.json`) ?? syntheticState(uf)) as Topology;
  const city = (ibge: string) => {
    const def = CITIES.find((c) => c.ibge === ibge);
    if (!def) return null;
    return memo(`city-${ibge}`, () => readReal(`city/${ibge}.topo.json`) ?? syntheticCity(def));
  };

  const municipalitiesCache = new Map<UfCode, Municipality[]>();
  const municipalities = (uf: UfCode): Municipality[] => {
    const hit = municipalitiesCache.get(uf);
    if (hit) return hit;
    const topology = state(uf);
    const object = topology.objects.municipalities as
      GeometryCollection<{ id: number; name: string }> | undefined;
    const out: Municipality[] = [];
    if (object) {
      const collection = feature(topology, object);
      for (const f of collection.features) {
        const [lon, lat] = geoCentroid(f);
        const id = Number(f.id ?? f.properties?.id);
        if (!Number.isFinite(id) || lon === undefined || lat === undefined) continue;
        out.push({ id, name: String(f.properties?.name ?? id), lon, lat });
      }
    }
    municipalitiesCache.set(uf, out);
    return out;
  };

  const cityFeature = (ibge: string) => {
    const topology = city(ibge);
    const object = topology?.objects.city;
    if (!topology || !object) return null;
    const converted = feature(topology, object as GeometryCollection);
    const first = 'features' in converted ? converted.features[0] : converted;
    return (first as Feature<Polygon | MultiPolygon> | undefined) ?? null;
  };

  return {
    brazil,
    state,
    city,
    municipalities,
    cityFeature,
    describe: () => {
      const real = existsSync(path.join(geoDir, 'br.topo.json'));
      const realCities = existsSync(path.join(geoDir, 'city'));
      return real
        ? `geometrias reais de ${geoDir}${realCities ? '' : ' (cidades sintéticas)'}`
        : 'geometrias sintéticas';
    },
  };
}
