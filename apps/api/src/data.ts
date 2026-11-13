import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { LRUCache } from 'lru-cache';
import { SYSTEM_IDS } from '@votobr/shared';
import type { Dataset, MetaResponse, OfficeId, ValidationReport } from '@votobr/shared';

const brotli = promisify(brotliDecompress);

/** Em memória o JSON já interpretado ocupa bem mais que o texto; usamos um fator conservador. */
const MEMORY_FACTOR = 4;

export class DataStore {
  meta!: MetaResponse;
  validation: ValidationReport | null = null;
  private readonly datasets: LRUCache<string, Dataset>;
  private readonly inflight = new Map<string, Promise<Dataset | null>>();
  private readonly files = new Map<string, Buffer | null>();
  private areas = new Map<string, string>();

  constructor(
    private readonly dir: string,
    datasetCacheMb: number,
  ) {
    this.datasets = new LRUCache<string, Dataset>({
      maxSize: datasetCacheMb * 1024 * 1024,
      sizeCalculation: (ds) => Math.max(1, (ds as Dataset & { bytes?: number }).bytes ?? 1),
    });
  }

  async init(): Promise<void> {
    try {
      this.meta = JSON.parse(await readFile(join(this.dir, 'meta.json'), 'utf8')) as MetaResponse;
    } catch (err) {
      throw new Error(
        `Não foi possível ler ${join(this.dir, 'meta.json')}. Gere os dados com "npm run data:build" ` +
          `ou aponte DATA_DIR para a pasta correta. (${(err as Error).message})`,
        { cause: err },
      );
    }
    try {
      this.validation = JSON.parse(
        await readFile(join(this.dir, 'validation.json'), 'utf8'),
      ) as ValidationReport;
    } catch {
      this.validation = null;
    }
    this.areas.clear();
    for (const office of Object.values(this.meta.offices)) {
      // Os sistemas dependem do código, não dos dados: um meta.json antigo pode citar ids removidos.
      office.systems = [...SYSTEM_IDS];
      for (const area of office.areas) {
        this.areas.set(
          `${office.office}:${area.code}`,
          `${office.year}-${office.office}-${area.code}`,
        );
      }
    }
  }

  get dataVersion(): string {
    return this.meta.dataVersion;
  }

  /** Chave do dataset (ex.: `2026-federal-SP`) ou `null` se a área não existe. */
  keyOf(office: OfficeId, area: string): string | null {
    return this.areas.get(`${office}:${area}`) ?? null;
  }

  has(office: OfficeId): boolean {
    return (this.meta.offices[office]?.areas.length ?? 0) > 0;
  }

  async dataset(key: string): Promise<Dataset | null> {
    const cached = this.datasets.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const load = this.load(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, load);
    return load;
  }

  private async load(key: string): Promise<Dataset | null> {
    let packed: Buffer;
    try {
      packed = await readFile(join(this.dir, 'datasets', `${key}.json.br`));
    } catch {
      return null;
    }
    const json = await brotli(packed);
    const ds = JSON.parse(json.toString('utf8')) as Dataset & { bytes?: number };
    Object.defineProperty(ds, 'bytes', { value: json.length * MEMORY_FACTOR, enumerable: false });
    this.datasets.set(key, ds);
    return ds;
  }

  /** Arquivo estático pequeno (TopoJSON) mantido em memória. `rel` já deve estar validado pelo chamador. */
  async file(rel: string): Promise<Buffer | null> {
    if (this.files.has(rel)) return this.files.get(rel) ?? null;
    let buf: Buffer | null;
    try {
      buf = await readFile(join(this.dir, rel));
    } catch {
      buf = null;
    }
    if (this.files.size < 256) this.files.set(rel, buf);
    return buf;
  }
}
