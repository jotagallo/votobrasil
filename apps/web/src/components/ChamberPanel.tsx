import { useMemo, useState } from 'react';
import type { ChamberMetrics, PartyVotes } from '@votobr/shared';
import { useT } from '../i18n';
import {
  OTHERS_COLOR,
  OTHERS_ID,
  assignPartyColors,
  collapseSeats,
  groupParties,
  rankParties,
  seatsChanged,
  sumSeats,
  type SeatMap,
} from '../lib/parties';
import { Hemicycle } from './Hemicycle';

interface PanelProps {
  baseline: SeatMap;
  scenario: SeatMap;
  baselineMetrics: ChamberMetrics;
  scenarioMetrics: ChamberMetrics;
  partyVotes: PartyVotes;
  scenarioLabel: string;
  colors?: Record<string, string>;
  /** Resultado do cenário igual ao oficial (sistema `atual`). */
  isBaselineScenario: boolean;
  stale?: boolean;
}

function useColors(
  baseline: SeatMap,
  scenario: SeatMap,
  votes: PartyVotes,
): Record<string, string> {
  return useMemo(
    () =>
      assignPartyColors([
        ...new Set([...Object.keys(baseline), ...Object.keys(scenario), ...Object.keys(votes)]),
      ]),
    [baseline, scenario, votes],
  );
}

function usePartyLabel(): (id: string, othersCount?: number) => string {
  const { t } = useT();
  return (id, othersCount) =>
    id === OTHERS_ID ? t('chamber.others', { count: othersCount ?? 0 }) : id;
}

function Delta({ value }: { value: number }) {
  const { f } = useT();
  if (value === 0) return <span className="delta delta--zero">0</span>;
  return (
    <span className={value > 0 ? 'delta delta--up' : 'delta delta--down'}>{f.signed(value)}</span>
  );
}

