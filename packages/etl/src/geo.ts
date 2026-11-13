import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { geoCentroid, geoContains } from 'd3-geo';
import { quantize } from 'topojson-client';
import { topology } from 'topojson-server';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { UF_CODES, UF_IBGE, type UfCode } from '@votobr/shared';
import { IBGE_BASE, OUT_DIR, fetchSource } from './download.js';

export interface IbgeMunicipality {
  code: number;
  name: string;
  uf: UfCode;
  /** Região geográfica imediata do IBGE (2017). */
  region: number;
}

export interface GeoData {
  municipalities: IbgeMunicipality[];
  byCode: Map<number, IbgeMunicipality>;
  features: Map<number, Feature<Geometry>>;
  stateFeatures: Map<UfCode, Feature<Geometry>>;
}

interface LocalidadeRaw {
  id: number;
  nome: string;
  'regiao-imediata'?: { id: number } | null;
}

const UF_BY_IBGE = new Map<number, UfCode>(UF_CODES.map((uf) => [UF_IBGE[uf], uf]));

/**
 * Municípios cujo nome no TSE difere do IBGE a ponto de impedir a correspondência por nome.
 * Chave: `UF:código TSE`. Cada entrada foi conferida manualmente (grafia, ou renomeação oficial).
 */
export const TSE_TO_IBGE_OVERRIDES: Record<string, number> = {
  'GO:92690': 5203500, // Bom Jesus → Bom Jesus de Goiás
  'MG:41092': 3105509, // Barão de Monte Alto → Barão do Monte Alto
  'MG:44571': 3122900, // Dona Eusébia → Dona Euzébia
  'MG:53031': 3165206, // São Thomé das Letras → São Tomé das Letras
  'MT:91553': 5107800, // Santo Antônio do Leverger → Santo Antônio de Leverger
  'PA:04120': 1502954, // Eldorado dos Carajás → Eldorado do Carajás
  'PR:77119': 4116307, // Munhoz de Mello → Munhoz de Melo
  'RN:17035': 2405306, // Boa Saúde → Januário Cicco (renomeado)
  'RO:00256': 1100098, // Espigão do Oeste → Espigão D'Oeste
  'RO:00337': 1100346, // Alvorada do Oeste → Alvorada D'Oeste
  'RR:03158': 1400605, // São Luiz → São Luiz do Anauá
  'SE:31011': 2800100, // Amparo de São Francisco → Amparo do São Francisco
  'SP:71013': 3550001, // São Luís do Paraitinga → São Luiz do Paraitinga
};

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * O IBGE entrega GeoJSON no padrão RFC 7946 (anel externo anti-horário), mas o d3-geo usa a convenção
 * oposta (externo horário). Sem o ajuste, `geoContains`/`geoCentroid`/`geoPath` tratam cada município
 * como o complemento da esfera.
 */
function rewindRing(ring: number[][], clockwise: boolean): number[][] {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i] as number[];
    const [x1, y1] = ring[i + 1] as number[];
    area += (x0 as number) * (y1 as number) - (x1 as number) * (y0 as number);
  }
  const isClockwise = area < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function rewindPolygon(rings: number[][][]): number[][][] {
  return rings.map((r, i) => rewindRing(r, i === 0));
}

export function rewindGeometry<G extends Geometry>(g: G): G {
  if (g.type === 'Polygon') return { ...g, coordinates: rewindPolygon(g.coordinates) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map(rewindPolygon) };
  return g;
}

async function fetchJson<T>(url: string, name: string): Promise<T> {
  return JSON.parse(await readFile(await fetchSource(url, name), 'utf8')) as T;
}

const meshUrl = (scope: string, quality: string, intra: string) =>
  `${IBGE_BASE}/v3/malhas/${scope}?formato=application/vnd.geo+json&qualidade=${quality}${intra ? `&intrarregiao=${intra}` : ''}`;

