import { UF_CODES } from '@votobr/shared';
import { parseCoord, parseIntSafe, streamZipCsv } from './csv.js';
import {
  createMunicipalityResolver,
  featureCentroid,
  normalizeName,
  pointInMunicipality,
  stateCentroid,
  type GeoData,
} from './geo.js';

export type CoordQuality = 'local' | 'hood' | 'zone' | 'municipality' | 'polygon';

export interface PlacePoint {
  lat: number;
  lon: number;
  quality: CoordQuality;
}

export interface LocalRecord extends PlacePoint {
  tse: string;
  zone: number;
  local: number;
  name: string;
  /** Bairro do local (NM_BAIRRO), usado para nomear distritos. */
  hood: string;
  voters: number;
}

export interface ZoneRecord extends PlacePoint {
  tse: string;
  zone: number;
  voters: number;
}

export interface LocationStats {
  locals: number;
  localsWithCoordinates: number;
  localsOutsideMunicipality: number;
  /** Locais com coordenada genérica (a mesma de locais de outros bairros), tratada como ausente. */
  localsWithPlaceholder: number;
  /** Locais sem coordenada que receberam a do mesmo local na eleição de referência. */
  localsFromReference: number;
  /** Locais sem coordenada posicionados no centro dos locais do mesmo bairro. */
  localsByHood: number;
  zones: number;
  zonesWithoutOwnCoordinates: number;
  municipalitiesResolvedByPolygon: number;
}

export interface Locations {
  year: number;
  /** Código TSE do município → código IBGE. */
  tseToIbge: Map<string, number>;
  /** Código TSE do município → UF. */
  tseUf: Map<string, string>;
  zones: Map<string, ZoneRecord>;
  locals: Map<string, LocalRecord>;
  /** `município:zona:seção` → código do local de votação (só eleições municipais; ver `loadLocations`). */
  sectionLocal: Map<string, number>;
  stats: LocationStats;
}

interface RawLocal {
  tse: string;
  zone: number;
  local: number;
  name: string;
  hood: string;
  voters: number;
  /** QT_ELEITOR_ELEICAO_MUNICIPAL: usado apenas quando o local não tem eleitores por seção (presídios, unidades socioeducativas). */
  altVoters: number;
  lat: number;
  lon: number;
}

interface RawMunicipality {
  uf: string;
  name: string;
  pts: { lat: number; lon: number; w: number }[];
}

export const validCoord = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && lat > -34 && lat < 6 && lon > -74 && lon < -32;

function weightedMean(items: { lat: number; lon: number; w: number }[]): {
  lat: number;
  lon: number;
} {
  let w = 0;
  let lat = 0;
  let lon = 0;
  for (const i of items) {
    w += i.w;
    lat += i.lat * i.w;
    lon += i.lon * i.w;
  }
  return { lat: lat / w, lon: lon / w };
}

/**
 * Carrega locais de votação (coordenadas e eleitores por seção) de um .zip do TSE e consolida por zona.
 * Local sem coordenada recebe, nesta ordem: a do mesmo local em `reference` (outra eleição: mesmo
 * número e nome, ou mesmo nome no município), o centro dos locais do mesmo bairro, o centro da zona.
 */
