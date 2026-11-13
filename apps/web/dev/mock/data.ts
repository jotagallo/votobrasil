/**
 * Conjuntos de dados SINTÉTICOS e determinísticos para o mock de desenvolvimento.
 * Nomes de partidos e UFs são reais; candidatos, votos e distribuição espacial são inventados.
 */
import { geoBounds, geoContains } from 'd3-geo';
import {
  allocateOpenList,
  RULES_STF_2024,
  UF_CODES,
  UF_IBGE,
  UF_NAMES,
  type CandidateRecord,
  type CompetitorRecord,
  type Dataset,
  type OfficeId,
  type UfCode,
  type UnitRecord,
} from '@votobr/shared';
import { CITIES, type CityDef, type GeoProvider, type Municipality } from './geo.js';
import { cumulativeSums, gauss, pick, rngFor, weightedIndex, type Rng } from './rng.js';

interface PartyMember {
  sigla: string;
  number: number;
  weight: number;
}

interface CompetitorSpec {
  id: string;
  label: string;
  members: PartyMember[];
  strength: number;
  /** Multiplicador por região IBGE (1 = Norte, 2 = Nordeste, 3 = Sudeste, 4 = Sul, 5 = Centro-Oeste). */
  region: Partial<Record<number, number>>;
}

const single = (
  sigla: string,
  number: number,
  strength: number,
  region: CompetitorSpec['region'] = {},
): CompetitorSpec => ({
  id: sigla,
  label: sigla,
  members: [{ sigla, number, weight: 1 }],
  strength,
  region,
});

const federation = (
  label: string,
  members: PartyMember[],
  strength: number,
  region: CompetitorSpec['region'] = {},
): CompetitorSpec => ({
  id: members.map((m) => m.sigla).join('+'),
  label,
  members,
  strength,
  region,
});

export const COMPETITORS: CompetitorSpec[] = [
  single('PL', 22, 1.5, { 2: 0.75, 4: 1.3, 5: 1.35 }),
  federation(
    'Federação Brasil da Esperança',
    [
      { sigla: 'PT', number: 13, weight: 0.8 },
      { sigla: 'PCdoB', number: 65, weight: 0.12 },
      { sigla: 'PV', number: 43, weight: 0.08 },
    ],
    1.35,
    { 1: 1.1, 2: 1.7, 3: 0.95, 4: 0.7, 5: 0.7 },
  ),
  federation(
    'Federação União Progressista',
    [
      { sigla: 'UNIÃO', number: 44, weight: 0.5 },
      { sigla: 'PP', number: 11, weight: 0.5 },
    ],
    1.4,
  ),
  single('PSD', 55, 1.2),
  single('MDB', 15, 1.0, { 1: 1.3, 2: 0.9, 4: 1.1 }),
  single('REPUBLICANOS', 10, 1.0, { 3: 1.15, 5: 1.1 }),
  single('PSB', 40, 0.65, { 1: 0.9, 2: 1.5, 4: 0.6 }),
  single('PDT', 12, 0.5, { 2: 1.0, 4: 1.3 }),
  federation(
    'Federação PSOL REDE',
    [
      { sigla: 'PSOL', number: 50, weight: 0.75 },
      { sigla: 'REDE', number: 18, weight: 0.25 },
    ],
    0.5,
    { 1: 0.5, 2: 0.8, 3: 1.3, 4: 0.8, 5: 0.5 },
  ),
  single('NOVO', 30, 0.4, { 1: 0.5, 2: 0.3, 3: 1.4, 4: 1.4, 5: 1.0 }),
  single('PODE', 20, 0.5),
  federation(
    'Federação PSDB Cidadania',
    [
      { sigla: 'PSDB', number: 45, weight: 0.8 },
      { sigla: 'CIDADANIA', number: 23, weight: 0.2 },
    ],
    0.5,
    { 2: 0.5, 3: 1.4, 5: 1.1 },
  ),
];

export const FEDERAL_SEATS: Record<UfCode, number> = {
  AC: 8,
  AL: 9,
  AM: 8,
  AP: 8,
  BA: 39,
  CE: 22,
  DF: 8,
  ES: 10,
  GO: 17,
  MA: 18,
  MG: 53,
  MS: 8,
  MT: 8,
  PA: 17,
  PB: 12,
  PE: 25,
  PI: 10,
  PR: 30,
  RJ: 46,
  RN: 8,
  RO: 8,
  RR: 8,
  RS: 31,
  SC: 16,
  SE: 8,
  SP: 70,
  TO: 8,
};

export function stateSeats(uf: UfCode): number {
  const n = FEDERAL_SEATS[uf];
  return n <= 12 ? 3 * n : 36 + (n - 12);
}

