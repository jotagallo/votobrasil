import { districtPlanFor, mixedDistrictSeats, type Dataset } from '@votobr/shared';

/** Limite de desvio populacional de um distrito em relação à cota (PLS 86/2017). */
const DISTRICT_LIMIT = 0.1;

/** Retângulo que contém o território brasileiro (inclui ilhas oceânicas). */
const BR_BOUNDS = { lat: [-34, 6], lon: [-74.5, -28] } as const;

const isElected = (status: string): boolean =>
  status === 'QP' || status === 'MEDIA' || status === 'MAJ';

function sumPairs(pairs: number[]): number {
  let total = 0;
  for (let i = 1; i < pairs.length; i += 2) total += pairs[i] as number;
  return total;
}

/** Verificações de consistência interna de um dataset. Retorna a lista de problemas (vazia = íntegro). */
export function checkDataset(ds: Dataset): string[] {
  const problems: string[] = [];
  const fail = (msg: string): void => {
    problems.push(`${ds.key}: ${msg}`);
  };

  if (ds.schema !== 1) fail(`schema ${String(ds.schema)} desconhecido`);
  if (!ds.units.length) fail('sem unidades geográficas');
  if (!ds.candidates.length) fail('sem candidatos');

  const elected = ds.candidates.filter((c) => isElected(c.status)).length;
  if (elected !== ds.seats) fail(`cadeiras (${ds.seats}) ≠ eleitos oficiais (${elected})`);

  const electorate = ds.units.reduce((a, u) => a + u.voters, 0);
  if (electorate !== ds.electorate)
    fail(`eleitorado (${ds.electorate}) ≠ soma das unidades (${electorate})`);

  ds.units.forEach((u, i) => {
    if (!(u.voters >= 0) || !Number.isFinite(u.voters)) fail(`unidade ${i}: eleitores inválidos`);
    if (
      !Number.isFinite(u.lat) ||
      !Number.isFinite(u.lon) ||
      u.lat < BR_BOUNDS.lat[0] ||
      u.lat > BR_BOUNDS.lat[1] ||
      u.lon < BR_BOUNDS.lon[0] ||
      u.lon > BR_BOUNDS.lon[1]
    ) {
      fail(`unidade ${i}: coordenada fora do Brasil (${u.lat}, ${u.lon})`);
    }
  });

  const ids = new Set<string>();
  let nominal = 0;
  for (const c of ds.candidates) {
    if (ids.has(c.id)) fail(`candidato duplicado ${c.id}`);
    ids.add(c.id);
    if (!ds.competitors[c.comp]) fail(`candidato ${c.id}: competidor ${c.comp} inexistente`);
    if (c.votes < 0 || !Number.isInteger(c.votes)) fail(`candidato ${c.id}: votos inválidos`);
    nominal += c.votes;
    if (c.u.length % 2 !== 0) fail(`candidato ${c.id}: pares de unidade malformados`);
    for (let i = 0; i < c.u.length; i += 2) {
      if (!ds.units[c.u[i] as number]) fail(`candidato ${c.id}: unidade ${c.u[i]} inexistente`);
    }
    if (c.u.length && sumPairs(c.u) !== c.votes) {
      fail(`candidato ${c.id}: votos por unidade (${sumPairs(c.u)}) ≠ total (${c.votes})`);
    }
  }

  let legend = 0;
  for (const comp of ds.competitors) {
    legend += comp.legend;
    const byParty = Object.values(comp.legendByParty).reduce((a, v) => a + v, 0);
    if (byParty !== comp.legend)
      fail(`${comp.id}: legenda por partido (${byParty}) ≠ total (${comp.legend})`);
    if (comp.legendByUnit.length && sumPairs(comp.legendByUnit) !== comp.legend) {
      fail(
        `${comp.id}: legenda por unidade (${sumPairs(comp.legendByUnit)}) ≠ total (${comp.legend})`,
      );
    }
  }
  if (nominal + legend !== ds.validVotes) {
    fail(`votos válidos (${ds.validVotes}) ≠ nominais + legenda (${nominal + legend})`);
  }

  for (const k of new Set([ds.seats, mixedDistrictSeats(ds.seats)])) {
    if (k <= 1) continue;
    const stored = ds.districtPlans?.[String(k)];
    if (!stored) {
      fail(`sem desenho de ${k} distritos`);
      continue;
    }
    const validDistrict = (d: number) => Number.isInteger(d) && d >= 0 && d < k;
    if (stored.unitDistrict.length !== ds.units.length) {
      fail(`distritos (${k}): unidades faltando`);
      continue;
    }
    if (stored.unitDistrict.some((d) => !validDistrict(d))) {
      fail(`distritos (${k}): índice inválido`);
      continue;
    }
    if (
      stored.points?.some(
        ([lon, lat, d, voters, unit]) =>
          !Number.isFinite(lon) ||
          !Number.isFinite(lat) ||
          lon < BR_BOUNDS.lon[0] ||
          lon > BR_BOUNDS.lon[1] ||
          lat < BR_BOUNDS.lat[0] ||
          lat > BR_BOUNDS.lat[1] ||
          !validDistrict(d) ||
          !Number.isFinite(voters) ||
          voters < 0 ||
          !Number.isInteger(unit) ||
          unit < 0 ||
          unit >= ds.units.length,
      )
    ) {
      fail(`distritos (${k}): local de votação inválido`);
      continue;
    }
    if (ds.units.some((u) => typeof u.pop !== 'number' || !Number.isFinite(u.pop) || u.pop < 0)) {
      fail(`distritos (${k}): população ausente ou inválida`);
      continue;
    }
    if (stored.labels.length !== k) fail(`distritos (${k}): ${stored.labels.length} nomes`);
    const plan = districtPlanFor(ds, k);
    if (plan.population.some((p) => !Number.isFinite(p) || p <= 0)) {
      fail(`distritos (${k}): distrito vazio ou população inválida`);
      continue;
    }
    const quota = plan.population.reduce((a, b) => a + b, 0) / k;
    const worst = Math.max(...plan.population.map((p) => Math.abs(p / quota - 1)));
    if (worst > DISTRICT_LIMIT) fail(`distritos (${k}): desvio de ${(worst * 100).toFixed(1)}%`);
  }
  return problems;
}
