import { UF_CODES, type Dataset, type UfCode, type ValidationReport } from '@votobr/shared';
import {
  attachDistrictPlans,
  loadDistrictingContext,
  placesFromLocals,
  type PlanStats,
} from './districting.js';
import { fetchSource, tseUrl } from './download.js';
import { loadGeo, writeCityTopology, writeTopologies } from './geo.js';
import { loadLocations, type LocalRecord } from './locations.js';
import { buildMunicipalDataset, pickMunicipalities } from './municipal.js';
import { cleanOutputs, summarize, writeDataset, writeMeta, type DatasetSummary } from './output.js';
import { buildStateDatasets, type IntegrityCheck } from './states.js';
import { CANDIDATE_RULES, missingElected } from './validation.js';

const GENERAL_YEAR = 2026;
const MUNICIPAL_YEAR = 2024;
/** Câmaras Municipais: cidades com pelo menos este número de eleitores (0 desliga). */
const MUNICIPAL_MIN_VOTERS = Number(process.env.VOTOBR_MIN_MUNICIPAL_VOTERS ?? 1_000_000);
const MUNICIPAL_LIMIT = Number(process.env.VOTOBR_MAX_MUNICIPALITIES ?? Infinity);
const UFS = (process.env.VOTOBR_UFS?.split(',').map((s) => s.trim()) ?? [...UF_CODES]) as UfCode[];

const zipOf = (dataset: string, year: number) => `${dataset}_${year}.zip`;
const fetchTse = (dataset: string, year: number) =>
  fetchSource(tseUrl(dataset, zipOf(dataset, year)), `tse/${year}/${zipOf(dataset, year)}`);

