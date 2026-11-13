import { readFile } from 'node:fs/promises';
import { Delaunay } from 'd3-delaunay';
import { neighbors } from 'topojson-client';
import { topology } from 'topojson-server';
import type { GeometryCollection } from 'topojson-specification';
import {
  connectComponents,
  mixedDistrictSeats,
  partitionGraph,
  type Dataset,
  type DistrictLabel,
  type DistrictPlanRecord,
  type PartitionNode,
  type PlanPoint,
} from '@votobr/shared';
import { IBGE_BASE, fetchSource } from './download.js';
import { normalizeName, type GeoData } from './geo.js';
import type { LocalRecord } from './locations.js';
import { distribute } from './municipal.js';

/**
 * Critérios do desenho (ver docs/METHODOLOGY.md, seção 5):
 * - peso: população do Censo 2022 (IBGE), como no PLS 86/2017 e no HubPolítico;
 * - municípios inteiros, salvo os que sozinhos passam da cota de um distrito (+5%) ou, quando não
 *   há outro jeito de cumprir a meta, os que passam de meia cota: estes são divididos pelos seus
 *   locais de votação;
 * - contiguidade pela malha municipal do IBGE (e por triangulação dos locais dentro das cidades);
 * - meta de ±5% em relação à média (limite de ±10%), compacidade e coesão dos municípios, das
 *   regiões imediatas do IBGE (a "formação histórica" da PEC 2/2025) e dos bairros nas cidades.
 */
/** Meta de desvio (regra geral do PLS 86/2017) e limite (exceção admitida). */
export const DISTRICT_TARGET = 0.05;
export const DISTRICT_TOLERANCE = 0.1;
const COMPACTNESS = 0.15;
/** Municípios acima desta fração da cota podem ser divididos pelos locais de votação (tentativas). */
const SPLITTABLE = [0.5, 0.25, 0.1] as const;
/** Acima deste desvio, tenta de novo com municípios menores divisíveis. */
const RETRY_ABOVE = 0.08;
/** Peso de cada pedaço extra de: [município dividido, região imediata] (estados) ou [bairro] (cidades). */
const STATE_COHESION = [0.02, 0.006] as const;
const CITY_COHESION = [0.004] as const;

export interface DistrictingContext {
  geo: GeoData;
  /** População residente por município (Censo 2022). */
  population: Map<number, number>;
  /** Municípios vizinhos (fronteira comum na malha do IBGE). */
  neighbors: Map<number, number[]>;
}

/** Local de votação de uma unidade: permite dividir municípios grandes entre distritos. */
export interface DistrictPlace {
  /** Índice da unidade (zona × município) em `Dataset.units`. */
  unit: number;
  lat: number;
  lon: number;
  voters: number;
  hood?: string;
}

export interface PlanStats {
  key: string;
  k: number;
  maxDeviation: number;
  /** Distritos fora da meta (±5%) e fora do limite (±10%). */
  outOfTarget: number;
  outOfTolerance: number;
  splitMunicipalities: number;
}

interface CensusResponse {
  resultados: { series: { localidade: { id: string }; serie: Record<string, string> }[] }[];
}

/** População residente por município — Censo 2022, tabela 4709 do SIDRA, variável 93. */
export async function loadPopulation(): Promise<Map<number, number>> {
  const url = `${IBGE_BASE}/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]`;
  const path = await fetchSource(url, 'ibge/populacao-censo-2022.json');
  const raw = JSON.parse(await readFile(path, 'utf8')) as CensusResponse[];
  const out = new Map<number, number>();
  for (const series of raw[0]?.resultados[0]?.series ?? []) {
    const value = Number(series.serie['2022']);
    if (Number.isFinite(value)) out.set(Number(series.localidade.id), value);
  }
  if (out.size < 5500) throw new Error(`Censo 2022: só ${out.size} municípios com população`);
  return out;
}