export const MOCK_YEAR = { national: 2026, municipal: 2024 } as const;

const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carlos',
  'Daniela',
  'Eduardo',
  'Fernanda',
  'Gustavo',
  'Helena',
  'Igor',
  'Juliana',
  'Lucas',
  'Marina',
  'Nelson',
  'Olívia',
  'Paulo',
  'Rita',
  'Sérgio',
  'Tânia',
  'Ulisses',
  'Vera',
  'Wagner',
  'Yara',
  'Marcos',
  'Patrícia',
  'Rafael',
  'Simone',
  'Thiago',
  'Luciana',
  'Renato',
  'Cláudia',
];
const SURNAMES = [
  'Almeida',
  'Barros',
  'Cardoso',
  'Duarte',
  'Esteves',
  'Fonseca',
  'Gomes',
  'Henriques',
  'Ibrahim',
  'Junqueira',
  'Klein',
  'Lacerda',
  'Moura',
  'Nogueira',
  'Oliveira',
  'Pacheco',
  'Queiroz',
  'Ribeiro',
  'Siqueira',
  'Teixeira',
  'Uchoa',
  'Vasconcelos',
  'Werneck',
  'Xavier',
  'Zanetti',
  'Amaral',
  'Bastos',
  'Carvalho',
  'Dantas',
  'Faria',
];

