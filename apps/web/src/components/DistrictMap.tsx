import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { mesh, neighbors } from 'topojson-client';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import type { DistrictResult, UnitPoint } from '@votobr/shared';
import { apiUrls } from '../lib/api';
import { readableTextColor } from '../lib/color';
import {
  districtName,
  dominantDistricts,
  fitView,
  greedyColoring,
  IDENTITY_VIEW,
  placeBadges,
  searchKey,
  summarizeDistricts,
} from '../lib/districts';
import { collectionOf, featureId, singleFeature } from '../lib/geo';
import { OTHERS_COLOR } from '../lib/parties';
import {
  dedupePoints,
  labelAnchors,
  segmentsPath,
  unionBox,
  voronoiDistricts,
  type Box,
  type ProjectedPoint,
} from '../lib/voronoi';
import { useT, type Translator } from '../i18n';
import { useVersionedApi } from '../meta';
import { ErrorState, Skeleton } from './states';

const WIDTH = 420;
const MAX_HEIGHT = 520;
/** Raio do número no mapa, em pixels de tela (independe da largura do mapa). */
const BADGE_RADIUS_PX = 11;
const EMPTY_FILL = '#E4EAF3';

/** Tons claros e chapados: os distritos são divisões administrativas, sem significado político. */
const DISTRICT_PALETTE = [
  '#B4CCF0',
  '#FBE88A',
  '#A8DDB8',
  '#F5C8A3',
  '#A6DCE3',
  '#D4DAE6',
  '#D6E48F',
  '#F1BED0',
] as const;

type ColorMode = 'district' | 'party';
type Kind = 'state' | 'city';

interface MapProps {
  units: UnitPoint[];
  districts?: DistrictResult[];
  partyColors: Record<string, string>;
}

interface MapShape {
  key: string;
  d: string;
  /** −1: município sem eleitores no conjunto de dados. */
  district: number;
  /** Texto do `<title>`; vazio usa o nome do distrito. */
  title: string;
  clip?: string;
}

interface DistrictGeometry {
  /** Posição do número (dentro do distrito). */
  x: number;
  y: number;
  area: number;
  box: Box;
}

interface MapModel {
  viewBox: Box;
  shapes: MapShape[];
  clips: Array<{ id: string; d: string }>;
  /** Divisas municipais (só no mapa estadual). */
  borders: string;
  /** Fronteiras entre distritos que seguem as divisas municipais. */
  boundaries: string;
  /** Fronteiras entre distritos dentro de um recorte (município dividido ou cidade). */
  clippedBoundaries: Array<{ clip: string; d: string }>;
  frame: string;
  edges: Array<[number, number]>;
  geometry: Map<number, DistrictGeometry>;
  /** Municípios de cada distrito, para a busca. */
  places: Map<number, string[]>;
  splitCount: number;
  pointCount: number;
  maxScale: number;
}

function paletteColor(index: number): string {
  return DISTRICT_PALETTE[index % DISTRICT_PALETTE.length] ?? OTHERS_COLOR;
}

function viewBoxAttr([x0, y0, x1, y1]: Box): string {
  return [x0, y0, x1 - x0, y1 - y0].map((n) => Math.round(n * 10) / 10).join(' ');
}

function fitProjection(outline: GeoPermissibleObjects) {
  const projection = geoMercator().fitExtent(
    [
      [4, 4],
      [WIDTH - 4, MAX_HEIGHT - 4],
    ],
    outline,
  );
  const path = geoPath(projection);
  const [[x0, y0], [x1, y1]] = path.bounds(outline);
  const viewBox: Box = [x0 - 4, y0 - 4, x1 + 4, y1 + 4];
  return { projection, path, viewBox };
}

function projectPoints(
  units: readonly UnitPoint[],
  projection: (p: [number, number]) => [number, number] | null,
): ProjectedPoint[] {
  return dedupePoints(units).flatMap((p) => {
    const xy = projection([p.lon, p.lat]);
    return xy ? [{ x: xy[0], y: xy[1], district: p.district, voters: p.voters }] : [];
  });
}

