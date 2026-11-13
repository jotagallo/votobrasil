import { useMemo } from 'react';
import type { ChamberResponse } from '@votobr/shared';
import { trackEvent } from '../analytics';
import { Paragraphs, Rich } from '../components/Rich';
import { SystemSelector } from '../components/SystemSelector';
import { ErrorState, Skeleton } from '../components/states';
import { useSystemControls, usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { apiUrls } from '../lib/api';
import {
  coalitionStatus,
  largestPartiesForMajority,
  sanitizeCoalition,
  toggleParty,
} from '../lib/coalition';
import { assignPartyColors, rankParties, type SeatMap } from '../lib/parties';
import { PATHS } from '../lib/routes';
import { useVersionedApi } from '../meta';

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="bullets">
      {items.map((item, i) => (
        <li key={i}>
          <Rich text={item} />
        </li>
      ))}
    </ul>
  );
}

function MajorityPath({
  title,
  seats,
  majority,
  colors,
}: {
  title: string;
  seats: SeatMap;
  majority: number;
  colors: Record<string, string>;
}) {
  const { t, f } = useT();
  const parties = largestPartiesForMajority(seats, majority);
  let cumulative = 0;
  return (
    <div className="majority-path">
      <h4 className="majority-path__title">{title}</h4>
      <p className="majority-path__count">
        <strong>{f.int(parties.length)}</strong>
        <span>{t('semi.gov.partiesNeeded', { count: parties.length })}</span>
      </p>
      <ol className="majority-path__list">
        {parties.map((party) => {
          cumulative += seats[party] ?? 0;
          return (
            <li key={party}>
              <i className="swatch" style={{ background: colors[party] }} aria-hidden="true" />
              <span className="majority-path__party">{party}</span>
              <span className="num">{f.int(seats[party] ?? 0)}</span>
              <span className="num muted">
                {t('semi.gov.cumulative', { total: f.int(cumulative) })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Meter({
  total,
  seatsTotal,
  majority,
}: {
  total: number;
  seatsTotal: number;
  majority: number;
}) {
  const reached = total >= majority;
  const width = seatsTotal > 0 ? Math.min(100, (total / seatsTotal) * 100) : 0;
  const mark = seatsTotal > 0 ? (majority / seatsTotal) * 100 : 50;
  return (
    <svg className="meter" width="100%" height="28" aria-hidden="true" focusable="false">
      <rect x="0" y="6" width="100%" height="16" rx="8" fill="#E4EAF3" />
      <rect
        x="0"
        y="6"
        width={`${width}%`}
        height="16"
        rx="8"
        fill={reached ? '#007A33' : '#0B4DA2'}
      />
      <rect x={`${mark}%`} y="0" width="2" height="28" rx="1" fill="#0A1B3D" />
    </svg>
  );
}

function CoalitionResult({
  label,
  seats,
  selected,
  majority,
  seatsTotal,
}: {
  label: string;
  seats: SeatMap;
  selected: string[];
  majority: number;
  seatsTotal: number;
}) {
  const { t, f } = useT();
  const status = coalitionStatus(seats, selected, majority);
  return (
    <div className="coalition__result">
      <h4 className="coalition__label">{label}</h4>
      <p className="coalition__total">
        <strong>{f.int(status.total)}</strong>
        <span className="muted"> / {f.int(seatsTotal)}</span>
      </p>
      <Meter total={status.total} seatsTotal={seatsTotal} majority={majority} />
      <p className={status.hasMajority ? 'coalition__status is-ok' : 'coalition__status'}>
        {status.hasMajority
          ? t('semi.coalition.reached', {
              surplus: f.int(status.surplus),
              majority: f.int(majority),
            })
          : t('semi.coalition.missing', {
              missing: f.int(status.missing),
              majority: f.int(majority),
            })}
      </p>
    </div>
  );
}

function Governability() {
  const { t, f } = useT();
  const controls = useSystemControls('federal');
  const { state, system } = controls;
  const chamber = useVersionedApi<ChamberResponse>(
    (version) => apiUrls.chamber({ office: 'federal', system, version }),
    { keepPrevious: true },
  );
  const data = chamber.data;
  const baseline = data?.baseline.seatsByParty;
  const scenario = data?.scenario.seatsByParty;

  const model = useMemo(() => {
    if (!baseline || !scenario) return null;
    const ids = rankParties(baseline, scenario);
    const available: SeatMap = {};
    for (const id of ids) available[id] = Math.max(baseline[id] ?? 0, scenario[id] ?? 0);
    return { ids, available, colors: assignPartyColors(ids) };
  }, [baseline, scenario]);

  const selected = model ? sanitizeCoalition(state.coalition, model.available) : [];
  const update = (next: string[]) => controls.setCoalition(next);

  return (
    <div className="governability">
      <SystemSelector systems={controls.systems} system={system} onSystem={controls.onSystem} />

      {chamber.status === 'error' && !data ? <ErrorState onRetry={chamber.reload} /> : null}
      {!data && chamber.status !== 'error' ? <Skeleton height={360} /> : null}

      {data && baseline && scenario && model ? (
        <div className={chamber.stale ? 'is-stale' : undefined}>
          <h3 className="subhead">{t('semi.gov.majorityTitle')}</h3>
          <p className="muted">
            {t('semi.gov.majorityLede', {
              majority: f.int(data.scenario.metrics.majority),
              seats: f.int(data.scenario.metrics.seats),
            })}
          </p>
          <div className="majority-paths">
            <MajorityPath
              title={t('chamber.official')}
              seats={baseline}
              majority={data.baseline.metrics.majority}
              colors={model.colors}
            />
            <MajorityPath
              title={t('chamber.scenarioNamed', { system: t(`systems.${system}.short`) })}
              seats={scenario}
              majority={data.scenario.metrics.majority}
              colors={model.colors}
            />
          </div>

          <h3 className="subhead">{t('semi.coalition.title')}</h3>
          <p className="muted">{t('semi.coalition.lede')}</p>
          <div
            className="chips chips--parties"
            role="group"
            aria-label={t('semi.coalition.groupLabel')}
          >
            {model.ids.map((id) => {
              const on = selected.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={on ? 'chip chip--toggle is-selected' : 'chip chip--toggle'}
                  aria-pressed={on}
                  onClick={() => {
                    trackEvent('coalition_toggle', { party: id, selected: !on });
                    update(toggleParty(selected, id));
                  }}
                >
                  <i
                    className="swatch"
                    style={{ background: model.colors[id] }}
                    aria-hidden="true"
                  />
                  <span>{id}</span>
                  <small className="num">
                    {f.int(baseline[id] ?? 0)} → {f.int(scenario[id] ?? 0)}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="coalition__actions">
            <button
              type="button"
              className="link-button"
              onClick={() => update([])}
              disabled={selected.length === 0}
            >
              {t('semi.coalition.clear')}
            </button>
          </div>
          <div className="coalition__results" aria-live="polite">
            <CoalitionResult
              label={t('chamber.official')}
              seats={baseline}
              selected={selected}
              majority={data.baseline.metrics.majority}
              seatsTotal={data.baseline.metrics.seats}
            />
            <CoalitionResult
              label={t('chamber.scenarioNamed', { system: t(`systems.${system}.short`) })}
              seats={scenario}
              selected={selected}
              majority={data.scenario.metrics.majority}
              seatsTotal={data.scenario.metrics.seats}
            />
          </div>
          <p className="muted">{t('semi.coalition.caveat')}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function SemipresidentialismPage() {
  const { t, tl } = useT();
  usePageMeta({
    title: t('meta.semi.title'),
    description: t('meta.semi.description'),
    path: PATHS.semipresidentialism,
  });

  return (
    <div className="container page">
      <p className="eyebrow">{t('nav.semipresidentialism')}</p>
      <h1 className="page-title">{t('semi.title')}</h1>
      <p className="section-lede">{t('semi.lede')}</p>

      <section className="prose-section" aria-labelledby="semi-what">
        <h2 id="semi-what" className="section-title">
          {t('semi.what.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('semi.what.body')} />
        </div>
      </section>

      <section className="prose-section" aria-labelledby="semi-pec">
        <h2 id="semi-pec" className="section-title">
          {t('semi.pec.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('semi.pec.intro')} />
          <BulletList items={tl('semi.pec.points')} />
          <p className="notice">
            <Rich text={t('semi.pec.caveat')} />
          </p>
        </div>
      </section>

      <section className="prose-section" aria-labelledby="semi-debate">
        <h2 id="semi-debate" className="section-title">
          {t('semi.debate.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('semi.debate.intro')} />
          <div className="pros-cons">
            <div>
              <h3 className="subhead">{t('semi.debate.prosTitle')}</h3>
              <BulletList items={tl('semi.debate.pros')} />
            </div>
            <div>
              <h3 className="subhead">{t('semi.debate.consTitle')}</h3>
              <BulletList items={tl('semi.debate.cons')} />
            </div>
          </div>
        </div>
      </section>

      <section className="prose-section" aria-labelledby="semi-gov">
        <h2 id="semi-gov" className="section-title">
          {t('semi.gov.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('semi.gov.body')} />
        </div>
        <Governability />
      </section>

      <section className="prose-section" aria-labelledby="semi-future">
        <h2 id="semi-future" className="section-title">
          {t('semi.future.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('semi.future.body')} />
        </div>
      </section>
    </div>
  );
}
