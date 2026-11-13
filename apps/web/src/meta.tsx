import { createContext, useContext } from 'react';
import type { MetaResponse } from '@votobr/shared';
import { useApi, type ApiResult } from './lib/api';

// O provedor fica em MetaProvider.tsx: arquivos que exportam componentes e hooks juntos
// quebram o Fast Refresh e podem duplicar o contexto durante o HMR.
export const MetaContext = createContext<ApiResult<MetaResponse> | null>(null);

export function useMeta(): ApiResult<MetaResponse> {
  const value = useContext(MetaContext);
  if (!value) throw new Error('useMeta fora do MetaProvider');
  return value;
}

/**
 * Busca um recurso versionado (`?v=<dataVersion>`): espera o `meta`, propaga seu erro e só então
 * monta a URL do recurso.
 */
export function useVersionedApi<T>(
  build: (version: string) => string | null,
  options: { keepPrevious?: boolean } = {},
): ApiResult<T> {
  const meta = useMeta();
  const version = meta.status === 'success' ? meta.data.dataVersion : null;
  const url = version ? build(version) : null;
  const result = useApi<T>(url, options);
  if (meta.status === 'error') {
    return {
      status: 'error',
      data: undefined,
      error: meta.error,
      stale: false,
      reload: meta.reload,
    };
  }
  if (meta.status !== 'success') {
    return { status: 'loading', data: undefined, stale: false, reload: meta.reload };
  }
  return result;
}