function nearestDistrict(points: readonly ProjectedPoint[], [x, y]: [number, number]): number {
  let best = points[0];
  let bestDist = Infinity;
  for (const p of points) {
    const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best?.district ?? -1;
}

function finishGeometry(
  anchors: readonly ProjectedPoint[],
  areas: ReadonlyMap<number, number>,
  boxes: ReadonlyMap<number, Box>,
): Map<number, DistrictGeometry> {
  const out = new Map<number, DistrictGeometry>();
  for (const [district, p] of labelAnchors(anchors)) {
    const box = boxes.get(district);
    if (!box) continue;
    out.set(district, { x: p.x, y: p.y, area: areas.get(district) ?? 0, box });
  }
  return out;
}

/**
 * Municípios inteiros com a cor do distrito; nos municípios divididos, a área de cada local de
 * votação é a região mais próxima dele (Voronoi), recortada pelo contorno do município.
 */
function buildStateModel(
  topology: Topology,
  units: readonly UnitPoint[],
  uid: string,
  t: Translator['t'],
): MapModel | null {
  const object = topology.objects.municipalities as GeometryCollection | undefined;
  const collection = collectionOf(topology, 'municipalities');
  const stateFeature = singleFeature(topology, 'state');
  if (!object || !collection) return null;
  const { projection, path, viewBox } = fitProjection(stateFeature ?? collection);
  const dominant = dominantDistricts(units);
  const unitsOfSplit = new Map<number, UnitPoint[]>();
  for (const u of units) {
    if (!dominant.get(u[4])?.split) continue;
    const list = unitsOfSplit.get(u[4]) ?? [];
    list.push(u);
    unitsOfSplit.set(u[4], list);
  }

  const shapes: MapShape[] = [];
  const clips: MapModel['clips'] = [];
  const clippedBoundaries: MapModel['clippedBoundaries'] = [];
  const anchors: ProjectedPoint[] = [];
  const areas = new Map<number, number>();
  const boxes = new Map<number, Box>();
  const places = new Map<number, string[]>();
  const edgeSet = new Map<string, [number, number]>();
  const addEdge = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    edgeSet.set(a < b ? `${a}-${b}` : `${b}-${a}`, a < b ? [a, b] : [b, a]);
  };
  const addGeometry = (district: number, area: number, box: Box) => {
    areas.set(district, (areas.get(district) ?? 0) + area);
    boxes.set(district, unionBox(boxes.get(district), box));
  };
  const centroids = collection.features.map((feat) => path.centroid(feat));
  /** Distrito de cada município do lado da divisa com o município vizinho (ponto de referência). */
  const sides: Array<(toward: [number, number]) => number> = [];
  let splitCount = 0;

  collection.features.forEach((feat, i) => {
    const id = Number(featureId(feat));
    const name = String(feat.properties?.name ?? id);
    const info = dominant.get(id);
    const d = path(feat) ?? '';
    if (!info) {
      shapes.push({ key: `m${id}`, d, district: -1, title: name });
      sides[i] = () => -1;
      return;
    }
    for (const district of info.districts) {
      const list = places.get(district) ?? [];
      list.push(name);
      places.set(district, list);
    }
    const [[bx0, by0], [bx1, by1]] = path.bounds(feat);
    const box: Box = [bx0, by0, bx1, by1];
    const area = path.area(feat);
    const points = info.split ? projectPoints(unitsOfSplit.get(id) ?? [], projection) : [];
    if (points.length < 2) {
      shapes.push({
        key: `m${id}`,
        d,
        district: info.district,
        title: t('districtMap.munDistrict', { name, district: info.district + 1 }),
      });
      addGeometry(info.district, area, box);
      const [cx, cy] = centroids[i] ?? [0, 0];
      anchors.push({ x: cx, y: cy, district: info.district, voters: info.voters });
      sides[i] = () => info.district;
      return;
    }
    splitCount++;
    const clip = `${uid}-m${id}`;
    clips.push({ id: clip, d });
    const cells = voronoiDistricts(points, [bx0 - 1, by0 - 1, bx1 + 1, by1 + 1]);
    const cellArea = [...cells.areas.values()].reduce((a, b) => a + b, 0);
    for (const [district, cellPath] of cells.paths) {
      shapes.push({
        key: `m${id}-${district}`,
        d: cellPath,
        district,
        clip,
        title: t('districtMap.munPart', { name, district: district + 1 }),
      });
      const share = cellArea > 0 ? (cells.areas.get(district) ?? 0) / cellArea : 0;
      addGeometry(district, area * share, cells.boxes.get(district) ?? box);
    }
    for (const [a, b] of cells.boundaries.adjacency) addEdge(a, b);
    if (cells.boundaries.segments.length) {
      clippedBoundaries.push({ clip, d: segmentsPath(cells.boundaries.segments) });
    }
    anchors.push(...points);
    sides[i] = (toward) => nearestDistrict(points, toward);
  });

  const geometries = object.geometries;
  const index = new Map<GeometryObject, number>(geometries.map((g, i) => [g, i]));
  const side = (g: GeometryObject, other: GeometryObject) => {
    const i = index.get(g) ?? -1;
    const j = index.get(other) ?? -1;
    return sides[i]?.(centroids[j] ?? [0, 0]) ?? -1;
  };
  neighbors(geometries).forEach((list, i) => {
    for (const j of list) {
      if (j > i)
        addEdge(sides[i]?.(centroids[j] ?? [0, 0]) ?? -1, sides[j]?.(centroids[i] ?? [0, 0]) ?? -1);
    }
  });

  return {
    viewBox,
    shapes,
    clips,
    borders: path(mesh(topology, object, (a, b) => a !== b)) ?? '',
    boundaries: path(mesh(topology, object, (a, b) => a !== b && side(a, b) !== side(b, a))) ?? '',
    clippedBoundaries,
    frame:
      (stateFeature ? path(stateFeature) : path(mesh(topology, object, (a, b) => a === b))) ?? '',
    edges: [...edgeSet.values()],
    geometry: finishGeometry(anchors, areas, boxes),
    places,
    splitCount,
    pointCount: units.length,
    maxScale: 32,
  };
}