/** Vizinhança entre municípios: arcos compartilhados na topologia da malha do IBGE. */
export function municipalNeighbors(geo: GeoData): Map<number, number[]> {
  const codes = [...geo.features.keys()].sort((a, b) => a - b);
  const topo = topology({
    m: {
      type: 'FeatureCollection',
      features: codes.map((code) => ({ ...(geo.features.get(code) as object), id: code })),
    } as GeoJSON.FeatureCollection,
  });
  const object = topo.objects.m as GeometryCollection;
  const lists = neighbors(object.geometries);
  const out = new Map<number, number[]>();
  object.geometries.forEach((g, i) => {
    out.set(
      Number(g.id),
      (lists[i] ?? []).map((j) => Number(object.geometries[j]?.id)),
    );
  });
  return out;
}

export async function loadDistrictingContext(geo: GeoData): Promise<DistrictingContext> {
  const [population, adjacency] = [await loadPopulation(), municipalNeighbors(geo)];
  return { geo, population, neighbors: adjacency };
}

/** Projeção equirretangular local em km (suficiente para comparar distâncias dentro de uma UF). */
function projector(lat0: number) {
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  return (lon: number, lat: number) => ({ x: lon * kx, y: lat * 110.57 });
}

const PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di']);

/** "JARDIM SÃO LUÍS" → "Jardim São Luís". */
export function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) =>
      i > 0 && PARTICLES.has(word)
        ? word
        : word
            .replace(/^(\p{L})/u, (c) => c.toUpperCase())
            .replace(/-(\p{L})/gu, (m) => m.toUpperCase()),
    )
    .join(' ');
}

const GENERIC_HOODS = new Set(['', 'CENTRO', 'ZONARURAL', 'RURAL', 'NAOINFORMADO', 'SEMBAIRRO']);

/** Bairros mais representativos (por eleitores), sem repetir grafias equivalentes. */
function topHoods(hoods: Map<string, number>, n: number): string[] {
  const merged = new Map<string, { name: string; voters: number }>();
  for (const [name, voters] of hoods) {
    const key = normalizeName(name);
    if (GENERIC_HOODS.has(key)) continue;
    const prev = merged.get(key);
    if (prev) prev.voters += voters;
    else merged.set(key, { name, voters });
  }
  return [...merged.values()]
    .sort((a, b) => b.voters - a.voters || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((h) => titleCase(h.name));
}

interface Atom {
  mun: number;
  /** Índices em `places` (município dividido) ou vazio (município inteiro). */
  places: number[];
}

/** Arestas (únicas) da triangulação de Delaunay dos pontos. */
function triangulate(points: readonly { x: number; y: number }[]): [number, number][] {
  if (points.length < 2) return [];
  if (points.length === 2) return [[0, 1]];
  const { triangles } = Delaunay.from(
    points,
    (p) => p.x,
    (p) => p.y,
  );
  const edges = new Map<number, [number, number]>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e] as number;
      const b = triangles[t + ((e + 1) % 3)] as number;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      edges.set(lo * points.length + hi, [lo, hi]);
    }
  }
  // Pontos colineares: liga em sequência.
  if (edges.size === 0) return points.slice(1).map((_, i) => [i, i + 1] as [number, number]);
  return [...edges.values()];
}

/** Poda ligações longas; é uma heurística de distância, não uma detecção de barreiras naturais. */
function lengthLimit(lengths: number[]): number {
  const sorted = [...lengths].sort((a, b) => a - b);
  return Math.max((sorted[Math.floor(sorted.length / 2)] ?? 0) * 6, 1e-9);
}

function addEdge(adj: Set<number>[], a: number, b: number) {
  if (a === b) return;
  adj[a]?.add(b);
  adj[b]?.add(a);
}

