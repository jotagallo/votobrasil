// Monta dist/bundle.zip para o Elastic Beanstalk: server.mjs, Procfile, web/ (SPA) e data/ (datasets do ETL).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const stage = join(out, 'bundle');

const inputs = {
  server: join(root, 'apps/api/dist/server.mjs'),
  web: join(root, 'apps/web/dist'),
  data: join(root, 'data/processed'),
};

for (const [what, path] of Object.entries(inputs)) {
  if (!existsSync(path)) {
    console.error(
      `bundle: ${what} ausente em ${path} (rode \`npm run build\` e \`npm run data:build\`)`,
    );
    process.exit(1);
  }
}
if (!existsSync(join(inputs.web, 'index.html')) || !existsSync(join(inputs.data, 'meta.json'))) {
  console.error('bundle: web/index.html ou data/meta.json ausente');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(inputs.server, join(stage, 'server.mjs'));
cpSync(inputs.web, join(stage, 'web'), { recursive: true });
cpSync(inputs.data, join(stage, 'data'), { recursive: true });
// O Elastic Beanstalk define PORT e NODE_ENV; a API descobre `web/` e `data/` ao lado de server.mjs.
writeFileSync(join(stage, 'Procfile'), 'web: node server.mjs\n');

const zip = join(out, 'bundle.zip');
try {
  // -X: sem atributos extras; -D: sem entradas de diretório.
  execFileSync('zip', ['-q', '-r', '-X', '-D', zip, '.'], { cwd: stage, stdio: 'inherit' });
} catch (err) {
  console.error(
    'bundle: falha ao executar `zip` (instale o utilitário zip)',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
rmSync(stage, { recursive: true, force: true });
console.log(`dist/bundle.zip: ${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB`);
