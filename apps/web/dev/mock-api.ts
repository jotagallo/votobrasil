/**
 * Plugin Vite de desenvolvimento: serve `/api/v1/*` e `/healthz` com dados sintéticos.
 *
 * - `VITE_MOCK_API=1`: sempre usa o mock.
 * - `VITE_MOCK_API=0`: nunca usa o mock (o proxy do Vite encaminha para a API real).
 * - não definida: usa a API real se `${apiTarget}/healthz` responder; senão, o mock.
 *
 * Só é carregado por `vite.config.ts` no servidor de desenvolvimento; nunca entra no build.
 */
import path from 'node:path';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

interface MockHandler {
  handle(url: URL): { status: number; body: string; contentType?: string } | null;
  describe(): string;
}

const LATENCY_MS = 40;

async function apiIsUp(target: string): Promise<boolean> {
  try {
    const response = await fetch(`${target}/healthz`, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

export function mockApi(options: { apiTarget: string }): Plugin {
  return {
    name: 'votobr-mock-api',
    apply: 'serve',
    configureServer(server) {
      const env = {
        ...loadEnv(server.config.mode, server.config.envDir || server.config.root, 'VITE_'),
        ...process.env,
      };
      const forced = env.VITE_MOCK_API;
      const geoDir = path.resolve(server.config.root, '../../data/processed/geo');
      let decision: Promise<MockHandler | null> | null = null;

      const decide = async (): Promise<MockHandler | null> => {
        const useMock = forced === '1' || (forced !== '0' && !(await apiIsUp(options.apiTarget)));
        if (!useMock) {
          server.config.logger.info(`[mock-api] API real em ${options.apiTarget}`);
          return null;
        }
        const mod = (await server.ssrLoadModule('/dev/mock/handler.ts')) as {
          createMockApi(args: { geoDir: string }): MockHandler;
        };
        const handler = mod.createMockApi({ geoDir });
        server.config.logger.info(`[mock-api] dados sintéticos ativos (${handler.describe()})`);
        return handler;
      };

      server.middlewares.use(async (req, res, next) => {
        const raw = req.url ?? '';
        if (req.method !== 'GET' || !(raw.startsWith('/api/') || raw.startsWith('/healthz')))
          return next();
        try {
          decision ??= decide();
          const handler = await decision;
          if (!handler) return next();
          const response = handler.handle(new URL(raw, 'http://localhost'));
          if (!response) return next();
          await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
          res.statusCode = response.status;
          res.setHeader('content-type', response.contentType ?? 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(response.body);
        } catch (error) {
          server.config.logger.error(
            `[mock-api] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
          );
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: { code: 'internal', message: 'Falha no mock de desenvolvimento.' },
            }),
          );
        }
      });
    },
  };
}