/** Locais de votação das unidades (zona × município) de um dataset estadual. */
export function placesFromLocals(
  ds: Dataset,
  locals: Iterable<LocalRecord>,
  tseToIbge: ReadonlyMap<string, number>,
): DistrictPlace[] {
  const unitOf = new Map<string, number>();
  ds.units.forEach((u, i) => unitOf.set(`${u.mun}:${u.zone}`, i));
  const out: DistrictPlace[] = [];
  for (const l of locals) {
    const ibge = tseToIbge.get(l.tse);
    const unit = ibge === undefined ? undefined : unitOf.get(`${ibge}:${l.zone}`);
    if (unit === undefined || l.voters <= 0) continue;
    out.push({ unit, lat: l.lat, lon: l.lon, voters: l.voters, hood: l.hood });
  }
  return out;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Calcula e grava em `ds.districtPlans` os desenhos do distrital puro e do misto. `places` são os
 * locais de votação das unidades (zonas); as unidades sem locais contam como um ponto só.
 */
export function attachDistrictPlans(
  ds: Dataset,
  ctx: DistrictingContext,
  givenPlaces: readonly DistrictPlace[] = [],
): PlanStats[] {
  const units = ds.units;
  const city = ds.office === 'municipal';
  const project = projector(units.reduce((a, u) => a + u.lat, 0) / Math.max(1, units.length));

  // População por unidade: a do município, repartida pelos eleitores (maior resto).
  const unitsByMun = new Map<number, number[]>();
  units.forEach((u, i) => unitsByMun.set(u.mun, [...(unitsByMun.get(u.mun) ?? []), i]));
  let knownPop = 0;
  let knownVoters = 0;
  for (const [mun, list] of unitsByMun) {
    const pop = ctx.population.get(mun);
    if (pop === undefined) continue;
    knownPop += pop;
    knownVoters += list.reduce((a, i) => a + (units[i]?.voters ?? 0), 0);
  }
  if (knownVoters <= 0 || knownPop <= 0) {
    throw new Error(`${ds.key}: sem população censitária para desenhar distritos`);
  }
  const ratio = knownPop / knownVoters;
  const munPop = new Map<number, number>();
  for (const [mun, list] of unitsByMun) {
    const voters = list.map((i) => units[i]?.voters ?? 0);
    const pop = ctx.population.get(mun) ?? Math.round(voters.reduce((a, b) => a + b, 0) * ratio);
    if (!ctx.population.has(mun)) {
      console.warn(
        `${ds.key}: município ${mun} ausente do Censo 2022; população estimada em ${pop} pela razão população/eleitorado da área`,
      );
    }
    munPop.set(mun, pop);
    const shares = distribute(pop, voters.some((v) => v > 0) ? voters : voters.map(() => 1));
    list.forEach((i, j) => {
      (units[i] as { pop?: number }).pop = shares[j] ?? 0;
    });
  }
  const totalPop = units.reduce((a, u) => a + (u.pop ?? 0), 0);

  // Locais por município (unidades sem local entram como um ponto) e a população de cada local.
  const places: DistrictPlace[] = [...givenPlaces];
  const withPlaces = new Set(places.map((p) => p.unit));
  units.forEach((u, i) => {
    if (!withPlaces.has(i)) places.push({ unit: i, lat: u.lat, lon: u.lon, voters: u.voters });
  });
  const placesByMun = new Map<number, number[]>();
  places.forEach((p, idx) => {
    const mun = units[p.unit]?.mun as number;
    placesByMun.set(mun, [...(placesByMun.get(mun) ?? []), idx]);
  });
  const placePop = new Float64Array(places.length);
  for (const [mun, list] of placesByMun) {
    const voters = list.map((idx) => Math.max(places[idx]?.voters ?? 0, 0));
    const sum = voters.reduce((a, b) => a + b, 0);
    list.forEach((idx, j) => {
      placePop[idx] =
        ((munPop.get(mun) ?? 0) * (sum > 0 ? (voters[j] as number) : 1)) /
        (sum > 0 ? sum : list.length);
    });
  }
  const placeXY = places.map((p) => project(p.lon, p.lat));

  // Grupos de coesão por bairro (cidades) — ids estáveis por nome normalizado.
  const hoodIds = new Map<string, number>();
  const placeHood = places.map((p) => {
    const key = normalizeName(p.hood ?? '');
    if (GENERIC_HOODS.has(key)) return -1;
    if (!hoodIds.has(key)) hoodIds.set(key, hoodIds.size);
    return hoodIds.get(key) as number;
  });

  const ks = [...new Set([ds.seats, mixedDistrictSeats(ds.seats)])].filter((k) => k > 1);
  const plans: Record<string, DistrictPlanRecord> = {};
  const stats: PlanStats[] = [];

  const draw = (k: number, splittable: number) => {
    const quota = totalPop / k;
    // Átomos: municípios inteiros; os que passam de meia cota (e a cidade, nas Câmaras) viram um
    // átomo por coordenada de local de votação — e só são divididos se necessário (ver coesão).
    const atoms: Atom[] = [];
    const atomsByMun = new Map<number, number[]>();
    for (const mun of [...unitsByMun.keys()].sort((a, b) => a - b)) {
      const list = placesByMun.get(mun) ?? [];
      if (!city && ((munPop.get(mun) ?? 0) <= quota * splittable || list.length < 2)) {
        atomsByMun.set(mun, [atoms.length]);
        atoms.push({ mun, places: [] });
        continue;
      }
      const byPoint = new Map<string, number[]>();
      for (const idx of list) {
        const p = places[idx] as DistrictPlace;
        const key = `${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
        byPoint.set(key, [...(byPoint.get(key) ?? []), idx]);
      }
      const ids: number[] = [];
      for (const group of byPoint.values()) {
        ids.push(atoms.length);
        atoms.push({ mun, places: group });
      }
      atomsByMun.set(mun, ids);
    }

    const nodes: PartitionNode[] = atoms.map((atom) => {
      const list = atom.places.length ? atom.places : (placesByMun.get(atom.mun) ?? []);
      let w = 0;
      let pw = 0;
      let sx = 0;
      let sy = 0;
      for (const idx of list) {
        const q = Math.max(placePop[idx] as number, 1);
        w += placePop[idx] as number;
        pw += q;
        sx += q * (placeXY[idx] as { x: number }).x;
        sy += q * (placeXY[idx] as { y: number }).y;
      }
      const hood = atom.places.length ? (placeHood[atom.places[0] as number] ?? -1) : -1;
      const groups = city ? [hood] : [atom.mun, ctx.geo.byCode.get(atom.mun)?.region ?? -1];
      return { x: pw > 0 ? sx / pw : 0, y: pw > 0 ? sy / pw : 0, w, groups };
    });

    const adj = atoms.map(() => new Set<number>());
    const dist = (a: number, b: number) =>
      Math.hypot(
        (nodes[a] as PartitionNode).x - (nodes[b] as PartitionNode).x,
        (nodes[a] as PartitionNode).y - (nodes[b] as PartitionNode).y,
      );
    // Uma triangulação única de todos os átomos: entre municípios, vale a aresta se forem vizinhos
    // na malha do IBGE (assim a fronteira entre duas cidades divididas tem várias ligações, não só o
    // par de locais mais próximo); dentro do município, só as arestas não muito longas.
    const edges = triangulate(nodes);
    const inner = new Map<number, number[]>();
    for (const [a, b] of edges) {
      const mun = (atoms[a] as Atom).mun;
      if (mun === (atoms[b] as Atom).mun) inner.set(mun, [...(inner.get(mun) ?? []), dist(a, b)]);
    }
    const limit = new Map([...inner].map(([mun, lengths]) => [mun, lengthLimit(lengths)]));
    const linked = new Set<string>();
    for (const [a, b] of edges) {
      const ma = (atoms[a] as Atom).mun;
      const mb = (atoms[b] as Atom).mun;
      if (ma === mb) {
        if (dist(a, b) <= (limit.get(ma) ?? Infinity)) addEdge(adj, a, b);
      } else if (!city && ctx.neighbors.get(ma)?.includes(mb)) {
        addEdge(adj, a, b);
        linked.add(ma < mb ? `${ma}-${mb}` : `${mb}-${ma}`);
      }
    }
    // Vizinhos sem aresta na triangulação (separados por um terceiro ponto): o par mais próximo.
    if (!city) {
      for (const [mun, ids] of atomsByMun) {
        for (const other of ctx.neighbors.get(mun) ?? []) {
          const others = atomsByMun.get(other);
          if (other <= mun || !others || linked.has(`${mun}-${other}`)) continue;
          let pair: [number, number] = [ids[0] as number, others[0] as number];
          for (const a of ids)
            for (const b of others) if (dist(a, b) < dist(...pair)) pair = [a, b];
          addEdge(adj, ...pair);
        }
      }
    }
    // Município é contíguo: locais isolados pela poda (zona rural, distritos afastados) voltam a
    // se ligar ao resto do próprio município pelo par mais próximo.
    for (const ids of atomsByMun.values()) {
      if (ids.length < 2) continue;
      const local = new Map(ids.map((id, i) => [id, i]));
      const sub = ids.map((id) =>
        [...(adj[id] ?? [])].filter((j) => local.has(j)).map((j) => local.get(j) as number),
      );
      const joined = connectComponents(
        ids.map((id) => nodes[id] as PartitionNode),
        sub,
      );
      joined.forEach((list, i) => {
        for (const j of list) addEdge(adj, ids[i] as number, ids[j] as number);
      });
    }

    const connected = connectComponents(
      nodes,
      adj.map((set) => [...set].sort((a, b) => a - b)),
    );
    const part = partitionGraph(nodes, connected, k, {
      tolerance: DISTRICT_TARGET,
      compactness: COMPACTNESS,
      cohesion: city ? CITY_COHESION : STATE_COHESION,
    });
    if (part.count !== k || part.assignment.length !== nodes.length) {
      throw new Error(`${ds.key}: não foi possível formar ${k} distritos completos`);
    }
    const members = Array.from({ length: k }, () => [] as number[]);
    part.assignment.forEach((d, i) => {
      if (!members[d]) throw new Error(`${ds.key}: distrito inválido no átomo ${i}`);
      members[d].push(i);
    });
    for (const [d, list] of members.entries()) {
      const seen = new Set<number>();
      const pending = list.slice(0, 1);
      while (pending.length) {
        const i = pending.pop() as number;
        if (seen.has(i)) continue;
        seen.add(i);
        for (const j of connected[i] ?? []) {
          if (part.assignment[j] === d && !seen.has(j)) pending.push(j);
        }
      }
      if (!list.length || seen.size !== list.length) {
        throw new Error(`${ds.key}: distrito ${d + 1}/${k} vazio ou desconexo no grafo`);
      }
    }
    return { atoms, atomsByMun, part };
  };

  for (const k of ks) {
    // Município pequeno e isolado pode travar o equilíbrio (ex.: Oiapoque, no AP, sozinho fica a
    // −10% da cota e somado a Calçoene passa de +15%): só então os municípios menores também podem
    // ser divididos por local de votação.
    let best = draw(k, SPLITTABLE[0] as number);
    for (const splittable of SPLITTABLE.slice(1)) {
      if (city || best.part.maxDeviation <= RETRY_ABOVE) break;
      const attempt = draw(k, splittable);
      if (attempt.part.maxDeviation < best.part.maxDeviation - 0.005) best = attempt;
    }
    const { atoms, atomsByMun, part } = best;

    // Distrito de cada local; unidades repartidas ficam com o distrito da maioria dos eleitores.
    const placeDistrict = new Int32Array(places.length);
    const unitVotes = new Map<number, Map<number, number>>();
    const unitDistrict = new Array<number>(units.length).fill(0);
    atoms.forEach((atom, id) => {
      const d = part.assignment[id] as number;
      if (atom.places.length === 0) {
        for (const i of unitsByMun.get(atom.mun) ?? []) unitDistrict[i] = d;
        for (const idx of placesByMun.get(atom.mun) ?? []) placeDistrict[idx] = d;
        return;
      }
      for (const idx of atom.places) {
        placeDistrict[idx] = d;
        const p = places[idx] as DistrictPlace;
        const m = unitVotes.get(p.unit) ?? new Map<number, number>();
        m.set(d, (m.get(d) ?? 0) + Math.max(p.voters, 0) + 1e-9);
        unitVotes.set(p.unit, m);
      }
    });
    for (const [unit, m] of unitVotes) {
      unitDistrict[unit] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
    }
    const split = new Set<number>();
    for (const [mun, ids] of atomsByMun) {
      if (new Set(ids.map((id) => part.assignment[id])).size > 1) split.add(mun);
    }
    const record: DistrictPlanRecord = {
      unitDistrict,
      labels: districtLabels(ds, ctx, k, atoms, part.assignment, places, placePop, unitsByMun),
    };
    if (!city) {
      const points: PlanPoint[] = [];
      for (const mun of split) {
        for (const idx of placesByMun.get(mun) ?? []) {
          const p = places[idx] as DistrictPlace;
          points.push([
            round5(p.lon),
            round5(p.lat),
            placeDistrict[idx] as number,
            p.voters,
            p.unit,
          ]);
        }
      }
      if (points.length) record.points = points;
    }
    plans[String(k)] = record;

    const mean = totalPop / part.count;
    const devs = part.weights.map((w) => Math.abs(w - mean) / mean);
    stats.push({
      key: ds.key,
      k,
      maxDeviation: part.maxDeviation,
      outOfTarget: devs.filter((d) => d > DISTRICT_TARGET + 1e-9).length,
      outOfTolerance: devs.filter((d) => d > DISTRICT_TOLERANCE + 1e-9).length,
      splitMunicipalities: city ? 0 : split.size,
    });
  }
  ds.districtPlans = plans;
  return stats;
}

function districtLabels(
  ds: Dataset,
  ctx: DistrictingContext,
  count: number,
  atoms: readonly Atom[],
  assignment: Int32Array,
  places: readonly DistrictPlace[],
  placePop: Float64Array,
  unitsByMun: ReadonlyMap<number, readonly number[]>,
): DistrictLabel[] {
  const city = ds.office === 'municipal';
  const munPop = Array.from({ length: count }, () => new Map<number, number>());
  const hoods = Array.from({ length: count }, () => new Map<number, Map<string, number>>());
  const districtsOfMun = new Map<number, Set<number>>();
  atoms.forEach((atom, id) => {
    const d = assignment[id] as number;
    const set = districtsOfMun.get(atom.mun) ?? new Set<number>();
    set.add(d);
    districtsOfMun.set(atom.mun, set);
    const pops = munPop[d] as Map<number, number>;
    if (atom.places.length === 0) {
      const pop = (unitsByMun.get(atom.mun) ?? []).reduce((a, i) => a + (ds.units[i]?.pop ?? 0), 0);
      pops.set(atom.mun, (pops.get(atom.mun) ?? 0) + pop);
      return;
    }
    const byMun = hoods[d] as Map<number, Map<string, number>>;
    const acc = byMun.get(atom.mun) ?? new Map<string, number>();
    for (const idx of atom.places) {
      pops.set(atom.mun, (pops.get(atom.mun) ?? 0) + (placePop[idx] as number));
      const hood = places[idx]?.hood;
      if (hood) acc.set(hood, (acc.get(hood) ?? 0) + (places[idx]?.voters ?? 0));
    }
    byMun.set(atom.mun, acc);
  });
  return munPop.map((pops, d) => {
    const ranked = [...pops.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const main = ranked[0]?.[0] ?? 0;
    const mainHoods = hoods[d]?.get(main);
    if (city) {
      const top = mainHoods ? topHoods(mainHoods, 3) : [];
      if (!top.length) return { main: ds.area.name };
      return top.length > 1
        ? { main: top[0] as string, hoods: top.slice(1) }
        : { main: top[0] as string };
    }
    const label: DistrictLabel = { main: ctx.geo.byCode.get(main)?.name ?? String(main) };
    if ((districtsOfMun.get(main)?.size ?? 0) > 1 && mainHoods) {
      const top = topHoods(mainHoods, 2);
      if (top.length) label.hoods = top;
    }
    if (ranked.length > 1) label.others = ranked.length - 1;
    return label;
  });
}