export async function loadLocations(
  year: number,
  zipPath: string,
  geo: GeoData,
  ufs: readonly string[] = UF_CODES,
  reference?: Locations,
): Promise<Locations> {
  const raws = new Map<string, RawLocal>();
  const municipalities = new Map<string, RawMunicipality>();
  // Na votação por seção das municipais, o local pode ser o código original (seção transferida);
  // por isso o vínculo exato é seção → local.
  const sectionLocal = new Map<string, number>();
  const municipalElection = year < 2026;
  const wanted = new Set<string>(ufs);
  const members =
    year >= 2026
      ? ufs.map((uf) => `eleitorado_local_votacao_${year}_${uf}.csv`)
      : [`eleitorado_local_votacao_${year}.csv`];

  for (const member of members) {
    await streamZipCsv(zipPath, member, (row) => {
      if (row('NR_TURNO') !== '1') return;
      const uf = row('SG_UF');
      if (!wanted.has(uf)) return;
      const tse = row('CD_MUNICIPIO').padStart(5, '0');
      if (!municipalities.has(tse)) {
        municipalities.set(tse, { uf, name: row('NM_MUNICIPIO'), pts: [] });
      }
      const zone = parseIntSafe(row('NR_ZONA'));
      const local = parseIntSafe(row('NR_LOCAL_VOTACAO'));
      const key = `${tse}:${zone}:${local}`;
      // A soma de QT_ELEITOR_SECAO reproduz exatamente o QT_APTOS do detalhe da votação oficial.
      // QT_ELEITOR_ELEICAO_MUNICIPAL atribui as seções agregadas à seção principal e não serve como total.
      const voters = parseIntSafe(row('QT_ELEITOR_SECAO'));
      const altVoters = municipalElection ? parseIntSafe(row('QT_ELEITOR_ELEICAO_MUNICIPAL')) : 0;
      if (municipalElection)
        sectionLocal.set(`${tse}:${zone}:${parseIntSafe(row('NR_SECAO'))}`, local);
      const lat = parseCoord(row('NR_LATITUDE'));
      const lon = parseCoord(row('NR_LONGITUDE'));
      const prev = raws.get(key);
      if (prev) {
        prev.voters += voters;
        prev.altVoters += altVoters;
        if (!validCoord(prev.lat, prev.lon) && validCoord(lat, lon)) {
          prev.lat = lat;
          prev.lon = lon;
        }
        return;
      }
      raws.set(key, {
        tse,
        zone,
        local,
        name: row('NM_LOCAL_VOTACAO'),
        hood: row('NM_BAIRRO'),
        voters,
        altVoters,
        lat,
        lon,
      });
    });
  }
  for (const r of raws.values()) if (r.voters === 0) r.voters = r.altVoters;

  // Coordenada genérica: a mesma para locais de bairros diferentes (ex.: 15 locais de Salvador, de
  // Itapuã a São Cristóvão, num ponto só) — é um marcador do cadastro, não a posição do local.
  const hoodsAt = new Map<string, Set<string>>();
  for (const r of raws.values()) {
    if (!validCoord(r.lat, r.lon)) continue;
    const ck = `${r.tse}:${r.lat.toFixed(5)}:${r.lon.toFixed(5)}`;
    hoodsAt.set(ck, (hoodsAt.get(ck) ?? new Set()).add(normalizeName(r.hood)));
  }
  let placeholders = 0;
  for (const r of raws.values()) {
    if (!validCoord(r.lat, r.lon)) continue;
    if ((hoodsAt.get(`${r.tse}:${r.lat.toFixed(5)}:${r.lon.toFixed(5)}`)?.size ?? 0) < 3) continue;
    r.lat = Number.NaN;
    r.lon = Number.NaN;
    placeholders++;
  }

  // Em 2024, por exemplo, 145 locais de Salvador (30% do eleitorado) vieram sem latitude/longitude.
  let fromReference = 0;
  if (reference) {
    const byName = new Map<string, LocalRecord>();
    for (const l of reference.locals.values()) {
      if (l.quality === 'local') byName.set(`${l.tse}:${normalizeName(l.name)}`, l);
    }
    for (const [key, r] of raws) {
      if (validCoord(r.lat, r.lon)) continue;
      const name = normalizeName(r.name);
      const same = reference.locals.get(key);
      const match =
        same?.quality === 'local' && normalizeName(same.name) === name
          ? same
          : byName.get(`${r.tse}:${name}`);
      if (!match) continue;
      r.lat = match.lat;
      r.lon = match.lon;
      fromReference++;
    }
  }

  for (const r of raws.values()) {
    if (validCoord(r.lat, r.lon)) {
      municipalities.get(r.tse)?.pts.push({ lat: r.lat, lon: r.lon, w: Math.max(1, r.voters) });
    }
  }

  const resolve = createMunicipalityResolver(geo);
  const tseToIbge = new Map<string, number>();
  const tseUf = new Map<string, string>();
  const unresolved: string[] = [];
  let byPolygon = 0;
  for (const [tse, m] of municipalities) {
    if (m.uf === 'ZZ') continue;
    const mean = m.pts.length ? weightedMean(m.pts) : null;
    const byName = resolve(m.uf, tse, m.name, null);
    const ibge = byName ?? resolve(m.uf, tse, m.name, mean ? [mean.lon, mean.lat] : null);
    if (ibge === null) {
      unresolved.push(`${m.uf} ${tse} ${m.name}`);
      continue;
    }
    if (byName === null) byPolygon++;
    tseToIbge.set(tse, ibge);
    tseUf.set(tse, m.uf);
  }
  if (unresolved.length) {
    throw new Error(
      `Municípios do TSE sem correspondência no IBGE (adicione em TSE_TO_IBGE_OVERRIDES):\n${unresolved.join('\n')}`,
    );
  }

  // Coordenadas fora do polígono do município são descartadas (erros de cadastro do TSE).
  // Municípios criados após a malha do IBGE não têm polígono: nesse caso vale a coordenada informada.
  let withCoordinates = 0;
  let outside = 0;
  const okByLocal = new Map<string, boolean>();
  for (const [key, r] of raws) {
    const ibge = tseToIbge.get(r.tse);
    if (ibge === undefined) continue;
    if (!validCoord(r.lat, r.lon)) {
      okByLocal.set(key, false);
      continue;
    }
    const inside = geo.features.has(ibge) ? pointInMunicipality(geo, ibge, [r.lon, r.lat]) : true;
    if (inside) withCoordinates++;
    else outside++;
    okByLocal.set(key, inside);
  }

  const byZone = new Map<
    string,
    { pts: { lat: number; lon: number; w: number }[]; voters: number; tse: string; zone: number }
  >();
  const byMun = new Map<string, { lat: number; lon: number; w: number }[]>();
  for (const [key, r] of raws) {
    if (!tseToIbge.has(r.tse)) continue;
    const zk = `${r.tse}:${r.zone}`;
    const z = byZone.get(zk) ?? { pts: [], voters: 0, tse: r.tse, zone: r.zone };
    z.voters += r.voters;
    if (okByLocal.get(key)) {
      const p = { lat: r.lat, lon: r.lon, w: Math.max(1, r.voters) };
      z.pts.push(p);
      byMun.set(r.tse, [...(byMun.get(r.tse) ?? []), p]);
    }
    byZone.set(zk, z);
  }

  const byHood = new Map<string, { lat: number; lon: number; w: number }[]>();
  for (const [key, r] of raws) {
    if (!okByLocal.get(key) || !r.hood.trim()) continue;
    const hk = `${r.tse}:${normalizeName(r.hood)}`;
    byHood.set(hk, [
      ...(byHood.get(hk) ?? []),
      { lat: r.lat, lon: r.lon, w: Math.max(1, r.voters) },
    ]);
  }
  let byHoodCount = 0;

  const munPoint = (tse: string): PlacePoint => {
    const pts = byMun.get(tse);
    if (pts?.length) return { ...weightedMean(pts), quality: 'municipality' };
    const c =
      featureCentroid(geo, tseToIbge.get(tse) as number) ??
      stateCentroid(geo, tseUf.get(tse) as string);
    return { lat: c?.[1] ?? 0, lon: c?.[0] ?? 0, quality: 'polygon' };
  };

  const zones = new Map<string, ZoneRecord>();
  let zonesWithoutOwn = 0;
  for (const [zk, z] of byZone) {
    let point: PlacePoint;
    if (z.pts.length) point = { ...weightedMean(z.pts), quality: 'zone' };
    else {
      zonesWithoutOwn++;
      point = munPoint(z.tse);
    }
    zones.set(zk, { tse: z.tse, zone: z.zone, voters: z.voters, ...point });
  }

  const locals = new Map<string, LocalRecord>();
  for (const [key, r] of raws) {
    if (!tseToIbge.has(r.tse)) continue;
    const zone = zones.get(`${r.tse}:${r.zone}`) as ZoneRecord;
    const hood = okByLocal.get(key) ? undefined : byHood.get(`${r.tse}:${normalizeName(r.hood)}`);
    if (hood?.length) byHoodCount++;
    const own: PlacePoint = okByLocal.get(key)
      ? { lat: r.lat, lon: r.lon, quality: 'local' }
      : hood?.length
        ? { ...weightedMean(hood), quality: 'hood' }
        : { lat: zone.lat, lon: zone.lon, quality: zone.quality };
    locals.set(key, {
      tse: r.tse,
      zone: r.zone,
      local: r.local,
      name: r.name,
      hood: r.hood,
      voters: r.voters,
      ...own,
    });
  }

  return {
    year,
    tseToIbge,
    tseUf,
    zones,
    locals,
    sectionLocal,
    stats: {
      locals: raws.size,
      localsWithCoordinates: withCoordinates,
      localsOutsideMunicipality: outside,
      localsWithPlaceholder: placeholders,
      localsFromReference: fromReference,
      localsByHood: byHoodCount,
      zones: zones.size,
      zonesWithoutOwnCoordinates: zonesWithoutOwn,
      municipalitiesResolvedByPolygon: byPolygon,
    },
  };
}