/** A área de cada local de votação é a região mais próxima dele, recortada pelo contorno da cidade. */
function buildCityModel(
  topology: Topology,
  units: readonly UnitPoint[],
  uid: string,
): MapModel | null {
  const outline = singleFeature(topology, 'city');
  if (!outline) return null;
  const { projection, path, viewBox } = fitProjection(outline);
  const points = projectPoints(units, projection);
  if (points.length === 0) return null;
  const cells = voronoiDistricts(points, viewBox);
  const cellArea = [...cells.areas.values()].reduce((a, b) => a + b, 0);
  const scale = cellArea > 0 ? path.area(outline) / cellArea : 0;
  const clip = `${uid}-city`;
  const outlineD = path(outline) ?? '';
  return {
    viewBox,
    shapes: [...cells.paths].map(([district, d]) => ({
      key: `d${district}`,
      d,
      district,
      title: '',
      clip,
    })),
    clips: [{ id: clip, d: outlineD }],
    borders: '',
    boundaries: '',
    clippedBoundaries: [{ clip, d: segmentsPath(cells.boundaries.segments) }],
    frame: outlineD,
    edges: cells.boundaries.adjacency,
    geometry: finishGeometry(
      points,
      new Map([...cells.areas].map(([d, a]) => [d, a * scale])),
      cells.boxes,
    ),
    places: new Map(),
    splitCount: 0,
    pointCount: points.length,
    maxScale: 8,
  };
}

/** Largura renderizada do elemento, em pixels (acompanha o redimensionamento). */
function useWidth<T extends Element>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

