import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEM_IDS, type Dataset } from '@votobr/shared';
import type {
  AreaSummary,
  MetaResponse,
  OfficeSummary,
  SourceSummary,
  ValidationReport,
} from '@votobr/shared';
import { OUT_DIR, sources } from './download.js';
import { createHash } from 'node:crypto';

/** Incrementar quando mudar o formato/algoritmo do ETL para invalidar caches downstream. */
export const ETL_REVISION = 1;

const DATASET_DIR = join(OUT_DIR, 'datasets');

/** Remove saídas anteriores para que `data/processed` reflita só esta execução. */
export async function cleanOutputs(): Promise<void> {
  await rm(DATASET_DIR, { recursive: true, force: true });
  await rm(join(OUT_DIR, 'geo'), { recursive: true, force: true });
}

export async function writeDataset(ds: Dataset): Promise<number> {
  await mkdir(DATASET_DIR, { recursive: true });
  const packed = brotliCompressSync(Buffer.from(JSON.stringify(ds)), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 9,
      [constants.BROTLI_PARAM_LGWIN]: 24,
    },
  });
  await writeFile(join(DATASET_DIR, `${ds.key}.json.br`), packed);
  return packed.length;
}

export async function readDataset(key: string): Promise<Dataset> {
  return JSON.parse(
    brotliDecompressSync(await readFile(join(DATASET_DIR, `${key}.json.br`))).toString('utf8'),
  ) as Dataset;
}

export function areaSummary(ds: Dataset): AreaSummary {
  return {
    code: ds.area.code,
    name: ds.area.name,
    uf: ds.area.uf,
    kind: ds.area.kind,
    seats: ds.seats,
    electorate: ds.electorate,
    validVotes: ds.validVotes,
  };
}

export interface DatasetSummary {
  key: string;
  office: Dataset['office'];
  year: number;
  area: AreaSummary;
}

export function summarize(ds: Dataset): DatasetSummary {
  return { key: ds.key, office: ds.office, year: ds.year, area: areaSummary(ds) };
}

export function sourceSummaries(): SourceSummary[] {
  return sources().map((s) => ({
    name: s.file,
    url: s.url,
    sha256: s.sha256,
    etag: s.etag,
    bytes: s.bytes,
    downloadedAt: s.downloadedAt,
  }));
}

/** Hash do conteúdo gerado (datasets + geometrias): qualquer mudança de saída muda a versão e invalida caches. */
async function hashOutputs(): Promise<string> {
  const h = createHash('sha256');
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.br') || e.name.endsWith('.topo.json')) {
        h.update(`${rel}${e.name}\0`);
        h.update(await readFile(join(dir, e.name)));
      }
    }
  };
  await walk(DATASET_DIR, 'datasets/');
  await walk(join(OUT_DIR, 'geo'), 'geo/');
  return h.digest('hex');
}

export function dataVersion(src: SourceSummary[], outputsHash: string): string {
  const h = createHash('sha256');
  h.update(String(ETL_REVISION));
  h.update(outputsHash);
  for (const s of src) h.update(`${s.url}:${s.sha256}`);
  return h.digest('hex').slice(0, 12);
}

export async function writeMeta(
  summaries: DatasetSummary[],
  validation: ValidationReport | null,
): Promise<MetaResponse> {
  const src = sourceSummaries();
  const offices = {} as MetaResponse['offices'];
  for (const office of ['federal', 'state', 'municipal'] as const) {
    const list = summaries.filter((s) => s.office === office);
    const o: OfficeSummary = {
      office,
      year: list[0]?.year ?? (office === 'municipal' ? 2024 : 2026),
      seats: list.reduce((a, s) => a + s.area.seats, 0),
      electorate: list.reduce((a, s) => a + s.area.electorate, 0),
      systems: [...SYSTEM_IDS],
      areas: list
        .map((s) => s.area)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.code.localeCompare(b.code)),
    };
    offices[office] = o;
  }
  const meta: MetaResponse = {
    dataVersion: dataVersion(src, await hashOutputs()),
    generatedAt: new Date().toISOString(),
    offices,
    sources: src,
    validation: validation ? { areas: validation.areas, exact: validation.exact } : null,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'meta.json'), JSON.stringify(meta));
  if (validation) await writeFile(join(OUT_DIR, 'validation.json'), JSON.stringify(validation));
  return meta;
}