export async function loadGeo(): Promise<GeoData> {
  const raw = await fetchJson<LocalidadeRaw[]>(
    `${IBGE_BASE}/v1/localidades/municipios`,
    'ibge/municipios.json',
  );
  const municipalities: IbgeMunicipality[] = raw.map((m) => ({
    code: m.id,
    name: m.nome,
    uf: UF_BY_IBGE.get(Math.floor(m.id / 100000)) as UfCode,
    region: m['regiao-imediata']?.id ?? -1,
  }));
  const mesh = await fetchJson<FeatureCollection<Geometry, { codarea: string }>>(
    meshUrl('paises/BR', 'minima', 'municipio'),
    'ibge/malha-municipios.json',
  );
  const features = new Map<number, Feature<Geometry>>();
  for (const f of mesh.features) {
    features.set(Number(f.properties.codarea), {
      type: 'Feature',
      properties: {},
      geometry: rewindGeometry(f.geometry),
    });
  }

  const ufMesh = await fetchJson<FeatureCollection<Geometry, { codarea: string }>>(
    meshUrl('paises/BR', 'minima', 'UF'),
    'ibge/malha-ufs.json',
  );
  const stateFeatures = new Map<UfCode, Feature<Geometry>>();
  for (const f of ufMesh.features) {
    const uf = UF_BY_IBGE.get(Number(f.properties.codarea));
    if (uf) {
      stateFeatures.set(uf, {
        type: 'Feature',
        properties: {},
        geometry: rewindGeometry(f.geometry),
      });
    }
  }
  return {
    municipalities,
    byCode: new Map(municipalities.map((m) => [m.code, m])),
    features,
    stateFeatures,
  };
}

export function featureCentroid(geo: GeoData, ibge: number): [number, number] | null {
  const f = geo.features.get(ibge);
  return f ? (geoCentroid(f) as [number, number]) : null;
}

export function stateCentroid(geo: GeoData, uf: string): [number, number] | null {
  const f = geo.stateFeatures.get(uf as UfCode);
  return f ? (geoCentroid(f) as [number, number]) : null;
}

export function pointInMunicipality(geo: GeoData, ibge: number, point: [number, number]): boolean {
  const f = geo.features.get(ibge);
  return f ? geoContains(f, point) : false;
}

/**
 * Resolve o código IBGE de um município do TSE: (1) conferência manual, (2) UF + nome normalizado
 * quando único, (3) ponto-em-polígono com o ponto médio dos locais de votação.
 * Devolve `null` se nada confere — o ETL deve falhar em vez de adivinhar.
 */
export function createMunicipalityResolver(geo: GeoData) {
  const byName = new Map<string, IbgeMunicipality[]>();
  const byUf = new Map<UfCode, IbgeMunicipality[]>();
  for (const m of geo.municipalities) {
    const key = `${m.uf}:${normalizeName(m.name)}`;
    byName.set(key, [...(byName.get(key) ?? []), m]);
    byUf.set(m.uf, [...(byUf.get(m.uf) ?? []), m]);
  }

  return (
    uf: string,
    tseCode: string,
    name: string,
    point: [number, number] | null,
  ): number | null => {
    const override = TSE_TO_IBGE_OVERRIDES[`${uf}:${tseCode.padStart(5, '0')}`];
    if (override) return override;
    const hit = byName.get(`${uf}:${normalizeName(name)}`);
    if (hit?.length === 1) return (hit[0] as IbgeMunicipality).code;
    if (!point) return null;
    for (const m of hit ?? byUf.get(uf as UfCode) ?? []) {
      if (pointInMunicipality(geo, m.code, point)) return m.code;
    }
    return null;
  };
}

/**
 * Ilhotas menores que isto (≈ 0,1 km²) colapsam em anéis degenerados na quantização, e o sentido
 * desses anéis é aleatório (viram "esfera inteira" no d3-geo). São invisíveis no mapa.
 */
const MIN_POLYGON_DEG2 = 1e-5;

