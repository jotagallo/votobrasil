import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';
import { SYSTEM_IDS, type OfficeId, type SystemId } from '@votobr/shared';
import { trackEvent, trackPageview } from './analytics';
import { useLocale } from './i18n';
import { withLocale } from './lib/routes';
import { decodeState, encodeState, patchSearch, type ViewState } from './lib/urlState';
import { useMeta } from './meta';
import { applyPageMeta } from './seo';

/** Estado compartilhável (sistema, fração distrital, mapa, coalizão) espelhado na query da URL. */
export function useViewState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const state = useMemo(() => decodeState(search), [search]);
  const update = useCallback(
    (patch: Partial<ViewState>) =>
      navigate(`${location}${patchSearch(search, patch)}`, { replace: true }),
    [location, search, navigate],
  );
  return [state, update];
}

/** Atualiza título, descrição, hreflang etc. e registra a visualização de página. */
export function usePageMeta(input: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): void {
  const locale = useLocale();
  const { title, description, path, noindex } = input;
  useEffect(() => {
    applyPageMeta({ locale, title, description, path, noindex });
  }, [locale, title, description, path, noindex]);
  useEffect(() => {
    trackPageview(withLocale(locale, path));
  }, [locale, path]);
}

export interface SystemControls {
  state: ViewState;
  systems: readonly SystemId[];
  /** Sistema efetivo (padrão quando o da URL não é simulável para a casa). */
  system: SystemId;
  onSystem: (system: SystemId) => void;
  onMapMode: (mode: ViewState['mapMode']) => void;
  setCoalition: (coalition: string[]) => void;
  /** Query a anexar aos links internos para manter o sistema escolhido. */
  query: string;
}

export function useSystemControls(office: OfficeId): SystemControls {
  const [state, update] = useViewState();
  const search = useSearch();
  const meta = useMeta();
  const systems: readonly SystemId[] =
    meta.status === 'success'
      ? meta.data.offices[office].systems.filter((s) => SYSTEM_IDS.includes(s))
      : SYSTEM_IDS;
  const system = systems.includes(state.system) ? state.system : (systems[0] ?? state.system);
  const hasExplicitSystem = new URLSearchParams(search).has('sistema');
  const query = hasExplicitSystem ? encodeState({ system }) : '';

  return {
    state,
    systems,
    system,
    onSystem: (next) => {
      trackEvent('system_change', { system: next, office });
      update({ system: next });
    },
    onMapMode: (mapMode) => update({ mapMode }),
    setCoalition: (coalition) => update({ coalition }),
    query,
  };
}
