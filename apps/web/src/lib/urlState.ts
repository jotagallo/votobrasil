import { isSystemId, type SystemId } from '@votobr/shared';

export const DEFAULT_SYSTEM: SystemId = 'distrital-misto';

/** Identificadores antigos (versões com dois modelos mistos) continuam abrindo o misto da PEC. */
const LEGACY_SYSTEMS: Record<string, SystemId> = {
  'misto-compensatorio': 'distrital-misto',
  'misto-paralelo': 'distrital-misto',
};

export const MAP_MODES = ['leader', 'change'] as const;
export type MapMode = (typeof MAP_MODES)[number];

export interface ViewState {
  system: SystemId;
  mapMode: MapMode;
  coalition: string[];
}

export const DEFAULT_STATE: ViewState = {
  system: DEFAULT_SYSTEM,
  mapMode: 'leader',
  coalition: [],
};

const PARAM = {
  system: 'sistema',
  map: 'mapa',
  coalition: 'coalizao',
} as const;
const MAP_PARAM: Record<MapMode, string> = { leader: 'lider', change: 'mudanca' };
const MAX_COALITION = 40;
const PARTY_ID = /^[\p{L}\p{N} ._+-]{1,30}$/u;

function parseSystem(raw: string | null): SystemId {
  if (!raw) return DEFAULT_STATE.system;
  if (isSystemId(raw)) return raw;
  return LEGACY_SYSTEMS[raw] ?? DEFAULT_STATE.system;
}

export function decodeState(search: string | URLSearchParams): ViewState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const system = params.get(PARAM.system);
  const map = params.get(PARAM.map);
  const coalition = params.get(PARAM.coalition);

  const mapMode = MAP_MODES.find((m) => MAP_PARAM[m] === map) ?? DEFAULT_STATE.mapMode;
  const parsedCoalition = coalition
    ? [...new Set(coalition.split(',').map((p) => p.trim()))]
        .filter((p) => PARTY_ID.test(p))
        .slice(0, MAX_COALITION)
    : [];

  return {
    system: parseSystem(system),
    mapMode,
    coalition: parsedCoalition,
  };
}

/**
 * O sistema é sempre explícito (`sistema`) para que links compartilhados não mudem de
 * significado se o padrão mudar; mapa e coalizão só aparecem quando diferem do padrão.
 */
export function encodeState(state: Partial<ViewState>): string {
  const params = new URLSearchParams();
  if (state.system !== undefined) params.set(PARAM.system, state.system);
  if (state.mapMode && state.mapMode !== DEFAULT_STATE.mapMode) {
    params.set(PARAM.map, MAP_PARAM[state.mapMode]);
  }
  if (state.coalition && state.coalition.length > 0) {
    params.set(PARAM.coalition, state.coalition.join(','));
  }
  const text = params.toString().replace(/%2C/g, ',');
  return text ? `?${text}` : '';
}

/** Aplica um patch ao estado atual da query, preservando parâmetros desconhecidos. */
export function patchSearch(currentSearch: string, patch: Partial<ViewState>): string {
  const state = { ...decodeState(currentSearch), ...patch };
  // `distritos` era a fração distrital ajustável, removida: o parâmetro antigo é descartado.
  const known = new Set<string>([...Object.values(PARAM), 'distritos']);
  const extras = new URLSearchParams(currentSearch);
  for (const key of known) extras.delete(key);
  const base = encodeState(state);
  const extra = extras.toString();
  if (!extra) return base;
  return base ? `${base}&${extra}` : `?${extra}`;
}
