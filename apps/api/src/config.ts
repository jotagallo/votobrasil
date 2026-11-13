import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  production: boolean;
  logLevel: string;
  /** Diretório com `meta.json`, `datasets/` e `geo/` gerados pelo ETL. */
  dataDir: string;
  /** Build do front-end (opcional): quando existe, a API também serve o SPA. */
  webDir: string | null;
  /** Origens autorizadas a chamar a API de outro domínio (desenvolvimento). */
  corsOrigins: string[];
  /** Quando definido, toda requisição (exceto /healthz) precisa do header `x-origin-verify` igual a este valor. */
  originVerifySecret: string | null;
  /** Origens extras para a CSP (ex.: script e coleta do Umami). */
  cspScriptSrc: string[];
  cspConnectSrc: string[];
  /** Quantidade de proxies confiáveis à frente do Node (CloudFront + nginx do Elastic Beanstalk = 2). */
  trustProxyHops: number;
  rateLimitPerMinute: number;
  datasetCacheMb: number;
  resultCacheMb: number;
}

type Env = Record<string, string | undefined>;

/** Primeiro candidato (relativo ao cwd) que contém `probe`; cobre o bundle do EB, a raiz do repo e `apps/api`. */
function firstWith(candidates: string[], probe: string): string | null {
  for (const c of candidates) {
    if (existsSync(resolve(c, probe))) return resolve(c);
  }
  return null;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: ${raw})`);
  }
  return n;
}

function origins(name: string, value: string | undefined): string[] {
  return list(value).map((o) => {
    let url: URL;
    try {
      url = new URL(o);
    } catch {
      throw new Error(`${name}: origem inválida "${o}"`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${name}: use http(s), recebido "${o}"`);
    }
    return url.origin;
  });
}

export function loadConfig(env: Env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const webDir = env.WEB_DIR
    ? resolve(env.WEB_DIR)
    : firstWith(['web', 'apps/web/dist', '../web/dist'], 'index.html');
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    production,
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    dataDir: env.DATA_DIR
      ? resolve(env.DATA_DIR)
      : (firstWith(['data', 'data/processed', '../../data/processed'], 'meta.json') ??
        resolve('data')),
    webDir: webDir && existsSync(resolve(webDir, 'index.html')) ? webDir : null,
    corsOrigins: origins('CORS_ORIGINS', env.CORS_ORIGINS),
    originVerifySecret: env.ORIGIN_VERIFY_SECRET?.trim() || null,
    cspScriptSrc: origins(
      'CSP_SCRIPT_SRC_EXTRA',
      env.CSP_SCRIPT_SRC_EXTRA ?? 'https://cloud.umami.is',
    ),
    cspConnectSrc: origins(
      'CSP_CONNECT_SRC_EXTRA',
      env.CSP_CONNECT_SRC_EXTRA ??
        'https://cloud.umami.is https://gateway.umami.is https://api-gateway.umami.dev',
    ),
    trustProxyHops: int(env, 'TRUST_PROXY_HOPS', 0, 0, 5),
    rateLimitPerMinute: int(env, 'RATE_LIMIT_PER_MINUTE', 600, 10, 100_000),
    datasetCacheMb: int(env, 'DATASET_CACHE_MB', 384, 16, 4096),
    resultCacheMb: int(env, 'RESULT_CACHE_MB', 64, 4, 1024),
  };
}
