import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { API_PREFIX, type OfficeId, type SystemId } from '@votobr/shared';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

export const apiUrls = {
  meta: () => `${API_PREFIX}/meta`,
  validation: (version: string) => withQuery(`${API_PREFIX}/validation`, { v: version }),
  simulate: (args: { office: OfficeId; area: string; system: SystemId; version: string }) =>
    withQuery(`${API_PREFIX}/simulate/${args.office}/${encodeURIComponent(args.area)}`, {
      system: args.system,
      v: args.version,
    }),
  chamber: (args: { office: OfficeId; system: SystemId; version: string }) =>
    withQuery(`${API_PREFIX}/chamber/${args.office}`, {
      system: args.system,
      v: args.version,
    }),
  geoBrazil: (version: string) => withQuery(`${API_PREFIX}/geo/br.topo.json`, { v: version }),
  geoState: (uf: string, version: string) =>
    withQuery(`${API_PREFIX}/geo/uf/${encodeURIComponent(uf)}.topo.json`, { v: version }),
  geoCity: (ibge: string, version: string) =>
    withQuery(`${API_PREFIX}/geo/city/${encodeURIComponent(ibge)}.topo.json`, { v: version }),
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status} — ${url}`);
  return (await response.json()) as T;
}

type Entry =
  { status: 'loading' } | { status: 'success'; data: unknown } | { status: 'error'; error: Error };

const MAX_ENTRIES = 80;
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(url: string): void {
  listeners.get(url)?.forEach((fn) => fn());
}

function evict(): void {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) break;
    if (entry.status !== 'loading' && !(listeners.get(key)?.size ?? 0)) entries.delete(key);
  }
}

function ensureLoaded(url: string): void {
  const current = entries.get(url);
  if (current && current.status !== 'error') return;
  entries.set(url, { status: 'loading' });
  notify(url);
  fetchJson<unknown>(url).then(
    (data) => {
      entries.set(url, { status: 'success', data });
      evict();
      notify(url);
    },
    (error: unknown) => {
      entries.set(url, {
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      notify(url);
    },
  );
}

function subscribe(url: string | null, callback: () => void): () => void {
  if (!url) return () => undefined;
  let set = listeners.get(url);
  if (!set) {
    set = new Set();
    listeners.set(url, set);
  }
  set.add(callback);
  return () => {
    set.delete(callback);
  };
}

export type ApiResult<T> =
  | { status: 'idle'; data: undefined; stale: false; reload: () => void }
  | { status: 'loading'; data: T | undefined; stale: boolean; reload: () => void }
  | { status: 'success'; data: T; stale: false; reload: () => void }
  | { status: 'error'; data: T | undefined; error: Error; stale: boolean; reload: () => void };

/**
 * Busca JSON com cache em memória compartilhado. Com `keepPrevious`, enquanto a nova URL carrega
 * a tela continua exibindo o último resultado (marcado como `stale`), sem piscar.
 */
export function useApi<T>(
  url: string | null,
  options: { keepPrevious?: boolean } = {},
): ApiResult<T> {
  const entry = useSyncExternalStore(
    useCallback((cb) => subscribe(url, cb), [url]),
    () => (url ? entries.get(url) : undefined),
    () => undefined,
  );
  const previous = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (url) ensureLoaded(url);
  }, [url]);

  const reload = useCallback(() => {
    if (!url) return;
    entries.delete(url);
    ensureLoaded(url);
  }, [url]);

  useEffect(() => {
    if (entry?.status === 'success') previous.current = entry.data as T;
  }, [entry]);

  if (!url) return { status: 'idle', data: undefined, stale: false, reload };
  if (entry?.status === 'success') {
    return { status: 'success', data: entry.data as T, stale: false, reload };
  }
  const fallback = options.keepPrevious ? previous.current : undefined;
  if (entry?.status === 'error') {
    return {
      status: 'error',
      data: fallback,
      error: entry.error,
      stale: fallback !== undefined,
      reload,
    };
  }
  return { status: 'loading', data: fallback, stale: fallback !== undefined, reload };
}

/** Só para testes. */
export function clearApiCache(): void {
  entries.clear();
}