async function main() {
  const started = Date.now();
  const summaries: DatasetSummary[] = [];
  const missing = CANDIDATE_RULES.map(() => ({
    total: 0,
    exact: 0,
    areas: 0,
    rows: [] as string[],
  }));
  const checks: IntegrityCheck[] = [];
  const mismatches: string[] = [];
  const planStats: PlanStats[] = [];

  const track = async (ds: Dataset) => {
    summaries.push(summarize(ds));
    await writeDataset(ds);
    CANDIDATE_RULES.forEach((r, i) => {
      const m = missingElected(ds, r.rules);
      const acc = missing[i] as (typeof missing)[number];
      acc.total += m;
      acc.areas++;
      if (m === 0) acc.exact++;
      else acc.rows.push(`${ds.key}: ${m}`);
    });
  };

  console.log(`UFs: ${UFS.join(',')}`);
  await cleanOutputs();
  const geo = await loadGeo();
  const topo = await writeTopologies(geo);
  console.log(`Geometrias: ${topo.files} arquivos, ${(topo.bytes / 1e6).toFixed(1)} MB`);
  // Censo 2022 (população por município) e vizinhança dos municípios, para desenhar os distritos.
  const districting = await loadDistrictingContext(geo);

  // Eleições gerais 2026.
  const [cand26, party26, detail26, locais26] = await Promise.all([
    fetchTse('votacao_candidato_munzona', GENERAL_YEAR),
    fetchTse('votacao_partido_munzona', GENERAL_YEAR),
    fetchTse('detalhe_votacao_munzona', GENERAL_YEAR),
    fetchSource(
      tseUrl('eleitorado_locais_votacao', `eleitorado_local_votacao_${GENERAL_YEAR}.zip`),
      `tse/${GENERAL_YEAR}/eleitorado_local_votacao.zip`,
    ),
  ]);
  const loc26 = await loadLocations(GENERAL_YEAR, locais26, geo, UFS);
  console.log('Locais 2026:', loc26.stats);
  const localsByUf = new Map<string, LocalRecord[]>();
  for (const l of loc26.locals.values()) {
    const uf = loc26.tseUf.get(l.tse);
    if (uf) localsByUf.set(uf, [...(localsByUf.get(uf) ?? []), l]);
  }

  for (const uf of UFS) {
    const t = Date.now();
    const { datasets, checks: c } = await buildStateDatasets(
      uf,
      GENERAL_YEAR,
      { candidatesZip: cand26, partiesZip: party26, detailZip: detail26 },
      loc26,
    );
    for (const ds of datasets) {
      const places = placesFromLocals(ds, localsByUf.get(uf) ?? [], loc26.tseToIbge);
      planStats.push(...attachDistrictPlans(ds, districting, places));
      await track(ds);
    }
    checks.push(...c);
    console.log(
      `${uf}: ${datasets.map((d) => `${d.office}=${d.seats}`).join(' ')} (${((Date.now() - t) / 1000).toFixed(0)}s)`,
    );
  }

  // Eleições municipais 2024: cidades com 1 milhão de eleitores ou mais.
  if (MUNICIPAL_MIN_VOTERS > 0) {
    const [cand24, party24, detail24, locais24] = await Promise.all([
      fetchTse('votacao_candidato_munzona', MUNICIPAL_YEAR),
      fetchTse('votacao_partido_munzona', MUNICIPAL_YEAR),
      fetchTse('detalhe_votacao_munzona', MUNICIPAL_YEAR),
      fetchSource(
        tseUrl('eleitorado_locais_votacao', `eleitorado_local_votacao_${MUNICIPAL_YEAR}.zip`),
        `tse/${MUNICIPAL_YEAR}/eleitorado_local_votacao.zip`,
      ),
    ]);
    // As coordenadas de 2026 completam os locais que vieram sem latitude/longitude em 2024.
    const loc24 = await loadLocations(MUNICIPAL_YEAR, locais24, geo, UF_CODES, loc26);
    console.log('Locais 2024:', loc24.stats);
    const top = pickMunicipalities(loc24, geo, MUNICIPAL_MIN_VOTERS, MUNICIPAL_LIMIT);
    console.log(
      `Cidades (≥ ${MUNICIPAL_MIN_VOTERS} eleitores):`,
      top.map((c) => `${c.name}/${c.uf} (${c.voters})`).join(', '),
    );

    const localsByTse = new Map<string, LocalRecord[]>();
    for (const l of loc24.locals.values())
      localsByTse.set(l.tse, [...(localsByTse.get(l.tse) ?? []), l]);
    const sectionZips = new Map<UfCode, string>();
    for (const city of top) {
      if (!sectionZips.has(city.uf)) {
        sectionZips.set(
          city.uf,
          await fetchSource(
            tseUrl('votacao_secao', `votacao_secao_${MUNICIPAL_YEAR}_${city.uf}.zip`),
            `tse/${MUNICIPAL_YEAR}/votacao_secao_${city.uf}.zip`,
          ),
        );
      }
      const t = Date.now();
      const r = await buildMunicipalDataset(
        city,
        MUNICIPAL_YEAR,
        {
          candidatesZip: cand24,
          partiesZip: party24,
          detailZip: detail24,
          sectionZip: (uf) => sectionZips.get(uf) as string,
        },
        loc24,
        localsByTse,
      );
      planStats.push(...attachDistrictPlans(r.dataset, districting, r.places));
      await track(r.dataset);
      await writeCityTopology(city.ibge, city.name, city.uf);
      checks.push(...r.checks);
      if (r.sectionMismatchVotes) mismatches.push(`${city.name}: ${r.sectionMismatchVotes} votos`);
      console.log(
        `${city.name}/${city.uf}: ${r.dataset.seats} vagas, ${r.dataset.units.length} locais (${((Date.now() - t) / 1000).toFixed(0)}s)`,
      );
    }
  }

  // Integridade: totais do dataset × totais oficiais (detalhe da votação).
  const bad = checks.filter((c) => c.validVotes !== c.tseValidVotes);
  const badVoters = checks.filter(
    (c) => c.tseElectorate > 0 && Math.abs(c.electorate - c.tseElectorate) / c.tseElectorate > 0.01,
  );
  console.log(
    `Integridade de votos válidos: ${checks.length - bad.length}/${checks.length} idênticos ao TSE`,
  );
  for (const c of bad.slice(0, 30)) {
    console.log(
      `  ✗ ${c.key}: dataset ${c.validVotes} × TSE ${c.tseValidVotes} (Δ ${c.validVotes - c.tseValidVotes})`,
    );
  }
  if (badVoters.length) {
    console.log(
      `Eleitorado divergindo >1% do detalhe TSE: ${badVoters.map((c) => c.key).join(', ')}`,
    );
  }
  if (mismatches.length)
    console.log('Seções × zona (votos redistribuídos):', mismatches.join('; '));

  // Distritos: desvio populacional em relação à cota (meta ±5%, limite ±10%).
  const worst = [...planStats].sort((a, b) => b.maxDeviation - a.maxDeviation);
  console.log(
    `Distritos: ${planStats.length} desenhos; ${planStats.filter((p) => p.outOfTarget === 0).length} inteiramente em ±5%; pior desvio ${worst
      .slice(0, 3)
      .map((p) => `${p.key} k=${p.k} ${(p.maxDeviation * 100).toFixed(1)}%`)
      .join(', ')}`,
  );
  const overLimit = planStats.filter((p) => p.outOfTolerance > 0);

  // Validação do motor de apuração contra o resultado oficial.
  const best = missing.reduce(
    (bi, m, i) => (m.total < (missing[bi] as (typeof missing)[number]).total ? i : bi),
    0,
  );
  missing.forEach((m, i) =>
    console.log(
      `Regras "${(CANDIDATE_RULES[i] as (typeof CANDIDATE_RULES)[number]).name}": ${m.exact}/${m.areas} áreas exatas, ${m.total} eleitos divergentes`,
    ),
  );
  const chosen = CANDIDATE_RULES[best] as (typeof CANDIDATE_RULES)[number];
  const entries = summaries.map((s) => ({ key: s.key, seats: s.area.seats, missing: 0 }));
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    rules: chosen.name,
    areas: (missing[best] as (typeof missing)[number]).areas,
    exact: (missing[best] as (typeof missing)[number]).exact,
    entries,
  };
  // `entries` preenchido com o resultado por área da melhor regra (reprocessa a partir dos divergentes).
  const diverging = new Map(
    (missing[best] as (typeof missing)[number]).rows.map((r) => {
      const [key, n] = r.split(': ');
      return [key as string, Number(n)] as const;
    }),
  );
  for (const e of entries) e.missing = diverging.get(e.key) ?? 0;

  const meta = await writeMeta(summaries, report);
  console.log(
    `Concluído em ${((Date.now() - started) / 1000).toFixed(0)}s — versão ${meta.dataVersion}`,
  );
  for (const o of Object.values(meta.offices)) {
    console.log(`  ${o.office} ${o.year}: ${o.areas.length} áreas, ${o.seats} cadeiras`);
  }
  if (bad.length) {
    throw new Error(`${bad.length} área(s) com votos válidos diferentes do total oficial do TSE`);
  }
  if (overLimit.length) {
    throw new Error(
      `Distritos fora de ±10% da cota: ${overLimit.map((p) => `${p.key} k=${p.k}`).join(', ')}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