function useDistrictColors(
  count: number,
  edges: ReadonlyArray<readonly [number, number]>,
  districts: DistrictResult[] | undefined,
  partyColors: Record<string, string>,
  mode: ColorMode,
): (district: number) => string {
  return useMemo(() => {
    const coloring = greedyColoring(count, edges);
    const winner = new Map((districts ?? []).map((d) => [d.id, d.winnerParty]));
    return (district: number) => {
      if (district < 0) return EMPTY_FILL;
      if (mode === 'party') {
        const party = winner.get(district);
        return party ? (partyColors[party] ?? OTHERS_COLOR) : OTHERS_COLOR;
      }
      return paletteColor(coloring[district] ?? district);
    };
  }, [count, edges, districts, partyColors, mode]);
}

function ModeToggle({
  mode,
  onMode,
  canParty,
}: {
  mode: ColorMode;
  onMode: (mode: ColorMode) => void;
  canParty: boolean;
}) {
  const { t } = useT();
  if (!canParty) return null;
  const modes: ColorMode[] = ['district', 'party'];
  return (
    <div className="segmented" role="group" aria-label={t('districtMap.colorBy')}>
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          className={m === mode ? 'segmented__btn is-active' : 'segmented__btn'}
          aria-pressed={m === mode}
          onClick={() => onMode(m)}
        >
          {t(`districtMap.colorMode.${m}`)}
        </button>
      ))}
    </div>
  );
}

interface DistrictRow {
  id: number;
  name: string;
  population: number;
  voters: number;
  /** Desvio da população em relação à média dos distritos, em %. */
  deviation?: number;
  winner?: string;
  margin?: number;
  search: string;
}

