import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UF_CODES, type MetaResponse, type ValidationReport } from '@votobr/shared';
import { OUT_DIR } from './download.js';
import { readDataset } from './output.js';
import { checkDataset } from './checks.js';

/** Fração máxima tolerada de eleitos oficiais que o motor de apuração não reproduz (ver docs/METHODOLOGY.md). */
const MAX_MISSING_SHARE = Number(process.env.VOTOBR_MAX_MISSING_SHARE ?? 0.02);

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

async function main(): Promise<void> {
  const problems: string[] = [];
  const read = async <T>(file: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(join(OUT_DIR, file), 'utf8')) as T;
    } catch {
      problems.push(`${file}: ausente ou ilegível (rode \`npm run data:build\`)`);
      return null;
    }
  };

  const meta = await read<MetaResponse>('meta.json');
  const validation = await read<ValidationReport>('validation.json');
  if (!meta) return finish(problems);

  if (!/^[0-9a-f]{12}$/.test(meta.dataVersion))
    problems.push(`dataVersion inválida: ${meta.dataVersion}`);
  if (!meta.sources.length) problems.push('meta.json sem fontes registradas');
  if (!(await exists(join(OUT_DIR, 'geo/br.topo.json')))) problems.push('geo/br.topo.json ausente');

  const ufs = process.env.VOTOBR_UFS
    ? process.env.VOTOBR_UFS.split(',').map((s) => s.trim())
    : [...UF_CODES];
  for (const office of ['federal', 'state'] as const) {
    const o = meta.offices[office];
    const codes = o.areas.map((a) => a.code).sort();
    if (codes.join() !== [...ufs].sort().join()) {
      problems.push(`${office}: áreas (${codes.length}) diferem das UFs esperadas (${ufs.length})`);
    }
  }
  const minVoters = Number(process.env.VOTOBR_MIN_MUNICIPAL_VOTERS ?? 1_000_000);
  const cities = meta.offices.municipal.areas;
  if (minVoters > 0 && cities.length === 0) problems.push('municipal: nenhuma cidade no meta.json');
  // O corte usa o eleitorado dos locais de votação; o do meta vem do detalhe da votação (≈ 1% de folga).
  for (const city of cities) {
    if (city.electorate < minVoters * 0.99) {
      problems.push(`municipal: ${city.name} tem ${city.electorate} eleitores (< ${minVoters})`);
    }
  }

  let datasets = 0;
  for (const office of ['federal', 'state', 'municipal'] as const) {
    const o = meta.offices[office];
    for (const area of o.areas) {
      const key = `${o.year}-${office}-${area.code}`;
      let ds;
      try {
        ds = await readDataset(key);
      } catch {
        problems.push(`${key}: dataset ausente`);
        continue;
      }
      datasets++;
      problems.push(...checkDataset(ds));
      if (
        ds.seats !== area.seats ||
        ds.validVotes !== area.validVotes ||
        ds.electorate !== area.electorate
      ) {
        problems.push(`${key}: totais do dataset divergem do meta.json`);
      }
      const geo =
        area.kind === 'state' ? `geo/uf/${area.code}.topo.json` : `geo/city/${area.code}.topo.json`;
      if (!(await exists(join(OUT_DIR, geo)))) problems.push(`${key}: ${geo} ausente`);
    }
  }

  if (!validation) return finish(problems);
  const keys = new Set(validation.entries.map((e) => e.key));
  for (const office of ['federal', 'state', 'municipal'] as const) {
    for (const area of meta.offices[office].areas) {
      const key = `${meta.offices[office].year}-${office}-${area.code}`;
      if (!keys.has(key)) problems.push(`validation.json: sem entrada para ${key}`);
    }
  }
  const seats = validation.entries.reduce((a, e) => a + e.seats, 0);
  const missing = validation.entries.reduce((a, e) => a + e.missing, 0);
  const exact = validation.entries.filter((e) => e.missing === 0).length;
  if (exact !== validation.exact || validation.entries.length !== validation.areas) {
    problems.push('validation.json: contagens internas inconsistentes');
  }
  if (seats > 0 && missing / seats > MAX_MISSING_SHARE) {
    problems.push(
      `apuração simulada não reproduz ${missing}/${seats} eleitos oficiais (limite ${(MAX_MISSING_SHARE * 100).toFixed(1)}%)`,
    );
  }

  console.log(`versão ${meta.dataVersion} — ${datasets} datasets verificados`);
  for (const o of Object.values(meta.offices)) {
    console.log(`  ${o.office} ${o.year}: ${o.areas.length} áreas, ${o.seats} cadeiras`);
  }
  console.log(
    `  reprodução do resultado oficial (${validation.rules}): ${exact}/${validation.areas} áreas exatas, ${missing}/${seats} eleitos divergentes`,
  );
  finish(problems);
}

function finish(problems: string[]): void {
  if (problems.length) {
    console.error(`\n${problems.length} problema(s):`);
    for (const p of problems.slice(0, 50)) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('Dados íntegros ✔');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
