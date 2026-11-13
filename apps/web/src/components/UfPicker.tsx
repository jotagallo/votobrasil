import { useMemo } from 'react';
import { Link } from 'wouter';
import { geoMercator, geoPath } from 'd3-geo';
import type { Topology } from 'topojson-specification';
import { UF_NAMES, type AreaSummary, type OfficeId } from '@votobr/shared';
import { useT } from '../i18n';
import { apiUrls } from '../lib/api';
import { collectionOf, featureId } from '../lib/geo';
import { areaPath } from '../lib/routes';
import { useVersionedApi } from '../meta';
import { AreaList } from './AreaList';
import { ErrorState, Skeleton } from './states';

const WIDTH = 420;
const HEIGHT = 430;

/** Mapa do Brasil sem dados de resultado: serve só para escolher uma UF. */
export function UfPicker({
  office,
  areas,
  query,
}: {
  office: Extract<OfficeId, 'federal' | 'state'>;
  areas: AreaSummary[];
  query: string;
}) {
  const { t, f } = useT();
  const geo = useVersionedApi<Topology>((v) => apiUrls.geoBrazil(v));
  const byUf = useMemo(() => new Map(areas.map((a) => [a.code, a])), [areas]);

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

  return (
    <section className="uf-picker" aria-labelledby="uf-picker-title">
      <h2 id="uf-picker-title" className="section-title">
        {t(`house.${office}.pickTitle`)}
      </h2>
      <p className="section-lede">{t(`house.${office}.pickHint`)}</p>
      <div className="uf-picker__grid">
        <div className="uf-picker__map">
          {geo.status === 'error' ? <ErrorState onRetry={geo.reload} /> : null}
          {geo.status !== 'success' && geo.status !== 'error' ? <Skeleton height={320} /> : null}
          {geo.status === 'success' ? (
            <svg
              className="map map--picker"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="group"
              aria-label={t('map.pickLabel')}
            >
              {shapes.map((shape) => {
                const area = byUf.get(shape.id);
                const name = UF_NAMES[shape.id as keyof typeof UF_NAMES] ?? shape.id;
                const label = area
                  ? t('map.pickDescription', { name, seats: f.int(area.seats) })
                  : name;
                return (
                  <Link key={shape.id} href={`${areaPath(office, shape.id)}${query}`} asChild>
                    <a className="map__area" aria-label={label}>
                      <title>{label}</title>
                      <path d={shape.d} />
                      <text x={shape.x} y={shape.y} textAnchor="middle" dominantBaseline="central">
                        {shape.id}
                      </text>
                    </a>
                  </Link>
                );
              })}
            </svg>
          ) : null}
        </div>
        <div className="uf-picker__list">
          <AreaList office={office} areas={areas} query={query} />
        </div>
      </div>
    </section>
  );
}
