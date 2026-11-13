import type { ReactNode } from 'react';
import type { MetaResponse } from '@votobr/shared';
import { apiUrls, useApi } from './lib/api';
import { MetaContext } from './meta';

export function MetaProvider({ children }: { children: ReactNode }) {
  const meta = useApi<MetaResponse>(apiUrls.meta());
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}
