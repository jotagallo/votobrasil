import { Suspense, lazy, useEffect, useMemo } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  SYSTEMS,
  UF_NAMES,
  type OfficeId,
  type SimulateResponse,
  type SystemId,
} from '@votobr/shared';
import { trackEvent } from '../analytics';
import { ChamberPanel } from '../components/ChamberPanel';
import { Rich } from '../components/Rich';
import { ShareButton } from '../components/ShareButton';
import { SystemSelector } from '../components/SystemSelector';
import { WinnersLosers } from '../components/Winners';
import { ErrorState, Skeleton } from '../components/states';
import { usePageMeta, useSystemControls } from '../hooks';
import { useT } from '../i18n';
import { apiUrls } from '../lib/api';
import { assignPartyColors } from '../lib/parties';
import { PATHS, areaPath, housePath, isOffice } from '../lib/routes';
import { useMeta, useVersionedApi } from '../meta';
import NotFoundPage from './NotFoundPage';

const StateDistrictMap = lazy(() =>
  import('../components/DistrictMap').then((m) => ({ default: m.StateDistrictMap })),
);
const CityDistrictMap = lazy(() =>
  import('../components/DistrictMap').then((m) => ({ default: m.CityDistrictMap })),
);

function findArea(meta: ReturnType<typeof useMeta>, office: OfficeId, param: string) {
  if (meta.status !== 'success') return undefined;
  return meta.data.offices[office].areas.find(
    (a) => a.code === param || (office !== 'municipal' && a.code === param.toUpperCase()),
  );
}

export default function AreaPage() {
  const params = useParams<{ office: string; area: string }>();
  const meta = useMeta();
  if (!isOffice(params.office) || !params.area) return <NotFoundPage />;
  if (meta.status === 'success' && !findArea(meta, params.office, params.area))
    return <NotFoundPage />;
  return <AreaView office={params.office} areaParam={params.area} />;
}

function AreaView({ office, areaParam }: { office: OfficeId; areaParam: string }) {
  const { t, f } = useT();
  const [, navigate] = useLocation();
  const meta = useMeta();
  const controls = useSystemControls(office);
  const system: SystemId = controls.system;

  const area = findArea(meta, office, areaParam);

  const sim = useVersionedApi<SimulateResponse>(
    (version) =>
      area
        ? apiUrls.simulate({
            office,
            area: area.code,
            system,
            version,
          })
        : null,
    { keepPrevious: true },
  );

  const areaName =
    area && office !== 'municipal'
      ? (UF_NAMES[area.code as keyof typeof UF_NAMES] ?? area.name)
      : (area?.name ?? areaParam);
  const houseName = t(`houses.${office}.name`);

  usePageMeta({
    title: t('meta.area.title', { name: areaName, house: t(`houses.${office}.short`) }),
    description: t('meta.area.description', { name: areaName, house: houseName }),
    path: areaPath(office, areaParam),
  });

  useEffect(() => {
    if (area) trackEvent('area_change', { office, area: area.code });
  }, [office, area]);

  const data = sim.data;
  const colors = useMemo(() => {
    if (!data) return {};
    return assignPartyColors([
      ...Object.keys(data.baseline.result.seatsByParty),
      ...Object.keys(data.scenario.result.seatsByParty),
      ...Object.keys(data.partyVotes),
    ]);
  }, [data]);

  const usesDistricts = SYSTEMS.find((s) => s.id === system)?.usesDistricts ?? false;
  const mixed = system === 'distrital-misto';
  const deviation = data?.scenario.result.maxDistrictDeviationPct;
  const unitLevel = office === 'municipal' ? t('area.unit.votingPlace') : t('area.unit.zone');

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
        <Link href={PATHS.home}>{t('nav.home')}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`${housePath(office)}${controls.query}`}>{t(`houses.${office}.short`)}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{areaName}</span>
      </nav>

      <div className="area-head">
        <div>
          <p className="eyebrow">{houseName}</p>
          <h1 className="page-title">{areaName}</h1>
          {area ? (
            <p className="area-head__facts">
              {t('area.facts', {
                seats: f.int(area.seats),
                electorate: f.int(area.electorate),
                year: meta.status === 'success' ? meta.data.offices[office].year : '',
              })}
            </p>
          ) : null}
        </div>
        <div className="area-head__tools">
          {meta.status === 'success' ? (
            <div className="field">
              <label htmlFor="area-select" className="field__label">
                {t('area.switch')}
              </label>
              <select
                id="area-select"
                className="select"
                value={area?.code ?? ''}
                onChange={(event) =>
                  navigate(`${areaPath(office, event.target.value)}${controls.query}`)
                }
              >
                {[...meta.data.offices[office].areas]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((a) => (
                    <option key={a.code} value={a.code}>
                      {office === 'municipal'
                        ? `${a.name} (${a.uf})`
                        : (UF_NAMES[a.code as keyof typeof UF_NAMES] ?? a.name)}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <ShareButton title={`${areaName} — ${houseName}`} text={t('explorer.shareText')} />
        </div>
      </div>

      <SystemSelector systems={controls.systems} system={system} onSystem={controls.onSystem} />

      {sim.status === 'error' && !data ? <ErrorState onRetry={sim.reload} /> : null}
      {!data && sim.status !== 'error' ? <Skeleton height={420} /> : null}

      {data ? (
        <div
          className={sim.stale ? 'area-results is-stale' : 'area-results'}
          aria-busy={sim.stale ? 'true' : 'false'}
        >
          {usesDistricts ? (
            <aside className="notice" aria-label={t('area.districtNoticeLabel')}>
              <p>
                <Rich
                  text={t('area.districtNotice', {
                    level: unitLevel,
                    units: f.int(data.units?.length ?? 0),
                  })}
                />
              </p>
              {mixed ? (
                <p>
                  {t('area.mixedSplit', {
                    district: f.int(data.scenario.result.districtSeats),
                    list: f.int(data.scenario.result.listSeats),
                  })}
                </p>
              ) : null}
              {deviation !== undefined ? (
                <p className={deviation >= 20 ? 'notice__alert' : undefined}>
                  {t('area.deviation', { value: f.dec(deviation, 1) })}
                </p>
              ) : null}
            </aside>
          ) : null}

          <ChamberPanel
            baseline={data.baseline.result.seatsByParty}
            scenario={data.scenario.result.seatsByParty}
            baselineMetrics={data.baseline.metrics}
            scenarioMetrics={data.scenario.metrics}
            partyVotes={data.partyVotes}
            scenarioLabel={t('chamber.scenarioNamed', { system: t(`systems.${system}.short`) })}
            isBaselineScenario={system === 'atual'}
            colors={colors}
            stale={sim.stale}
          />

          {data.units && data.units.length > 0 ? (
            <Suspense fallback={<Skeleton height={320} />}>
              {office === 'municipal' ? (
                <CityDistrictMap
                  ibge={data.area.code}
                  units={data.units}
                  districts={data.scenario.result.districts}
                  partyColors={colors}
                />
              ) : (
                <StateDistrictMap
                  uf={data.area.code}
                  units={data.units}
                  districts={data.scenario.result.districts}
                  partyColors={colors}
                />
              )}
            </Suspense>
          ) : null}

          {system !== 'atual' ? (
            <WinnersLosers
              baseline={data.baseline.result.winners}
              scenario={data.scenario.result.winners}
              colors={colors}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
