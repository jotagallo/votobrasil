import { createHash, timingSafeEqual } from 'node:crypto';
import { join, sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { LRUCache } from 'lru-cache';
import {
  API_PREFIX,
  OFFICE_IDS,
  isSystemId,
  isUf,
  type ErrorResponse,
  type OfficeId,
  type SystemId,
} from '@votobr/shared';
import type { Config } from './config.js';
import { DataStore } from './data.js';
import { simulateArea, simulateChamber } from './service.js';

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';
/** `?v=` ausente ou desatualizado: nunca cachear por muito tempo. */
const UNVERSIONED = 'public, max-age=60, s-maxage=60';
const META_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

type Query = { v?: string; system?: string };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorResponse['error']['code'],
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(400, 'bad_request', message);
const notFound = (message: string) => new HttpError(404, 'not_found', message);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface App {
  server: FastifyInstance;
  store: DataStore;
}

export async function buildApp(config: Config): Promise<App> {
  const store = new DataStore(config.dataDir, config.datasetCacheMb);
  await store.init();

  const server = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers["x-origin-verify"]', 'req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy:
      config.trustProxyHops > 0
        ? (_address: string, hop: number) => hop < config.trustProxyHops
        : false,
    routerOptions: { maxParamLength: 64 },
    bodyLimit: 1024,
  });

  // Os handlers precisam existir antes das rotas: o Fastify fixa o handler de erro no momento do registro.
  server.setNotFoundHandler(async (req, reply) => {
    const isApi = req.url.startsWith(API_PREFIX);
    // Rotas do SPA (sem extensão de arquivo) recebem o index.html; arquivos ausentes e /api dão 404.
    const path = req.url.split('?')[0] ?? '/';
    if (config.webDir && req.method === 'GET' && !isApi && !/\.[a-z0-9]+$/i.test(path)) {
      return reply
        .header('cache-control', 'no-cache')
        .type('text/html; charset=utf-8')
        .sendFile('index.html');
    }
    return reply
      .code(404)
      .header('cache-control', 'no-store')
      .send({ error: { code: 'not_found', message: 'Not found' } } satisfies ErrorResponse);
  });

  server.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.status)
        .header('cache-control', 'no-store')
        .send({ error: { code: err.code, message: err.message } } satisfies ErrorResponse);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .header('cache-control', 'no-store')
        .send({
          error: {
            code: status === 429 ? 'rate_limited' : 'bad_request',
            message: (err as Error).message,
          },
        } satisfies ErrorResponse);
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .header('cache-control', 'no-store')
      .send({ error: { code: 'internal', message: 'Internal error' } } satisfies ErrorResponse);
  });

  const results = new LRUCache<string, string>({
    maxSize: config.resultCacheMb * 1024 * 1024,
    sizeCalculation: (body) => body.length,
  });
  const inflight = new Map<string, Promise<string>>();

  async function cached(key: string, compute: () => Promise<unknown> | unknown): Promise<string> {
    const hit = results.get(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const body = JSON.stringify(await compute());
      results.set(key, body);
      return body;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  /** Cabeçalhos de cache + ETag. Retorna `true` quando respondeu 304. */
  function conditional(
    req: FastifyRequest<{ Querystring: Query }>,
    reply: FastifyReply,
    tag: string,
  ): boolean {
    const versioned = req.query.v === store.dataVersion;
    const etag = `"${store.dataVersion}-${createHash('sha1').update(tag).digest('hex').slice(0, 16)}"`;
    reply.header('etag', etag);
    reply.header('cache-control', versioned ? IMMUTABLE : UNVERSIONED);
    reply.header('x-data-version', store.dataVersion);
    if (req.headers['if-none-match'] === etag) {
      void reply.code(304).send();
      return true;
    }
    return false;
  }

  // Aceita apenas tráfego vindo do CloudFront (segredo compartilhado), exceto a verificação de saúde.
  const secret = config.originVerifySecret;
  if (secret) {
    server.addHook('onRequest', async (req, reply) => {
      if (req.url === '/healthz') return;
      const sent = req.headers['x-origin-verify'];
      if (typeof sent !== 'string' || !safeEqual(sent, secret)) {
        return reply
          .code(403)
          .send({ error: { code: 'forbidden', message: 'Forbidden' } } satisfies ErrorResponse);
      }
    });
  }

  if (config.corsOrigins.length) {
    server.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (!origin || !config.corsOrigins.includes(origin)) return;
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      if (req.method === 'OPTIONS') {
        return reply
          .header('access-control-allow-methods', 'GET, HEAD, OPTIONS')
          .header('access-control-allow-headers', 'accept, if-none-match')
          .header('access-control-max-age', '86400')
          .code(204)
          .send();
      }
    });
  }

  await server.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...config.cspScriptSrc],
        'connect-src': ["'self'", ...config.cspConnectSrc],
        'img-src': ["'self'", 'data:'],
        'style-src': ["'self'"],
        'style-src-attr': ["'unsafe-inline'"],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    // HSTS fica por conta do CloudFront; no origem (HTTP local) causaria problemas.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
  });
  await server.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  await server.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith(API_PREFIX),
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new Error(`Too many requests; retry in ${ctx.after}`), { statusCode: 429 }),
  });

  server.get('/healthz', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok', dataVersion: store.dataVersion };
  });

  server.get<{ Querystring: Query }>(`${API_PREFIX}/meta`, async (_req, reply) => {
    reply.header('cache-control', META_CACHE).header('x-data-version', store.dataVersion);
    return store.meta;
  });

  server.get<{ Querystring: Query }>(`${API_PREFIX}/validation`, async (req, reply) => {
    if (!store.validation) throw notFound('Validation report not available');
    if (conditional(req, reply, 'validation')) return reply;
    return reply.type('application/json').send(JSON.stringify(store.validation));
  });

  function parseOffice(raw: string): OfficeId {
    if (!(OFFICE_IDS as readonly string[]).includes(raw) || !store.has(raw as OfficeId)) {
      throw notFound(`Unknown office "${raw}"`);
    }
    return raw as OfficeId;
  }

  function parseSystem(office: OfficeId, raw: string | undefined): SystemId {
    const system = raw ?? 'atual';
    if (!isSystemId(system)) throw bad(`Unknown system "${system}"`);
    return system;
  }

  server.get<{ Params: { office: string; area: string }; Querystring: Query }>(
    `${API_PREFIX}/simulate/:office/:area`,
    async (req, reply) => {
      const office = parseOffice(req.params.office);
      const key = store.keyOf(office, req.params.area);
      if (!key) throw notFound(`Unknown area "${req.params.area}" for ${office}`);
      const system = parseSystem(office, req.query.system);
      const tag = `simulate|${key}|${system}`;
      if (conditional(req, reply, tag)) return reply;
      const body = await cached(tag, async () => {
        const ds = await store.dataset(key);
        if (!ds) throw notFound(`Dataset unavailable for ${key}`);
        return simulateArea(ds, system);
      });
      return reply.type('application/json').send(body);
    },
  );

  server.get<{ Params: { office: string }; Querystring: Query }>(
    `${API_PREFIX}/chamber/:office`,
    async (req, reply) => {
      const office = parseOffice(req.params.office);
      if (office === 'municipal') throw bad('Municipal councils are simulated one city at a time');
      const system = parseSystem(office, req.query.system);
      const tag = `chamber|${office}|${system}`;
      if (conditional(req, reply, tag)) return reply;
      const body = await cached(tag, () => simulateChamber(store, office, system));
      return reply.type('application/json').send(body);
    },
  );

  async function sendGeo(
    req: FastifyRequest<{ Querystring: Query }>,
    reply: FastifyReply,
    rel: string,
  ): Promise<FastifyReply> {
    if (conditional(req, reply, `geo|${rel}`)) return reply;
    const file = await store.file(rel);
    if (!file) throw notFound('Geometry not found');
    return reply.type('application/json').send(file);
  }

  server.get<{ Querystring: Query }>(`${API_PREFIX}/geo/br.topo.json`, (req, reply) =>
    sendGeo(req, reply, join('geo', 'br.topo.json')),
  );

  server.get<{ Params: { file: string }; Querystring: Query }>(
    `${API_PREFIX}/geo/uf/:file`,
    (req, reply) => {
      const code = /^([A-Z]{2})\.topo\.json$/.exec(req.params.file)?.[1];
      if (!code || !isUf(code)) throw notFound('Unknown state');
      return sendGeo(req, reply, join('geo', 'uf', `${code}.topo.json`));
    },
  );

  server.get<{ Params: { file: string }; Querystring: Query }>(
    `${API_PREFIX}/geo/city/:file`,
    (req, reply) => {
      const ibge = /^(\d{7})\.topo\.json$/.exec(req.params.file)?.[1];
      const known = ibge && store.keyOf('municipal', ibge);
      if (!ibge || !known) throw notFound('Unknown city');
      return sendGeo(req, reply, join('geo', 'city', `${ibge}.topo.json`));
    },
  );

  const assetsDir = config.webDir ? join(config.webDir, 'assets') + sep : '';
  if (config.webDir) {
    await server.register(fastifyStatic, {
      root: config.webDir,
      index: ['index.html'],
      dotfiles: 'ignore',
      cacheControl: false,
      setHeaders: (reply, path) => {
        if (path.startsWith(assetsDir)) {
          reply.header('cache-control', 'public, max-age=31536000, immutable');
        } else if (path.endsWith('index.html')) {
          reply.header('cache-control', 'no-cache');
        } else {
          reply.header('cache-control', 'public, max-age=3600');
        }
      },
    });
  }

  return { server, store };
}
