export const SYSTEM_IDS = [
  'atual',
  'lista-fechada',
  'distritao',
  'distrital-puro',
  'distrital-misto',
] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

export const OFFICE_IDS = ['federal', 'state', 'municipal'] as const;
export type OfficeId = (typeof OFFICE_IDS)[number];

export const LOCALES = ['pt-BR', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

export type OfficialStatus = 'QP' | 'MEDIA' | 'MAJ' | 'SUPLENTE' | 'NAO';

/** Unidade geográfica mínima de apuração (zona eleitoral ou agrupamento de locais de votação). */
export interface UnitRecord {
  /** Código IBGE do município (7 dígitos). */
  mun: number;
  /** Zona eleitoral (0 quando a unidade é um agrupamento de locais de votação). */
  zone: number;
  lat: number;
  lon: number;
  /** Eleitores aptos. */
  voters: number;
  /**
   * População (Censo 2022) atribuída à unidade: a do município, repartida entre as suas unidades
   * proporcionalmente aos eleitores. É o peso usado para equilibrar os distritos.
   */
  pop?: number;
  label?: string;
}

/** Nome de referência de um distrito, montado no ETL. */
export interface DistrictLabel {
  /** Município principal (Assembleias/Câmara) ou bairro principal (Câmaras Municipais). */
  main: string;
  /** Bairros de referência — quando o distrito é parte de um município dividido, ou numa cidade. */
  hoods?: string[];
  /** Quantos outros municípios (inteiros ou em parte) o distrito inclui. */
  others?: number;
}

/** Local de votação de um município dividido entre distritos: [lon, lat, distrito, eleitores, unidade]. */
export type PlanPoint = [lon: number, lat: number, district: number, voters: number, unit: number];

/** Desenho de distritos pré-calculado no ETL para um número `k` de distritos. */
export interface DistrictPlanRecord {
  /** Distrito (0..k-1) de cada unidade, na ordem de `Dataset.units` — o da maior parte dos eleitores. */
  unitDistrict: number[];
  labels: DistrictLabel[];
  /**
   * Locais de votação dos municípios divididos entre distritos. Uma unidade (zona) com locais em
   * mais de um distrito tem os votos repartidos na proporção dos eleitores de cada parte.
   */
  points?: PlanPoint[];
}

/** Partido isolado ou federação: é a entidade que concorre às cadeiras. */
export interface CompetitorRecord {
  id: string;
  label: string;
  parties: string[];
  /** Votos de legenda válidos (inclui votos nominais convertidos em legenda). */
  legend: number;
  /** Votos de legenda por partido-membro. */
  legendByParty: Record<string, number>;
  /** Pares planos [unidade, votos, ...] de legenda por unidade. */
  legendByUnit: number[];
}

export interface CandidateRecord {
  id: string;
  name: string;
  number: number;
  party: string;
  /** Índice em `competitors`. */
  comp: number;
  /** Votos nominais válidos totais. */
  votes: number;
  /** Pares planos [unidade, votos, ...]. */
  u: number[];
  status: OfficialStatus;
}

export interface AreaRecord {
  kind: 'state' | 'municipality';
  /** Sigla da UF (estado) ou código IBGE (município). */
  code: string;
  name: string;
  uf: string;
}

export interface Dataset {
  schema: 1;
  key: string;
  year: number;
  office: OfficeId;
  area: AreaRecord;
  seats: number;
  electorate: number;
  validVotes: number;
  units: UnitRecord[];
  competitors: CompetitorRecord[];
  candidates: CandidateRecord[];
  /** Desenhos de distritos por número de distritos (chave = k). Sem plano, usa-se `planDistricts`. */
  districtPlans?: Record<string, DistrictPlanRecord>;
}

export interface Winner {
  name: string;
  party: string;
  competitor: string;
  votes: number;
  tier: 'oficial' | 'qp' | 'sobra' | 'lista' | 'distrito' | 'mais-votados';
  district?: number;
}

export interface DistrictResult {
  id: number;
  voters: number;
  /** População estimada (Censo 2022). */
  population: number;
  label?: DistrictLabel;
  /** Municípios (IBGE) com ao menos uma unidade no distrito. */
  mun: number[];
  winnerParty: string;
  winnerCompetitor: string;
  /** Diferença entre 1º e 2º colocados, em pontos percentuais dos votos válidos do distrito. */
  marginPct: number;
}

export interface SimulationResult {
  system: SystemId;
  areaKey: string;
  seats: number;
  districtSeats: number;
  listSeats: number;
  /** Cadeiras excedentes: vitórias distritais além da cota proporcional do partido (PEC 2/2025, art. 45, § 4º). */
  overhangSeats: number;
  seatsByParty: Record<string, number>;
  winners: Winner[];
  districts?: DistrictResult[];
  /** Distrito de cada unidade do dataset (mesma ordem de `Dataset.units`). Uso interno. */
  unitDistrict?: number[];
  /**
   * Pontos do mapa de distritos [lon, lat, distrito, eleitores, município]: as unidades inteiras e,
   * nos municípios divididos, os locais de votação. Uso interno (a API envia como `units`).
   */
  mapPoints?: [number, number, number, number, number][];
  /** Maior desvio relativo de população entre distritos e a média, em %. */
  maxDistrictDeviationPct?: number;
}

export interface PartyVotes {
  [party: string]: number;
}

export interface ChamberMetrics {
  seats: number;
  majority: number;
  gallagher: number;
  effectiveParties: number;
  partiesWithSeats: number;
  /** Menor número de partidos (maiores bancadas) que somam maioria. */
  partiesForMajority: number;
  largestShare: number;
  /** % de votos válidos em partidos que não elegeram ninguém. */
  votesWithoutSeatPct: number;
}
