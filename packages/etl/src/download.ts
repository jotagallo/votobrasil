import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export const ROOT = new URL('../../../', import.meta.url).pathname;
export const RAW_DIR = process.env.VOTOBR_RAW_DIR ?? join(ROOT, 'data/raw');
export const OUT_DIR = process.env.VOTOBR_OUT_DIR ?? join(ROOT, 'data/processed');

export const TSE_BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
export const IBGE_BASE = 'https://servicodados.ibge.gov.br/api';

export interface SourceMeta {
  url: string;
  file: string;
  bytes: number;
  sha256: string;
  etag: string | null;
  lastModified: string | null;
  downloadedAt: string;
}

const manifest = new Map<string, SourceMeta>();
export const sources = (): SourceMeta[] =>
  [...manifest.values()].sort((a, b) => a.url.localeCompare(b.url));

async function readMeta(path: string): Promise<SourceMeta | null> {
  try {
    return JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as SourceMeta;
  } catch {
    return null;
  }
}

/** Baixa (ou reutiliza do cache local, validando por ETag) um arquivo oficial e registra SHA-256. */
export async function fetchSource(url: string, name: string): Promise<string> {
  const path = join(RAW_DIR, name);
  await mkdir(dirname(path), { recursive: true });
  const cached = existsSync(path) ? await readMeta(path) : null;
  if (cached) {
    if (process.env.VOTOBR_OFFLINE === '1') {
      manifest.set(url, cached);
      return path;
    }
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (head.ok && head.headers.get('etag') === cached.etag) {
        manifest.set(url, cached);
        return path;
      }
    } catch {
      manifest.set(url, cached);
      return path;
    }
  }

  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const tmp = `${path}.part`;
  const body = Readable.fromWeb(res.body as NodeReadableStream);
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  await pipeline(body, createWriteStream(tmp));
  const expected = Number(res.headers.get('content-length') ?? 0);
  if (expected && expected !== bytes) {
    await rm(tmp, { force: true });
    throw new Error(`Download incompleto de ${url}: ${bytes}/${expected} bytes`);
  }
  await rename(tmp, path);
  const meta: SourceMeta = {
    url,
    file: name,
    bytes: (await stat(path)).size,
    sha256: hash.digest('hex'),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    downloadedAt: new Date().toISOString(),
  };
  await writeFile(`${path}.meta.json`, JSON.stringify(meta, null, 2));
  manifest.set(url, meta);
  return path;
}

export const tseUrl = (dataset: string, file: string) => `${TSE_BASE}/${dataset}/${file}`;