function DistrictMapBlock({
  kind,
  model,
  loading,
  failed,
  onRetry,
  units,
  districts,
  partyColors,
}: MapProps & {
  kind: Kind;
  model: MapModel | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t, f } = useT();
  const titleId = useId();
  const [mode, setMode] = useState<ColorMode>('district');
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const [figureRef, figureWidth] = useWidth<HTMLElement>();

  const count = useMemo(() => units.reduce((max, u) => Math.max(max, u[2] + 1), 0), [units]);
  useEffect(() => {
    setHovered(null);
    setSelected(null);
  }, [units]);

  const colorOf = useDistrictColors(count, model?.edges ?? [], districts, partyColors, mode);

  const rows = useMemo<DistrictRow[]>(() => {
    const byId = new Map((districts ?? []).map((d) => [d.id, d]));
    const summary = new Map(summarizeDistricts(units).map((s) => [s.id, s]));
    const totalPop = (districts ?? []).reduce((a, d) => a + d.population, 0);
    const mean = count > 0 ? totalPop / count : 0;
    return Array.from({ length: count }, (_, id) => {
      const result = byId.get(id);
      const name = districtName(result?.label, id, kind, t);
      const population = result?.population ?? 0;
      return {
        id,
        name,
        population,
        voters: result?.voters ?? summary.get(id)?.voters ?? 0,
        deviation: mean > 0 && population > 0 ? (population / mean - 1) * 100 : undefined,
        winner: result?.winnerParty,
        margin: result?.marginPct,
        search: searchKey([String(id + 1), name, ...(model?.places.get(id) ?? [])].join(' ')),
      };
    });
  }, [count, districts, units, kind, model, t]);

  const names = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);
  const needle = searchKey(query.trim());
  const visible = needle ? rows.filter((r) => r.search.includes(needle)) : rows;

  const active = hovered ?? selected;
  const view = useMemo(() => {
    const g = selected === null ? undefined : model?.geometry.get(selected);
    return g && model ? fitView(g.box, model.viewBox, model.maxScale) : IDENTITY_VIEW;
  }, [model, selected]);
  const viewWidth = model ? model.viewBox[2] - model.viewBox[0] : WIDTH;
  const radius = BADGE_RADIUS_PX * (figureWidth > 0 ? viewWidth / figureWidth : 1);
  const badges = useMemo(
    () =>
      model
        ? placeBadges(
            [...model.geometry].map(([district, g]) => ({
              district,
              x: view.x + view.k * g.x,
              y: view.y + view.k * g.y,
              area: g.area * view.k ** 2,
            })),
            radius,
            model.viewBox,
            active,
          )
        : [],
    [model, view, active, radius],
  );

  /** Rola só a lista (não a página) até o distrito apontado no mapa. */
  const reveal = (district: number) => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-district="${district}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  };
  const pointAt = (district: number) => {
    if (district < 0) return;
    setHovered(district);
    reveal(district);
  };
  const toggle = (district: number) => {
    if (district < 0) return;
    setSelected((current) => (current === district ? null : district));
  };

  const dim = (district: number) => active !== null && district !== active;
  const lede =
    kind === 'state' ? t('districtMap.stateLede', { count }) : t('districtMap.cityLede', { count });
  const note =
    kind === 'state'
      ? t('districtMap.stateNote', { split: f.int(model?.splitCount ?? 0) })
      : t('districtMap.cityNote', { count: f.int(model?.pointCount ?? units.length) });

  return (
    <section className="map-block district-map" aria-labelledby={titleId}>
      <div className="map-block__head">
        <h3 id={titleId} className="subhead">
          {t('districtMap.title')}
        </h3>
        <ModeToggle mode={mode} onMode={setMode} canParty={Boolean(districts?.length)} />
      </div>
      <p className="map-block__lede">{lede}</p>

      {failed ? <ErrorState onRetry={onRetry} /> : null}
      {loading ? <Skeleton height={320} /> : null}

      {model ? (
        <div className="district-map__body">
          <figure className="district-map__figure" ref={figureRef}>
            <svg
              className="map map--districts"
              viewBox={viewBoxAttr(model.viewBox)}
              role="img"
              aria-label={t(kind === 'state' ? 'districtMap.stateLabel' : 'districtMap.cityLabel', {
                count,
              })}
            >
              <defs>
                {model.clips.map((c) => (
                  <clipPath key={c.id} id={c.id}>
                    <path d={c.d} />
                  </clipPath>
                ))}
              </defs>
              <g
                className="district-map__zoom"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
                onMouseLeave={() => setHovered(null)}
              >
                {model.shapes.map((s) => {
                  const fill = colorOf(s.district);
                  return (
                    <path
                      key={s.key}
                      d={s.d}
                      fill={fill}
                      stroke={fill}
                      strokeWidth="0.6"
                      clipPath={s.clip ? `url(#${s.clip})` : undefined}
                      className={dim(s.district) ? 'is-dim' : undefined}
                      onMouseEnter={() => pointAt(s.district)}
                      onClick={() => toggle(s.district)}
                    >
                      <title>{s.title || names.get(s.district)}</title>
                    </path>
                  );
                })}
                <g className="district-map__lines" aria-hidden="true">
                  {model.borders ? (
                    <path d={model.borders} stroke="#FFFFFF" strokeWidth="0.6" />
                  ) : null}
                  {model.clippedBoundaries.map((b) => (
                    <path
                      key={b.clip}
                      d={b.d}
                      clipPath={`url(#${b.clip})`}
                      stroke="#0B1633"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  ))}
                  {model.boundaries ? (
                    <path d={model.boundaries} stroke="#0B1633" strokeWidth="1.4" />
                  ) : null}
                  <path d={model.frame} stroke="#0B1633" strokeWidth="1.6" />
                </g>
              </g>
              <g className="district-map__badges" aria-hidden="true">
                {badges.map((b) => {
                  const fill = colorOf(b.district);
                  return (
                    <g
                      key={b.district}
                      className={
                        b.district === active ? 'district-badge is-active' : 'district-badge'
                      }
                      style={{ transform: `translate(${b.x}px, ${b.y}px)` }}
                      onMouseEnter={() => pointAt(b.district)}
                      onClick={() => toggle(b.district)}
                    >
                      <circle r={radius} fill={fill} strokeWidth={radius * 0.15} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={readableTextColor(fill)}
                        style={{ fontSize: radius * (b.district >= 9 ? 1 : 1.15) }}
                      >
                        {b.district + 1}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {selected !== null ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm district-map__reset"
                onClick={() => setSelected(null)}
              >
                {t('districtMap.reset')}
              </button>
            ) : null}
          </figure>

          <div className="district-list">
            <p className="district-list__hint">{t('districtMap.hint')}</p>
            {count > 8 ? (
              <input
                type="search"
                className="district-list__search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(
                  kind === 'state' ? 'districtMap.searchState' : 'districtMap.searchCity',
                )}
                aria-label={t(
                  kind === 'state' ? 'districtMap.searchState' : 'districtMap.searchCity',
                )}
              />
            ) : null}
            <ol
              className="district-list__items"
              ref={listRef}
              aria-label={t('districtMap.listLabel')}
            >
              {visible.map((row) => {
                const fill = colorOf(row.id);
                const classes = ['district-list__item'];
                if (row.id === active) classes.push('is-active');
                return (
                  <li key={row.id} data-district={row.id}>
                    <button
                      type="button"
                      className={classes.join(' ')}
                      aria-pressed={selected === row.id}
                      onMouseEnter={() => setHovered(row.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(row.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => toggle(row.id)}
                    >
                      <span
                        className="district-list__num"
                        style={{ background: fill, color: readableTextColor(fill) }}
                      >
                        {row.id + 1}
                      </span>
                      <span className="district-list__body">
                        <span className="district-list__name">{row.name}</span>
                        <span className="district-list__meta">
                          {row.population > 0
                            ? t('districtMap.rowPopulation', {
                                pop: f.compact(row.population),
                                dev: f.signed(row.deviation ?? 0, 1),
                              })
                            : t('districtMap.rowVoters', { voters: f.compact(row.voters) })}
                        </span>
                      </span>
                      {row.winner ? (
                        <span className="district-list__winner">
                          <span>
                            <i
                              className="swatch"
                              style={{ background: partyColors[row.winner] ?? OTHERS_COLOR }}
                              aria-hidden="true"
                            />
                            {row.winner}
                          </span>
                          {row.margin !== undefined ? (
                            <small>
                              {t('districtMap.margin', { value: f.dec(row.margin, 1) })}
                            </small>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            {visible.length === 0 ? (
              <p className="district-list__empty">{t('districtMap.noMatch')}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="map-block__note">{note}</p>
    </section>
  );
}

export function StateDistrictMap({ uf, ...props }: MapProps & { uf: string }) {
  const { t } = useT();
  const geo = useVersionedApi<Topology>((v) => apiUrls.geoState(uf, v));
  const uid = `dm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const model = useMemo(
    () => (geo.status === 'success' ? buildStateModel(geo.data, props.units, uid, t) : null),
    [geo, props.units, uid, t],
  );
  return (
    <DistrictMapBlock
      kind="state"
      model={model}
      loading={geo.status !== 'success' && geo.status !== 'error'}
      failed={geo.status === 'error'}
      onRetry={geo.reload}
      {...props}
    />
  );
}

export function CityDistrictMap({ ibge, ...props }: MapProps & { ibge: string }) {
  const geo = useVersionedApi<Topology>((v) => apiUrls.geoCity(ibge, v));
  const uid = `dm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const model = useMemo(
    () => (geo.status === 'success' ? buildCityModel(geo.data, props.units, uid) : null),
    [geo, props.units, uid],
  );
  return (
    <DistrictMapBlock
      kind="city"
      model={model}
      loading={geo.status !== 'success' && geo.status !== 'error'}
      failed={geo.status === 'error'}
      onRetry={geo.reload}
      {...props}
    />
  );
}
