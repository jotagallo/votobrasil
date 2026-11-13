import type { Dataset, UfCode } from '@votobr/shared';
import { DatasetBuilder, competitorOf, statusOf } from './builder.js';
import { parseIntSafe, streamZipCsv } from './csv.js';
import type { GeoData } from './geo.js';
import type { DistrictPlace } from './districting.js';
import type { LocalRecord, Locations } from './locations.js';
import type { IntegrityCheck } from './states.js';

const CARGO_VEREADOR = '13';

export interface MunicipalCity {
  ibge: number;
  tse: string;
  uf: UfCode;
  name: string;
  voters: number;
}

export interface MunicipalSources {
  candidatesZip: string;
  partiesZip: string;
  detailZip: string;
  /** Caminho do .zip de votação por seção da UF informada. */
  sectionZip: (uf: UfCode) => string;
}

/**
 * Cidades com pelo menos `minVoters` eleitores aptos nos locais de votação (eleição municipal),
 * da maior para a menor. `limit` (opcional) corta a lista para builds de desenvolvimento.
 */
export function pickMunicipalities(
  loc: Locations,
  geo: GeoData,
  minVoters: number,
  limit = Infinity,
): MunicipalCity[] {
  const voters = new Map<string, number>();
  for (const l of loc.locals.values()) voters.set(l.tse, (voters.get(l.tse) ?? 0) + l.voters);
  return [...voters.entries()]
    .filter(([, v]) => v >= minVoters)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tse, v]) => {
      const ibge = loc.tseToIbge.get(tse);
      const info = ibge === undefined ? undefined : geo.byCode.get(ibge);
      if (ibge === undefined || !info) {
        throw new Error(`Município TSE ${tse} com ${v} eleitores sem correspondência no IBGE`);
      }
      return { ibge, tse, uf: info.uf, name: info.name, voters: v };
    });
}

/** Distribui `total` (inteiro) proporcionalmente aos pesos pelo método do maior resto. */
export function distribute(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(() => 0);
  if (total <= 0 || weights.length === 0) return out;
  if (sum <= 0) {
    out[0] = total;
    return out;
  }
  const rest: { i: number; frac: number }[] = [];
  let given = 0;
  weights.forEach((w, i) => {
    const exact = (total * w) / sum;
    const base = Math.floor(exact);
    out[i] = base;
    given += base;
    rest.push({ i, frac: exact - base });
  });
  rest.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < total - given; k++) out[(rest[k] as { i: number }).i]!++;
  return out;
}

interface CandidateMeta {
  name: string;
  number: number;
  party: string;
  comp: number;
  status: ReturnType<typeof statusOf>;
  zoneVotes: Map<number, number>;
}

/**
 * Câmara Municipal: a apuração oficial (zona) define os totais; a votação por seção só distribui
 * geograficamente cada total de zona entre os locais de votação daquela zona (método do maior resto),
 * de modo que a soma de qualquer partido/candidato coincide exatamente com o TSE.
 */
