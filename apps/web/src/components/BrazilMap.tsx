import { useMemo } from 'react';
import { Link } from 'wouter';
import { geoMercator, geoPath } from 'd3-geo';
import type { Topology } from 'topojson-specification';
import { UF_NAMES, type ChamberAreaRow, type OfficeId } from '@votobr/shared';
import { useVersionedApi } from '../meta';
import { apiUrls } from '../lib/api';
import { readableTextColor } from '../lib/color';
import { collectionOf, featureId } from '../lib/geo';
import { useT } from '../i18n';
import { OTHERS_COLOR, leadingParty, seatsChanged } from '../lib/parties';
import { areaPath } from '../lib/routes';
import type { MapMode } from '../lib/urlState';
import { ErrorState, Skeleton } from './states';

const WIDTH = 420;
const HEIGHT = 430;

/** Faixas da fração de cadeiras que mudam de partido (modo "mudança"). */
const CHANGE_BINS = [
  { max: 0, color: '#E4EAF3' },
  { max: 0.1, color: '#C3D2EA' },
  { max: 0.2, color: '#86A8D6' },
  { max: 0.3, color: '#3F74BE' },
  { max: Infinity, color: '#0B3D91' },
] as const;

function changeBin(fraction: number): (typeof CHANGE_BINS)[number] {
  return CHANGE_BINS.find((bin) => fraction <= bin.max) ?? CHANGE_BINS[CHANGE_BINS.length - 1]!;
}

interface Props {
  office: Extract<OfficeId, 'federal' | 'state'>;
  rows: ChamberAreaRow[];
  colors: Record<string, string>;
  mode: MapMode;
  onMode: (mode: MapMode) => void;
  query: string;
}

export function BrazilMap({ office, rows, colors, mode, onMode, query }: Props) {
  const { t, f } = useT();
  const geo = useVersionedApi<Topology>((v) => apiUrls.geoBrazil(v));

  const byUf = useMemo(() => {
    const map = new Map<
      string,
      { row: ChamberAreaRow; leaderBase: string | null; leaderScen: string | null; changed: number }
    >();
    for (const row of rows) {
      map.set(row.code, {
        row,
        leaderBase: leadingParty(row.baseline),
        leaderScen: leadingParty(row.scenario),
        changed: seatsChanged(row.baseline, row.scenario),
      });
    }
    return map;
  }, [rows]);

  const shapes = useMemo(() => {
    if (geo.status !== 'success') return [];
    const collection = collectionOf(geo.data, 'states');
    if (!collection) return [];
    const projection = geoMercator().fitExtent(
      [
        [6, 6],
        [WIDTH - 6, HEIGHT - 6],
      ],
      collection,
    );
    const path = geoPath(projection);
    return collection.features.flatMap((feat) => {
      const id = String(featureId(feat) ?? '');
      const d = path(feat);
      const centroid = path.centroid(feat);
      if (!id || !d) return [];
      return [{ id, d, x: centroid[0], y: centroid[1] }];
    });
  }, [geo]);

  const legendLeaders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of byUf.values()) {
      if (entry.leaderScen) counts.set(entry.leaderScen, (counts.get(entry.leaderScen) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [byUf]);

  const modeButtons: MapMode[] = ['leader', 'change'];

  return (
    <section className="map-block" aria-labelledby="brazil-map-title">
      <div className="map-block__head">
        <h3 id="brazil-map-title" className="subhead">
          {t('map.brazilTitle')}
        </h3>
        <div className="segmented" role="group" aria-label={t('map.modeLabel')}>
          {modeButtons.map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? 'segmented__btn is-active' : 'segmented__btn'}
              aria-pressed={m === mode}
              onClick={() => onMode(m)}
            >
              {t(`map.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="map-block__lede">{t(`map.modeHint.${mode}`)}</p>

      {geo.status === 'error' ? <ErrorState onRetry={geo.reload} /> : null}
      {geo.status !== 'success' && geo.status !== 'error' ? <Skeleton height={320} /> : null}

      {geo.status === 'success' ? (
        <svg
          className="map"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={t('map.brazilLabel')}
        >
          {shapes.map((shape) => {
            const entry = byUf.get(shape.id);
            const leader = entry?.leaderScen ?? null;
            const fraction = entry && entry.row.seats > 0 ? entry.changed / entry.row.seats : 0;
            const fill = !entry
              ? '#E4EAF3'
              : mode === 'leader'
                ? leader
                  ? (colors[leader] ?? OTHERS_COLOR)
                  : OTHERS_COLOR
                : changeBin(fraction).color;
            const text = readableTextColor(fill);
            const name = UF_NAMES[shape.id as keyof typeof UF_NAMES] ?? shape.id;
            const description = entry
              ? t('map.ufDescription', {
                  name,
                  seats: f.int(entry.row.seats),
                  leader: leader ?? '—',
                  changed: f.int(entry.changed),
                })
              : name;
            return (
              <Link key={shape.id} href={`${areaPath(office, shape.id)}${query}`} asChild>
                <a className="map__area" aria-label={description}>
                  <path d={shape.d} fill={fill} />
                  <text
                    x={shape.x}
                    y={shape.y}
                    fill={text}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {shape.id}
                  </text>
                </a>
              </Link>
            );
          })}
        </svg>
      ) : null}

      <div className="map-legend">
        {mode === 'leader' ? (
          <ul className="legend-list">
            {legendLeaders.map(([party, count]) => (
              <li key={party}>
                <i
                  className="swatch"
                  style={{ background: colors[party] ?? OTHERS_COLOR }}
                  aria-hidden="true"
                />
                {party} <span className="muted">({t('map.ufCount', { count })})</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="legend-list">
            {CHANGE_BINS.map((bin, i) => {
              const prev = i === 0 ? null : CHANGE_BINS[i - 1]!.max;
              const label =
                bin.max === 0
                  ? t('map.legend.none')
                  : bin.max === Infinity
                    ? t('map.legend.above', { value: f.share(prev ?? 0) })
                    : t('map.legend.upTo', { value: f.share(bin.max) });
              return (
                <li key={bin.color}>
                  <i className="swatch" style={{ background: bin.color }} aria-hidden="true" />
                  {label}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <details className="table-toggle">
        <summary>{t('map.viewTable')}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('map.tableLabel')}>
          <table className="data-table">
            <caption className="sr-only">{t('map.tableLabel')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('map.col.area')}</th>
                <th scope="col" className="num">
                  {t('map.col.seats')}
                </th>
                <th scope="col">{t('map.col.leaderOfficial')}</th>
                <th scope="col">{t('map.col.leaderScenario')}</th>
                <th scope="col" className="num">
                  {t('map.col.changed')}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...byUf.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([uf, entry]) => (
                  <tr key={uf}>
                    <th scope="row">
                      <Link href={`${areaPath(office, uf)}${query}`}>
                        {UF_NAMES[uf as keyof typeof UF_NAMES] ?? uf}
                      </Link>
                    </th>
                    <td className="num">{f.int(entry.row.seats)}</td>
                    <td>{entry.leaderBase ?? '—'}</td>
                    <td>{entry.leaderScen ?? '—'}</td>
                    <td className="num">{f.int(entry.changed)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