function candidateName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, SURNAMES)} ${pick(rng, SURNAMES)}`;
}

const regionOf = (uf: UfCode): number => Math.floor(UF_IBGE[uf] / 10);

interface BuildArgs {
  key: string;
  year: number;
  office: OfficeId;
  area: Dataset['area'];
  seats: number;
  units: UnitRecord[];
  strengths: number[];
  seed: string;
}

/** Gera votos nominais e de legenda por unidade e atribui o resultado oficial pelas regras de lista aberta. */
function buildDataset(args: BuildArgs): Dataset {
  const { key, year, office, area, seats, units, strengths, seed } = args;
  const lons = units.map((u) => u.lon);
  const lats = units.map((u) => u.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLon = maxLon - minLon || 1;
  const spanLat = maxLat - minLat || 1;
  const span = Math.hypot(spanLon, spanLat);
  const norm = units.map(
    (u) => [(2 * (u.lon - minLon)) / spanLon - 1, (2 * (u.lat - minLat)) / spanLat - 1] as const,
  );

  const unitRng = rngFor(seed, 'units');
  const validByUnit = units.map((u) => u.voters * 0.72 * (0.92 + 0.16 * unitRng()));
  const gradient = COMPETITORS.map((_, c) => {
    const r = rngFor(seed, 'gradient', c);
    const angle = r() * Math.PI * 2;
    const tilt = 0.5 + r() * 1.0;
    return { x: Math.cos(angle) * tilt, y: Math.sin(angle) * tilt };
  });

  // Participação de cada competidor em cada unidade (softmax de força + gradiente espacial + ruído local).
  const noiseRng = rngFor(seed, 'noise');
  const shares: number[][] = units.map((_, i) => {
    const logits = COMPETITORS.map((_, c) => {
      const g = gradient[c] as { x: number; y: number };
      const [nx, ny] = norm[i] as readonly [number, number];
      return (
        Math.log(Math.max(strengths[c] ?? 0.01, 0.01)) + g.x * nx + g.y * ny + 0.3 * gauss(noiseRng)
      );
    });
    const top = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - top));
    const total = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / total);
  });

  const homeCumulative = cumulativeSums(units.map((u) => u.voters));
  const competitors: CompetitorRecord[] = [];
  const candidates: CandidateRecord[] = [];

  COMPETITORS.forEach((spec, c) => {
    const rng = rngFor(seed, 'comp', c);
    const strengthRank = (strengths[c] ?? 0.1) / Math.max(...strengths);
    const count = Math.min(
      Math.max(seats + 1, 4),
      Math.max(4, Math.round(seats * 0.9 * (0.4 + 0.6 * strengthRank))),
      45,
    );
    const memberCumulative = cumulativeSums(spec.members.map((m) => m.weight));

    const cands = Array.from({ length: count }, (_, k) => {
      const member = spec.members[weightedIndex(rng, memberCumulative)] as PartyMember;
      const home = units[weightedIndex(rng, homeCumulative)] as UnitRecord;
      return {
        member,
        weight: Math.exp(1.5 * gauss(rng)),
        home,
        name: candidateName(rng),
        number: member.number * 1000 + k + 1,
        votes: 0,
        pairs: [] as number[],
      };
    });

    const legendPairs: number[] = [];
    let legendTotal = 0;
    units.forEach((u, i) => {
      const compVotes = (shares[i] as number[])[c]! * (validByUnit[i] as number);
      const legend = Math.round(compVotes * 0.1);
      if (legend > 0) {
        legendPairs.push(i, legend);
        legendTotal += legend;
      }
      const nominal = compVotes * 0.9;
      const raw = cands.map((cand) => {
        const dist = Math.hypot(u.lon - cand.home.lon, u.lat - cand.home.lat);
        return cand.weight * (0.25 + 0.75 * Math.exp(-dist / (0.3 * span)));
      });
      const sum = raw.reduce((a, b) => a + b, 0);
      cands.forEach((cand, k) => {
        const v = Math.round((nominal * (raw[k] as number)) / sum);
        if (v > 0) {
          cand.pairs.push(i, v);
          cand.votes += v;
        }
      });
    });

    const legendByParty: Record<string, number> = {};
    let assigned = 0;
    spec.members.forEach((m, idx) => {
      const last = idx === spec.members.length - 1;
      const part = last ? legendTotal - assigned : Math.round(legendTotal * m.weight);
      legendByParty[m.sigla] = part;
      assigned += part;
    });

    competitors.push({
      id: spec.id,
      label: spec.label,
      parties: spec.members.map((m) => m.sigla),
      legend: legendTotal,
      legendByParty,
      legendByUnit: legendPairs,
    });
    cands.forEach((cand, k) => {
      candidates.push({
        id: `${key}-${c}-${k}`,
        name: cand.name,
        number: cand.number,
        party: cand.member.sigla,
        comp: c,
        votes: cand.votes,
        u: cand.pairs,
        status: 'NAO',
      });
    });
  });

  const validVotes =
    competitors.reduce((a, comp) => a + comp.legend, 0) +
    candidates.reduce((a, cand) => a + cand.votes, 0);
  const ds: Dataset = {
    schema: 1,
    key,
    year,
    office,
    area,
    seats,
    electorate: units.reduce((a, u) => a + u.voters, 0),
    validVotes,
    units,
    competitors,
    candidates,
  };

  const elected = allocateOpenList(ds, RULES_STF_2024);
  for (const e of elected) {
    const cand = candidates[e.candidate] as CandidateRecord;
    cand.status = e.tier === 'qp' ? 'QP' : 'MEDIA';
  }
  const alternates = competitors.map(() => 0);
  const order = candidates
    .map((_, i) => i)
    .sort((a, b) => (candidates[b]?.votes ?? 0) - (candidates[a]?.votes ?? 0));
  for (const i of order) {
    const cand = candidates[i] as CandidateRecord;
    if (cand.status !== 'NAO') continue;
    if ((alternates[cand.comp] ?? 0) < 2) {
      cand.status = 'SUPLENTE';
      alternates[cand.comp] = (alternates[cand.comp] ?? 0) + 1;
    }
  }
  return ds;
}

function lognormalWeights(rng: Rng, count: number, sigma: number): number[] {
  return Array.from({ length: count }, () => Math.exp(sigma * gauss(rng)));
}

function stateUnits(uf: UfCode, munis: Municipality[], electorate: number): UnitRecord[] {
  const rng = rngFor('state-units', uf);
  const weights = lognormalWeights(rng, munis.length, 1.2);
  const biggest = weights.indexOf(Math.max(...weights));
  weights[biggest] = (weights[biggest] as number) * 2.5;
  const total = weights.reduce((a, b) => a + b, 0);
  const units: UnitRecord[] = [];
  munis.forEach((m, idx) => {
    const voters = (electorate * (weights[idx] as number)) / total;
    const zones = Math.min(45, Math.max(1, Math.round(voters / 110000)));
    for (let k = 0; k < zones; k++) {
      const spread = 0.03 * Math.sqrt(zones);
      units.push({
        mun: m.id,
        zone: k + 1,
        lon: Number((m.lon + (zones > 1 ? gauss(rng) * spread : 0)).toFixed(5)),
        lat: Number((m.lat + (zones > 1 ? gauss(rng) * spread : 0)).toFixed(5)),
        voters: Math.max(1000, Math.round((voters / zones) * (0.9 + 0.2 * rng()))),
        label: `${m.name} · ${k + 1}`,
      });
    }
  });
  return units;
}

function cityUnits(city: CityDef, geo: GeoProvider): UnitRecord[] {
  const rng = rngFor('city-units', city.ibge);
  const outline = geo.cityFeature(city.ibge);
  const [[w, s], [e, n]] = outline
    ? geoBounds(outline)
    : [
        [city.lon - 0.1, city.lat - 0.1],
        [city.lon + 0.1, city.lat + 0.1],
      ];
  const centerLon = (w + e) / 2;
  const centerLat = (s + n) / 2;
  const count = Math.min(330, Math.max(150, city.seats * 6));
  const weights = lognormalWeights(rng, count, 0.55);
  const total = weights.reduce((a, b) => a + b, 0);
  const units: UnitRecord[] = [];
  for (let k = 0; k < count; k++) {
    let lon = centerLon;
    let lat = centerLat;
    for (let attempt = 0; attempt < 200; attempt++) {
      const dense = rng() < 0.5;
      lon = dense ? centerLon + gauss(rng) * (e - w) * 0.18 : w + rng() * (e - w);
      lat = dense ? centerLat + gauss(rng) * (n - s) * 0.18 : s + rng() * (n - s);
      if (!outline || geoContains(outline, [lon, lat])) break;
    }
    units.push({
      mun: Number(city.ibge),
      zone: 0,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      voters: Math.max(300, Math.round((city.electorate * (weights[k] as number)) / total)),
      label: `Local ${k + 1}`,
    });
  }
  return units;
}

export interface MockData {
  dataset(office: OfficeId, code: string): Dataset | null;
  areas(office: OfficeId): Dataset['area'][];
  allDatasets(office: OfficeId): Dataset[];
}

export function createMockData(geo: GeoProvider): MockData {
  const cache = new Map<string, Dataset>();
  const memo = (key: string, build: () => Dataset): Dataset => {
    const hit = cache.get(key);
    if (hit) return hit;
    const built = build();
    cache.set(key, built);
    return built;
  };

  const federalOf = (uf: UfCode) =>
    memo(`federal:${uf}`, () => {
      const seats = FEDERAL_SEATS[uf];
      const units = stateUnits(
        uf,
        geo.municipalities(uf),
        seats * 340000 * (0.85 + 0.3 * rngFor('electorate', uf)()),
      );
      const region = regionOf(uf);
      const strengths = COMPETITORS.map(
        (spec) =>
          spec.strength *
          (spec.region[region] ?? 1) *
          Math.exp(0.35 * gauss(rngFor('strength', uf, spec.id))),
      );
      return buildDataset({
        key: `federal-${MOCK_YEAR.national}-${uf}`,
        year: MOCK_YEAR.national,
        office: 'federal',
        area: { kind: 'state', code: uf, name: UF_NAMES[uf], uf },
        seats,
        units,
        strengths,
        seed: `federal-${uf}`,
      });
    });

  const stateOf = (uf: UfCode) =>
    memo(`state:${uf}`, () => {
      const base = federalOf(uf);
      const region = regionOf(uf);
      const strengths = COMPETITORS.map(
        (spec) =>
          spec.strength *
          (spec.region[region] ?? 1) *
          Math.exp(0.4 * gauss(rngFor('strength-state', uf, spec.id))),
      );
      return buildDataset({
        key: `state-${MOCK_YEAR.national}-${uf}`,
        year: MOCK_YEAR.national,
        office: 'state',
        area: base.area,
        seats: stateSeats(uf),
        units: base.units,
        strengths,
        seed: `state-${uf}`,
      });
    });

  const cityOf = (city: CityDef) =>
    memo(`municipal:${city.ibge}`, () => {
      const strengths = COMPETITORS.map(
        (spec) =>
          spec.strength * Math.exp(0.45 * gauss(rngFor('strength-city', city.ibge, spec.id))),
      );
      return buildDataset({
        key: `municipal-${MOCK_YEAR.municipal}-${city.ibge}`,
        year: MOCK_YEAR.municipal,
        office: 'municipal',
        area: { kind: 'municipality', code: city.ibge, name: city.name, uf: city.uf },
        seats: city.seats,
        units: cityUnits(city, geo),
        strengths,
        seed: `municipal-${city.ibge}`,
      });
    });

  const isUfCode = (code: string): code is UfCode => (UF_CODES as readonly string[]).includes(code);

  const dataset: MockData['dataset'] = (office, code) => {
    if (office === 'municipal') {
      const city = CITIES.find((c) => c.ibge === code);
      return city ? cityOf(city) : null;
    }
    if (!isUfCode(code)) return null;
    if (office === 'federal') return federalOf(code);
    return stateOf(code);
  };

  const areaCodes = (office: OfficeId): string[] =>
    office === 'municipal' ? CITIES.map((c) => c.ibge) : [...UF_CODES];

  return {
    dataset,
    areas: (office) => areaCodes(office).map((code) => (dataset(office, code) as Dataset).area),
    allDatasets: (office) => areaCodes(office).map((code) => dataset(office, code) as Dataset),
  };
}
