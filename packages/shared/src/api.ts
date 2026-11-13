import type {
  AreaRecord,
  ChamberMetrics,
  OfficeId,
  PartyVotes,
  SimulationResult,
  SystemId,
} from './types.js';

/**
 * Contrato HTTP entre `apps/api` e `apps/web`. Todas as rotas são GET, JSON, prefixo `/api/v1`.
 * Os dados são imutáveis por versão (`dataVersion`): clientes devem repassar `?v=<dataVersion>`
 * para que CDN e navegador possam cachear por longos períodos.
 */

export interface AreaSummary {
  /** Sigla da UF (estado) ou código IBGE de 7 dígitos (município). */
  code: string;
  name: string;
  uf: string;
  kind: AreaRecord['kind'];
  seats: number;
  electorate: number;
  validVotes: number;
}

export interface OfficeSummary {
  office: OfficeId;
  year: number;
  seats: number;
  electorate: number;
  /** Sistemas simuláveis para esta casa. */
  systems: SystemId[];
  areas: AreaSummary[];
}

export interface SourceSummary {
  name: string;
  url: string;
  sha256: string;
  etag: string | null;
  bytes: number;
  downloadedAt: string;
}

export interface ValidationEntry {
  key: string;
  seats: number;
  /** Eleitos pelo TSE que o motor de apuração não reproduziu (0 = reprodução exata). */
  missing: number;
}

export interface ValidationReport {
  generatedAt: string;
  /** Regras de apuração testadas contra o resultado oficial. */
  rules: string;
  areas: number;
  exact: number;
  entries: ValidationEntry[];
}

/** GET /api/v1/meta */
export interface MetaResponse {
  dataVersion: string;
  generatedAt: string;
  offices: Record<OfficeId, OfficeSummary>;
  sources: SourceSummary[];
  validation: { areas: number; exact: number } | null;
}

/** [longitude, latitude, distrito, eleitores, município IBGE] */
export type UnitPoint = [lon: number, lat: number, district: number, voters: number, mun: number];

export interface SimulationView {
  result: SimulationResult;
  metrics: ChamberMetrics;
}

/** GET /api/v1/simulate/:office/:area?system=&v= */
export interface SimulateResponse {
  office: OfficeId;
  year: number;
  area: AreaRecord;
  seats: number;
  electorate: number;
  validVotes: number;
  system: SystemId;
  /** Resultado oficial do TSE (sistema `atual`). */
  baseline: SimulationView;
  scenario: SimulationView;
  /** Votos válidos por partido (nominais + legenda). */
  partyVotes: PartyVotes;
  /** Unidades de apuração com o distrito de cada uma; `null` quando o sistema não usa distritos. */
  units: UnitPoint[] | null;
}

export interface ChamberAreaRow {
  code: string;
  name: string;
  seats: number;
  /** Cadeiras no cenário (maior que `seats` quando há cadeiras excedentes no distrital misto). */
  scenarioSeats: number;
  baseline: Record<string, number>;
  scenario: Record<string, number>;
}

export interface ChamberView {
  seatsByParty: Record<string, number>;
  metrics: ChamberMetrics;
}

/** GET /api/v1/chamber/:office?system=&v= — soma de todas as UFs (federal, state). */
export interface ChamberResponse {
  office: OfficeId;
  year: number;
  system: SystemId;
  /** Cadeiras oficiais; o tamanho da casa no cenário está em `scenario.metrics.seats`. */
  seats: number;
  baseline: ChamberView;
  scenario: ChamberView;
  partyVotes: PartyVotes;
  areas: ChamberAreaRow[];
}

/** Corpo de qualquer resposta 4xx/5xx da API. */
export interface ErrorResponse {
  error: {
    code: 'bad_request' | 'not_found' | 'forbidden' | 'rate_limited' | 'internal';
    message: string;
  };
}

/**
 * Geometrias (TopoJSON, imutáveis):
 *  GET /api/v1/geo/br.topo.json        objects.states (properties: id = UF, name)
 *  GET /api/v1/geo/uf/:uf.topo.json    objects.municipalities (id = IBGE, name, uf) e objects.state
 *  GET /api/v1/geo/city/:ibge.topo.json  objects.city (contorno de um município com maior detalhe)
 * Validação: GET /api/v1/validation → ValidationReport
 * Saúde: GET /healthz → { status: 'ok', dataVersion }
 */
export const API_PREFIX = '/api/v1';
