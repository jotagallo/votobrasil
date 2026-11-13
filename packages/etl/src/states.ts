import { UF_NAMES, type Dataset, type OfficeId, type UfCode } from '@votobr/shared';
import { DatasetBuilder, competitorOf, statusOf } from './builder.js';
import { parseIntSafe, streamZipCsv } from './csv.js';
import type { Locations } from './locations.js';

export const CARGO_OFFICE: Record<string, OfficeId> = {
  '6': 'federal',
  '7': 'state',
  '8': 'state', // Deputado Distrital (DF) é a "assembleia" do DF.
};

export interface StateSources {
  candidatesZip: string;
  partiesZip: string;
  detailZip: string;
}

export interface IntegrityCheck {
  key: string;
  validVotes: number;
  tseValidVotes: number;
  electorate: number;
  tseElectorate: number;
}

interface Detail {
  voters: Map<string, number>;
  validVotes: number;
  electorate: number;
}

async function readDetail(zip: string, year: number, uf: string): Promise<Map<string, Detail>> {
  const out = new Map<string, Detail>();
  await streamZipCsv(zip, `detalhe_votacao_munzona_${year}_${uf}.csv`, (row) => {
    if (row('NR_TURNO') !== '1') return;
    const cargo = row('CD_CARGO');
    if (!(cargo in CARGO_OFFICE)) return;
    const d = out.get(cargo) ?? { voters: new Map(), validVotes: 0, electorate: 0 };
    const key = `${row('CD_MUNICIPIO').padStart(5, '0')}:${parseIntSafe(row('NR_ZONA'))}`;
    const aptos = parseIntSafe(row('QT_APTOS'));
    d.voters.set(key, (d.voters.get(key) ?? 0) + aptos);
    d.electorate += aptos;
    d.validVotes += parseIntSafe(row('QT_TOTAL_VOTOS_VALIDOS'));
    out.set(cargo, d);
  });
  return out;
}

/** Monta os datasets da Câmara dos Deputados e da Assembleia de uma UF (eleição geral de `year`). */
export async function buildStateDatasets(
  uf: UfCode,
  year: number,
  src: StateSources,
  loc: Locations,
): Promise<{ datasets: Dataset[]; checks: IntegrityCheck[] }> {
  const details = await readDetail(src.detailZip, year, uf);
  const builders = new Map<string, DatasetBuilder>();
  const unitFor = (b: DatasetBuilder, cargo: string, key: string): number =>
    b.unit(key, () => {
      const z = loc.zones.get(key);
      const ibge = z ? loc.tseToIbge.get(z.tse) : undefined;
      if (!z || ibge === undefined) throw new Error(`Zona sem localização: ${uf} ${key}`);
      const voters = details.get(cargo)?.voters.get(key) ?? z.voters;
      return { mun: ibge, zone: z.zone, lat: z.lat, lon: z.lon, voters };
    });

  const builderFor = (cargo: string): DatasetBuilder => {
    let b = builders.get(cargo);
    if (!b) {
      const office = CARGO_OFFICE[cargo] as OfficeId;
      b = new DatasetBuilder(`${year}-${office}-${uf}`, year, office, {
        kind: 'state',
        code: uf,
        name: UF_NAMES[uf],
        uf,
      });
      builders.set(cargo, b);
      // Todas as zonas com eleitores existem como unidade, mesmo sem votos para algum partido.
      for (const key of [...(details.get(cargo)?.voters.keys() ?? [])].sort()) {
        if ((details.get(cargo)?.voters.get(key) ?? 0) > 0) unitFor(b, cargo, key);
      }
    }
    return b;
  };

  await streamZipCsv(src.candidatesZip, `votacao_candidato_munzona_${year}_${uf}.csv`, (row) => {
    if (row('NR_TURNO') !== '1') return;
    const cargo = row('CD_CARGO');
    if (!(cargo in CARGO_OFFICE)) return;
    const b = builderFor(cargo);
    const key = `${row('CD_MUNICIPIO').padStart(5, '0')}:${parseIntSafe(row('NR_ZONA'))}`;
    const unit = unitFor(b, cargo, key);
    const comp = b.competitor(competitorOf(row));
    b.addCandidate(
      row('SQ_CANDIDATO'),
      {
        name: row('NM_URNA_CANDIDATO'),
        number: parseIntSafe(row('NR_CANDIDATO')),
        party: row('SG_PARTIDO'),
        comp,
        status: statusOf(row('DS_SIT_TOT_TURNO')),
      },
      unit,
      parseIntSafe(row('QT_VOTOS_NOMINAIS_VALIDOS')),
    );
  });

  await streamZipCsv(src.partiesZip, `votacao_partido_munzona_${year}_${uf}.csv`, (row) => {
    if (row('NR_TURNO') !== '1') return;
    const cargo = row('CD_CARGO');
    if (!(cargo in CARGO_OFFICE)) return;
    const b = builderFor(cargo);
    const key = `${row('CD_MUNICIPIO').padStart(5, '0')}:${parseIntSafe(row('NR_ZONA'))}`;
    const unit = unitFor(b, cargo, key);
    const comp = b.competitor(competitorOf(row));
    b.addLegend(comp, row('SG_PARTIDO'), unit, parseIntSafe(row('QT_TOTAL_VOTOS_LEG_VALIDOS')));
  });

  const datasets: Dataset[] = [];
  const checks: IntegrityCheck[] = [];
  for (const [cargo, b] of builders) {
    const ds = b.build();
    const detail = details.get(cargo);
    datasets.push(ds);
    checks.push({
      key: ds.key,
      validVotes: ds.validVotes,
      tseValidVotes: detail?.validVotes ?? 0,
      electorate: ds.electorate,
      tseElectorate: detail?.electorate ?? 0,
    });
  }
  return { datasets, checks };
}