export async function buildMunicipalDataset(
  city: MunicipalCity,
  year: number,
  src: MunicipalSources,
  loc: Locations,
  localsByTse: Map<string, LocalRecord[]>,
): Promise<{
  dataset: Dataset;
  checks: IntegrityCheck[];
  sectionMismatchVotes: number;
  /** Locais com o bairro, para o desenho dos distritos. */
  places: DistrictPlace[];
}> {
  const locals = (localsByTse.get(city.tse) ?? [])
    .filter((l) => l.voters > 0)
    .sort((a, b) => a.zone - b.zone || a.local - b.local);
  const b = new DatasetBuilder(`${year}-municipal-${city.ibge}`, year, 'municipal', {
    kind: 'municipality',
    code: String(city.ibge),
    name: city.name,
    uf: city.uf,
  });
  const unitOfLocal = new Map<string, number>();
  const unitsByZone = new Map<number, number[]>();
  locals.forEach((l) => {
    const idx = b.unit(`${l.zone}:${l.local}`, () => ({
      mun: city.ibge,
      zone: l.zone,
      lat: l.lat,
      lon: l.lon,
      voters: l.voters,
      label: l.name,
    }));
    unitOfLocal.set(`${l.zone}:${l.local}`, idx);
    unitsByZone.set(l.zone, [...(unitsByZone.get(l.zone) ?? []), idx]);
  });
  const places: DistrictPlace[] = locals.map((l) => ({
    unit: unitOfLocal.get(`${l.zone}:${l.local}`) as number,
    lat: l.lat,
    lon: l.lon,
    voters: l.voters,
    hood: l.hood,
  }));
  const munFilter = (line: string) => line.includes(`"${city.tse}"`);

  // 1) Totais oficiais por candidato/zona.
  const candidates = new Map<string, CandidateMeta>();
  await streamZipCsv(
    src.candidatesZip,
    `votacao_candidato_munzona_${year}_${city.uf}.csv`,
    (row) => {
      if (row('CD_MUNICIPIO').padStart(5, '0') !== city.tse || row('CD_CARGO') !== CARGO_VEREADOR)
        return;
      if (row('NR_TURNO') !== '1') return;
      const comp = b.competitor(competitorOf(row));
      const sq = row('SQ_CANDIDATO');
      const meta = candidates.get(sq) ?? {
        name: row('NM_URNA_CANDIDATO'),
        number: parseIntSafe(row('NR_CANDIDATO')),
        party: row('SG_PARTIDO'),
        comp,
        status: statusOf(row('DS_SIT_TOT_TURNO')),
        zoneVotes: new Map<number, number>(),
      };
      const zone = parseIntSafe(row('NR_ZONA'));
      meta.zoneVotes.set(
        zone,
        (meta.zoneVotes.get(zone) ?? 0) + parseIntSafe(row('QT_VOTOS_NOMINAIS_VALIDOS')),
      );
      candidates.set(sq, meta);
    },
    munFilter,
  );

  // 2) Legenda por partido/zona.
  const legendZone = new Map<
    string,
    { comp: number; party: string; number: string; zone: number; votes: number }
  >();
  await streamZipCsv(
    src.partiesZip,
    `votacao_partido_munzona_${year}_${city.uf}.csv`,
    (row) => {
      if (row('CD_MUNICIPIO').padStart(5, '0') !== city.tse || row('CD_CARGO') !== CARGO_VEREADOR)
        return;
      if (row('NR_TURNO') !== '1') return;
      const comp = b.competitor(competitorOf(row));
      const zone = parseIntSafe(row('NR_ZONA'));
      const key = `${row('NR_PARTIDO')}:${zone}`;
      const prev = legendZone.get(key);
      const votes = parseIntSafe(row('QT_TOTAL_VOTOS_LEG_VALIDOS'));
      if (prev) prev.votes += votes;
      else
        legendZone.set(key, {
          comp,
          party: row('SG_PARTIDO'),
          number: row('NR_PARTIDO'),
          zone,
          votes,
        });
    },
    munFilter,
  );

  // 3) Votação por seção → distribuição geográfica.
  const candBySection = new Map<string, Map<number, number>>();
  const legendBySection = new Map<string, Map<number, number>>();
  const missingLocals = new Map<string, number>();
  let sectionVotes = 0;
  let missingVotes = 0;
  await streamZipCsv(
    src.sectionZip(city.uf),
    `votacao_secao_${year}_${city.uf}.csv`,
    (row) => {
      if (row('CD_MUNICIPIO').padStart(5, '0') !== city.tse || row('CD_CARGO') !== CARGO_VEREADOR)
        return;
      if (row('NR_TURNO') !== '1') return;
      const zone = parseIntSafe(row('NR_ZONA'));
      const votes = parseIntSafe(row('QT_VOTOS'));
      const local =
        loc.sectionLocal.get(`${city.tse}:${zone}:${parseIntSafe(row('NR_SECAO'))}`) ??
        parseIntSafe(row('NR_LOCAL_VOTACAO'));
      const key = `${zone}:${local}`;
      sectionVotes += votes;
      const unit = unitOfLocal.get(key);
      if (unit === undefined) {
        missingLocals.set(key, (missingLocals.get(key) ?? 0) + votes);
        missingVotes += votes;
        return;
      }
      const sq = row('SQ_CANDIDATO');
      const target =
        sq !== '-3'
          ? candBySection
          : (() => {
              const nr = row('NR_VOTAVEL');
              return nr === '95' || nr === '96' ? null : legendBySection;
            })();
      if (!target) return;
      const id = sq !== '-3' ? sq : row('NR_VOTAVEL');
      const m = target.get(id) ?? new Map<number, number>();
      m.set(unit, (m.get(unit) ?? 0) + votes);
      target.set(id, m);
    },
    munFilter,
  );
  // Votos de seções sem local cadastrado ficam só no total da zona (redistribuídos por eleitorado); acima de 0,5%
  // a ligação seção → local está errada e o dataset não é confiável.
  if (sectionVotes === 0 || missingVotes / sectionVotes > 0.005) {
    throw new Error(
      `${city.name}: ${missingLocals.size} locais sem cadastro somam ${missingVotes}/${sectionVotes} votos ` +
        `(ex.: ${[...missingLocals.keys()].slice(0, 5).join(', ')})`,
    );
  }

  let sectionMismatchVotes = 0;
  const spread = (total: number, weightsByUnit: Map<number, number> | undefined, zone: number) => {
    const zoneUnits = unitsByZone.get(zone) ?? [];
    let weights = zoneUnits.map((u) => weightsByUnit?.get(u) ?? 0);
    const sum = weights.reduce((a, c) => a + c, 0);
    if (sum !== total) sectionMismatchVotes += Math.abs(sum - total);
    if (sum === 0) weights = zoneUnits.map((u) => b.units[u]?.voters ?? 0);
    return { zoneUnits, parts: distribute(total, weights) };
  };

  for (const [sq, meta] of candidates) {
    const info = {
      name: meta.name,
      number: meta.number,
      party: meta.party,
      comp: meta.comp,
      status: meta.status,
    };
    const secs = candBySection.get(sq);
    let seen = false;
    for (const [zone, total] of meta.zoneVotes) {
      if (total <= 0) continue;
      const { zoneUnits, parts } = spread(total, secs, zone);
      zoneUnits.forEach((u, i) => {
        const v = parts[i] ?? 0;
        if (v > 0) {
          b.addCandidate(sq, info, u, v);
          seen = true;
        }
      });
    }
    if (!seen) b.addCandidate(sq, info, 0, 0);
  }

  for (const l of legendZone.values()) {
    if (l.votes <= 0) continue;
    const { zoneUnits, parts } = spread(l.votes, legendBySection.get(l.number), l.zone);
    zoneUnits.forEach((u, i) => b.addLegend(l.comp, l.party, u, parts[i] ?? 0));
  }

  const dataset = b.build();

  // 4) Conferência com o "detalhe da votação" oficial.
  let tseValid = 0;
  let tseVoters = 0;
  await streamZipCsv(
    src.detailZip,
    `detalhe_votacao_munzona_${year}_${city.uf}.csv`,
    (row) => {
      if (row('CD_MUNICIPIO').padStart(5, '0') !== city.tse || row('CD_CARGO') !== CARGO_VEREADOR)
        return;
      if (row('NR_TURNO') !== '1') return;
      tseValid += parseIntSafe(row('QT_TOTAL_VOTOS_VALIDOS'));
      tseVoters += parseIntSafe(row('QT_APTOS'));
    },
    munFilter,
  );
  return {
    dataset,
    checks: [
      {
        key: dataset.key,
        validVotes: dataset.validVotes,
        tseValidVotes: tseValid,
        electorate: dataset.electorate,
        tseElectorate: tseVoters,
      },
    ],
    sectionMismatchVotes,
    places,
  };
}