export function SeatBars({
  baseline,
  scenario,
  colors,
  showAll,
}: {
  baseline: SeatMap;
  scenario: SeatMap;
  colors: Record<string, string>;
  showAll: boolean;
}) {
  const { t, f } = useT();
  const label = usePartyLabel();
  const groups = useMemo(
    () =>
      showAll
        ? { shown: rankParties(baseline, scenario), others: [] }
        : groupParties(baseline, scenario, 10),
    [baseline, scenario, showAll],
  );
  const base = useMemo(() => collapseSeats(baseline, groups), [baseline, groups]);
  const scen = useMemo(() => collapseSeats(scenario, groups), [scenario, groups]);
  const ids = [...groups.shown, ...(groups.others.length ? [OTHERS_ID] : [])];
  const max = Math.max(1, ...ids.map((id) => Math.max(base[id] ?? 0, scen[id] ?? 0)));

  return (
    <div className="bars">
      <div className="bars__head" aria-hidden="true">
        <span className="bars__spacer" />
        <span className="bars__legend">
          <span className="bars__legend-item">
            <i className="key key--outline" /> {t('chamber.official')}
          </span>
          <span className="bars__legend-item">
            <i className="key key--solid" /> {t('chamber.scenario')}
          </span>
        </span>
        <span className="num">{t('chamber.officialShort')}</span>
        <span className="num">{t('chamber.scenarioShort')}</span>
        <span className="num">Δ</span>
      </div>
      <ul className="bars__list">
        {ids.map((id) => {
          const b = base[id] ?? 0;
          const s = scen[id] ?? 0;
          const color = id === OTHERS_ID ? OTHERS_COLOR : (colors[id] ?? OTHERS_COLOR);
          return (
            <li key={id} className="bars__row">
              <span className="bars__label">
                <i className="swatch" style={{ background: color }} aria-hidden="true" />
                {label(id, groups.others.length)}
              </span>
              <svg
                className="bars__chart"
                height="22"
                width="100%"
                aria-hidden="true"
                focusable="false"
              >
                <rect
                  x="0"
                  y="2"
                  width={`${(b / max) * 100}%`}
                  height="7"
                  rx="3.5"
                  fill={color}
                  fillOpacity="0.28"
                  stroke={color}
                  strokeWidth="1"
                />
                <rect x="0" y="11" width={`${(s / max) * 100}%`} height="9" rx="4.5" fill={color} />
              </svg>
              <span className="num">{f.int(b)}</span>
              <span className="num num--strong">{f.int(s)}</span>
              <Delta value={s - b} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SeatTable({
  baseline,
  scenario,
  partyVotes,
}: {
  baseline: SeatMap;
  scenario: SeatMap;
  partyVotes: PartyVotes;
}) {
  const { t, f } = useT();
  const rows = useMemo(() => {
    const totalVotes = Object.values(partyVotes).reduce((a, b) => a + b, 0);
    const ids = new Set([
      ...Object.keys(baseline),
      ...Object.keys(scenario),
      ...Object.keys(partyVotes),
    ]);
    return [...ids]
      .map((id) => ({
        id,
        votes: partyVotes[id] ?? 0,
        voteShare: totalVotes > 0 ? ((partyVotes[id] ?? 0) / totalVotes) * 100 : 0,
        base: baseline[id] ?? 0,
        scen: scenario[id] ?? 0,
      }))
      .sort(
        (a, b) =>
          Math.max(b.base, b.scen) - Math.max(a.base, a.scen) ||
          b.votes - a.votes ||
          a.id.localeCompare(b.id),
      );
  }, [baseline, scenario, partyVotes]);

  return (
    <details className="table-toggle">
      <summary>{t('chamber.viewTable')}</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('chamber.tableLabel')}>
        <table className="data-table">
          <caption className="sr-only">{t('chamber.tableLabel')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('chamber.party')}</th>
              <th scope="col" className="num">
                {t('chamber.votes')}
              </th>
              <th scope="col" className="num">
                {t('chamber.voteShare')}
              </th>
              <th scope="col" className="num">
                {t('chamber.official')}
              </th>
              <th scope="col" className="num">
                {t('chamber.scenario')}
              </th>
              <th scope="col" className="num">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.id}</th>
                <td className="num">{f.int(row.votes)}</td>
                <td className="num">{f.pct(row.voteShare, 1)}</td>
                <td className="num">{f.int(row.base)}</td>
                <td className="num">{f.int(row.scen)}</td>
                <td className="num">
                  <Delta value={row.scen - row.base} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function MetricStats({
  baseline,
  scenario,
  hideBaseline,
}: {
  baseline: ChamberMetrics;
  scenario: ChamberMetrics;
  hideBaseline: boolean;
}) {
  const { t, f } = useT();
  const items: Array<{ key: string; base: string; scen: string }> = [
    { key: 'gallagher', base: f.dec(baseline.gallagher, 1), scen: f.dec(scenario.gallagher, 1) },
    {
      key: 'effectiveParties',
      base: f.dec(baseline.effectiveParties, 1),
      scen: f.dec(scenario.effectiveParties, 1),
    },
    {
      key: 'partiesWithSeats',
      base: f.int(baseline.partiesWithSeats),
      scen: f.int(scenario.partiesWithSeats),
    },
    {
      key: 'partiesForMajority',
      base: f.int(baseline.partiesForMajority),
      scen: f.int(scenario.partiesForMajority),
    },
    {
      key: 'largestShare',
      base: f.share(baseline.largestShare, 1),
      scen: f.share(scenario.largestShare, 1),
    },
    {
      key: 'votesWithoutSeatPct',
      base: f.pct(baseline.votesWithoutSeatPct, 1),
      scen: f.pct(scenario.votesWithoutSeatPct, 1),
    },
  ];
  return (
    <dl className="stats">
      {items.map((item) => (
        <div key={item.key} className="stat">
          <dt className="stat__label">{t(`metrics.${item.key}.name`)}</dt>
          <dd className="stat__value">{item.scen}</dd>
          {!hideBaseline ? (
            <dd className="stat__base">
              {t('chamber.officialLower')}: <span className="num">{item.base}</span>
            </dd>
          ) : null}
          <dd className="stat__hint">{t(`metrics.${item.key}.hint`)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChamberPanel(props: PanelProps) {
  const {
    baseline,
    scenario,
    baselineMetrics,
    scenarioMetrics,
    partyVotes,
    scenarioLabel,
    isBaselineScenario,
    stale,
  } = props;
  const { t, f } = useT();
  const label = usePartyLabel();
  const ownColors = useColors(baseline, scenario, partyVotes);
  const colors = props.colors ?? ownColors;
  const hemiGroups = useMemo(() => groupParties(baseline, scenario, 10), [baseline, scenario]);
  const baseHemi = useMemo(() => collapseSeats(baseline, hemiGroups), [baseline, hemiGroups]);
  const scenHemi = useMemo(() => collapseSeats(scenario, hemiGroups), [scenario, hemiGroups]);
  const totalBase = sumSeats(baseline);
  const totalScen = sumSeats(scenario);
  const overhang = Math.max(0, totalScen - totalBase);
  const changed = seatsChanged(baseline, scenario);
  const allParties = rankParties(baseline, scenario).length;
  const [showAllState, setShowAll] = useState(false);

  const describe = (seats: SeatMap) =>
    Object.entries(seats)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, n]) => `${label(id, hemiGroups.others.length)}: ${f.int(n)}`)
      .join('; ');

  return (
    <div className={stale ? 'panel is-stale' : 'panel'} aria-busy={stale ? 'true' : 'false'}>
      <div className="hemicycles">
        <Hemicycle
          seats={baseHemi}
          colors={colors}
          total={totalBase}
          label={`${t('chamber.official')}. ${describe(baseHemi)}`}
          caption={t('chamber.official')}
        />
        <Hemicycle
          seats={scenHemi}
          colors={colors}
          total={totalScen}
          label={`${scenarioLabel}. ${describe(scenHemi)}`}
          caption={scenarioLabel}
        />
      </div>

      <p className="panel__summary" aria-live="polite">
        {isBaselineScenario
          ? t('chamber.sameAsOfficial')
          : changed === 0
            ? t('chamber.noChange')
            : t('chamber.changed', { count: f.int(changed), total: f.int(totalScen) })}
      </p>
      {overhang > 0 ? (
        <p className="panel__summary notice__alert">
          {t('chamber.overhang', {
            total: f.int(totalScen),
            extra: f.int(overhang),
            official: f.int(totalBase),
          })}
        </p>
      ) : null}

      <div className="card">
        <SeatBars baseline={baseline} scenario={scenario} colors={colors} showAll={showAllState} />
        {allParties > 11 ? (
          <button type="button" className="link-button" onClick={() => setShowAll(!showAllState)}>
            {showAllState ? t('chamber.showTop') : t('chamber.showAll', { count: allParties })}
          </button>
        ) : null}
        <SeatTable baseline={baseline} scenario={scenario} partyVotes={partyVotes} />
      </div>

      <h3 className="subhead">{t('chamber.metricsTitle')}</h3>
      <MetricStats
        baseline={baselineMetrics}
        scenario={scenarioMetrics}
        hideBaseline={isBaselineScenario}
      />
    </div>
  );
}