function outerRingArea(polygon: number[][][]): number {
  const ring = polygon[0] ?? [];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i] as number[];
    const [x1, y1] = ring[i + 1] as number[];
    area += (x0 as number) * (y1 as number) - (x1 as number) * (y0 as number);
  }
  return Math.abs(area) / 2;
}

export function dropSlivers<G extends Geometry>(g: G): G {
  if (g.type !== 'MultiPolygon') return g;
  const kept = g.coordinates.filter((p) => outerRingArea(p) >= MIN_POLYGON_DEG2);
  if (kept.length === g.coordinates.length) return g;
  if (kept.length) return { ...g, coordinates: kept };
  const largest = [...g.coordinates].sort((a, b) => outerRingArea(b) - outerRingArea(a))[0];
  return { ...g, coordinates: largest ? [largest] : g.coordinates };
}

/** Topologia quantizada (1e5 ≈ 10 m na escala do Brasil). Os tipos do topojson-client não aceitam `properties` nulas. */
function pack(objects: Record<string, FeatureCollection<Geometry, object>>) {
  const cleaned = Object.fromEntries(
    Object.entries(objects).map(([name, fc]) => [
      name,
      {
        ...fc,
        features: fc.features.map((f) => ({ ...f, geometry: dropSlivers(f.geometry) })),
      },
    ]),
  );
  const topo = topology(cleaned) as unknown as Parameters<typeof quantize>[0];
  return quantize(topo, 1e5);
}

async function writeJson(path: string, value: unknown): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(value);
  await writeFile(path, text);
  return text.length;
}

/** Gera TopoJSON quantizado: `br` (UFs) e um arquivo por UF (municípios + contorno do estado). */
export async function writeTopologies(geo: GeoData): Promise<{ files: number; bytes: number }> {
  let bytes = 0;
  let files = 0;
  const states: FeatureCollection<Geometry, { id: string; name: string }> = {
    type: 'FeatureCollection',
    features: UF_CODES.map((uf) => ({
      type: 'Feature',
      geometry: (geo.stateFeatures.get(uf) as Feature<Geometry>).geometry,
      properties: { id: uf, name: uf },
    })),
  };
  bytes += await writeJson(join(OUT_DIR, 'geo/br.topo.json'), pack({ states }));
  files++;

  for (const uf of UF_CODES) {
    const munis: FeatureCollection<Geometry, { id: number; name: string; uf: string }> = {
      type: 'FeatureCollection',
      features: geo.municipalities
        .filter((m) => m.uf === uf && geo.features.has(m.code))
        .map((m) => ({
          type: 'Feature',
          geometry: (geo.features.get(m.code) as Feature<Geometry>).geometry,
          properties: { id: m.code, name: m.name, uf },
        })),
    };
    const state: FeatureCollection<Geometry, { id: string }> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: (geo.stateFeatures.get(uf) as Feature<Geometry>).geometry,
          properties: { id: uf },
        },
      ],
    };
    bytes += await writeJson(
      join(OUT_DIR, `geo/uf/${uf}.topo.json`),
      pack({ municipalities: munis, state }),
    );
    files++;
  }
  return { files, bytes };
}

/** Contorno de maior detalhe de um município (para o mapa de distritos das capitais). */
export async function writeCityTopology(ibge: number, name: string, uf: string): Promise<void> {
  const mesh = await fetchJson<FeatureCollection<Geometry>>(
    meshUrl(`municipios/${ibge}`, 'intermediaria', ''),
    `ibge/cidade-${ibge}.json`,
  );
  const city: FeatureCollection<Geometry, { id: number; name: string; uf: string }> = {
    type: 'FeatureCollection',
    features: mesh.features.map((f) => ({
      type: 'Feature',
      geometry: rewindGeometry(f.geometry),
      properties: { id: ibge, name, uf },
    })),
  };
  await writeJson(join(OUT_DIR, `geo/city/${ibge}.topo.json`), pack({ city }));
}
