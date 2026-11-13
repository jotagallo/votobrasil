import { useMemo } from 'react';
import type { ChamberResponse, OfficeId } from '@votobr/shared';
import { useSystemControls } from '../hooks';
import { useT } from '../i18n';
import { apiUrls } from '../lib/api';
import { assignPartyColors } from '../lib/parties';
import { useMeta, useVersionedApi } from '../meta';
import { AreaList } from './AreaList';
import { BrazilMap } from './BrazilMap';
import { ChamberPanel } from './ChamberPanel';
import { ShareButton } from './ShareButton';
import { SystemSelector } from './SystemSelector';
import { ErrorState, Skeleton } from './states';

type NationalOffice = Extract<OfficeId, 'federal' | 'state'>;

/** Seletor de sistema + resultado somado de todas as UFs + mapa do Brasil (federal ou estadual). */
export function ChamberExplorer({
  office,
  showAreas = false,
}: {
  office: NationalOffice;
  showAreas?: boolean;
}) {
  const { t } = useT();
  const meta = useMeta();
  const controls = useSystemControls(office);
  const { state, system, systems, query } = controls;

  const chamber = useVersionedApi<ChamberResponse>(
    (version) => apiUrls.chamber({ office, system, version }),
    { keepPrevious: true },
  );

  const data = chamber.data;
  const colors = useMemo(() => {
    if (!data) return {};
    return assignPartyColors([
      ...Object.keys(data.baseline.seatsByParty),
      ...Object.keys(data.scenario.seatsByParty),
      ...Object.keys(data.partyVotes),
    ]);
  }, [data]);

  return (
    <div className="explorer">
      <div className="explorer__toolbar">
        <SystemSelector systems={systems} system={system} onSystem={controls.onSystem} />
        <ShareButton title={t(`explorer.${office}.title`)} text={t('explorer.shareText')} />
      </div>

      {chamber.status === 'error' && !data ? <ErrorState onRetry={chamber.reload} /> : null}
      {!data && chamber.status !== 'error' ? <Skeleton height={420} /> : null}

      {data ? (
        <>
          <ChamberPanel
            baseline={data.baseline.seatsByParty}
            scenario={data.scenario.seatsByParty}
            baselineMetrics={data.baseline.metrics}
            scenarioMetrics={data.scenario.metrics}
            partyVotes={data.partyVotes}
            scenarioLabel={t('chamber.scenarioNamed', { system: t(`systems.${system}.short`) })}
            isBaselineScenario={system === 'atual'}
            colors={colors}
            stale={chamber.stale}
          />
          <BrazilMap
            office={office}
            rows={data.areas}
            colors={colors}
            mode={state.mapMode}
            onMode={controls.onMapMode}
            query={query}
          />
        </>
      ) : null}

      {showAreas && meta.status === 'success' ? (
        <section className="explorer__areas">
          <h3 className="subhead">{t(`house.${office}.areasTitle`)}</h3>
          <AreaList office={office} areas={meta.data.offices[office].areas} query={query} />
        </section>
      ) : null}
    </div>
  );
}
