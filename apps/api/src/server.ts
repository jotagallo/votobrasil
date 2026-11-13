import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { server, store } = await buildApp(config);

  if (config.production && !config.originVerifySecret) {
    server.log.warn(
      'ORIGIN_VERIFY_SECRET não definido: a API aceita requisições sem verificação de origem.',
    );
  }

  const shutdown = (signal: string) => {
    server.log.info({ signal }, 'encerrando');
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.listen({ port: config.port, host: config.host });
  server.log.info(
    { dataVersion: store.dataVersion, web: config.webDir ?? 'desativado' },
    'VotoBrasil API pronta',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
