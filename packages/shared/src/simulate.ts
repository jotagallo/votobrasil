import type {
  Dataset,
  DistrictResult,
  PartyVotes,
  SimulationResult,
  SystemId,
  Winner,
} from './types.js';
import { highestAverages } from './systems/divisors.js';
import { candidatesByCompetitor, competitorTotals } from './systems/open-list.js';
import {
  districtMapPoints,
  districtPlanFor,
  forEachShare,
  tallyDistricts,
  type DistrictPlan,
} from './systems/districts.js';

/**
 * Cadeiras decididas em distritos no voto distrital misto da PEC 2/2025 (art. 45, § 1º):
 * cinquenta por cento da representação de cada circunscrição, ou o número inteiro maior mais próximo.
 */
export function mixedDistrictSeats(seats: number): number {
  return Math.max(1, Math.min(seats, Math.ceil(seats / 2)));
}

function toResult(
  ds: Dataset,
  system: SystemId,
  winners: Winner[],
  extra: Partial<SimulationResult> = {},
): SimulationResult {
  const seatsByParty: Record<string, number> = {};
  for (const w of winners) seatsByParty[w.party] = (seatsByParty[w.party] ?? 0) + 1;
  return {
    system,
    areaKey: ds.key,
    seats: ds.seats,
    districtSeats: 0,
    listSeats: 0,
    overhangSeats: 0,
    seatsByParty,
    winners,
    ...extra,
  };
}

function winnerOf(ds: Dataset, index: number, tier: Winner['tier'], district?: number): Winner {
  const c = ds.candidates[index] as Dataset['candidates'][number];
  const w: Winner = {
    name: c.name,
    party: c.party,
    competitor: ds.competitors[c.comp]?.id ?? c.party,
    votes: c.votes,
    tier,
  };
  if (district !== undefined) w.district = district;
  return w;
}

/** Resultado oficial apurado pelo TSE. */
export function officialResult(ds: Dataset): SimulationResult {
  const winners: Winner[] = [];
  ds.candidates.forEach((c, i) => {
    if (c.status === 'QP') winners.push(winnerOf(ds, i, 'qp'));
    else if (c.status === 'MEDIA') winners.push(winnerOf(ds, i, 'sobra'));
    else if (c.status === 'MAJ') winners.push(winnerOf(ds, i, 'oficial'));
  });
  winners.sort((a, b) => b.votes - a.votes);
  return toResult(ds, 'atual', winners);
}

/** Cadeiras de lista fechada: maiores médias (D'Hondt) entre competidores; ordem da lista = votação nominal. */
function closedListSeats(ds: Dataset, seats: number): number[] {
  const totals = competitorTotals(ds);
  const lists = candidatesByCompetitor(ds);
  const alloc = highestAverages(totals, seats, {
    eligible: (c, cur) => (cur[c] ?? 0) < (lists[c]?.length ?? 0),
  });
  return alloc.flatMap((n, c) => (lists[c] ?? []).slice(0, n));
}

/**
 * Voto distrital misto da PEC 2/2025 (art. 45, §§ 1º a 5º): metade das cadeiras em distritos
 * uninominais; o total de cada partido é proporcional ao voto no partido (D'Hondt sobre todas as
 * cadeiras), descontadas as vitórias distritais, e a lista completa a diferença. Se um partido
 * vence mais distritos do que lhe cabe, mantém essas cadeiras e a casa aumenta (§ 4º).
 */
function mixedMember(ds: Dataset): SimulationResult {
  const seats = ds.seats;
  const outcome = districtPlurality(ds, mixedDistrictSeats(seats));
  const taken = new Set(outcome.winnerCandidates.filter((i): i is number => i !== null));
  const totals = competitorTotals(ds);
  const lists = candidatesByCompetitor(ds).map((l) => l.filter((i) => !taken.has(i)));
  const wins = outcome.winsByComp;
  const entitled = highestAverages(totals, seats, {
    eligible: (c, cur) => (cur[c] ?? 0) < (wins[c] ?? 0) + (lists[c]?.length ?? 0),
  });
  let overhang = 0;
  const listWinners: number[] = [];
  entitled.forEach((n, c) => {
    const won = wins[c] ?? 0;
    if (won > n) overhang += won - n;
    listWinners.push(...(lists[c] ?? []).slice(0, Math.max(0, n - won)));
  });
  const winners: Winner[] = [
    ...outcome.winnerCandidates.flatMap((idx, d) =>
      idx === null ? [] : [winnerOf(ds, idx, 'distrito', d)],
    ),
    ...listWinners.map((i) => winnerOf(ds, i, 'lista')),
  ];
  return toResult(ds, 'distrital-misto', winners, {
    seats: winners.length,
    districtSeats: taken.size,
    listSeats: listWinners.length,
    overhangSeats: overhang,
    ...districtExtra(ds, outcome),
  });
}

interface DistrictOutcome {
  plan: DistrictPlan;
  results: DistrictResult[];
  winnerCandidates: (number | null)[];
  winsByComp: number[];
}

/**
 * Distrito "de origem" de cada candidato: aquele em que teve mais votos (empate: menor índice).
 * Num sistema distrital cada candidato concorre em um único distrito; adota-se o da sua maior
 * votação, como nas simulações de referência (ver docs/METHODOLOGY.md).
 */
function homeDistricts(ds: Dataset, candVotes: readonly Map<number, number>[]): Int32Array {
  const home = new Int32Array(ds.candidates.length).fill(-1);
  const best = new Float64Array(ds.candidates.length);
  candVotes.forEach((map, d) => {
    for (const [idx, v] of map) {
      if (v > (best[idx] ?? 0)) {
        best[idx] = v;
        home[idx] = d;
      }
    }
  });
  return home;
}

/**
 * Maioria simples em distritos uninominais: em cada distrito vence o candidato mais votado entre
 * os que concorrem ali (votos nominais no distrito). Votos de legenda não elegem candidato distrital.
 */
function districtPlurality(ds: Dataset, count: number): DistrictOutcome {
  const plan = districtPlanFor(ds, count);
  const tally = tallyDistricts(ds, plan);
  const home = homeDistricts(ds, tally.candVotes);
  const used = new Set<number>();
  const results: DistrictResult[] = [];
  const munByDistrict: Set<number>[] = Array.from({ length: plan.count }, () => new Set());
  ds.units.forEach((u, i) => forEachShare(plan, i, (d) => munByDistrict[d]?.add(u.mun)));
  const winnerCandidates: (number | null)[] = new Array(plan.count).fill(null);

  const rank = (d: number, accept: (idx: number) => boolean): [number, number][] =>
    [...(tally.candVotes[d] ?? new Map<number, number>())]
      .filter(([idx]) => accept(idx))
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  const decide = (d: number, ranking: [number, number][]) => {
    const total = [...(tally.compVotes[d] ?? new Map<number, number>()).values()].reduce(
      (a, v) => a + v,
      0,
    );
    const first = ranking[0];
    const second = ranking[1];
    if (first) {
      used.add(first[0]);
      winnerCandidates[d] = first[0];
    }
    const cand = first ? ds.candidates[first[0]] : undefined;
    results[d] = {
      id: d,
      voters: plan.voters[d] ?? 0,
      population: plan.population[d] ?? 0,
      ...(plan.labels?.[d] ? { label: plan.labels[d] } : {}),
      mun: [...(munByDistrict[d] ?? [])].sort((a, b) => a - b),
      winnerParty: cand?.party ?? '',
      winnerCompetitor: cand ? (ds.competitors[cand.comp]?.id ?? '') : '',
      marginPct: total > 0 && first ? ((first[1] - (second?.[1] ?? 0)) / total) * 100 : 0,
    };
  };

  const empty: number[] = [];
  for (let d = 0; d < plan.count; d++) {
    const ranking = rank(d, (idx) => home[idx] === d);
    if (ranking.length === 0) empty.push(d);
    else decide(d, ranking);
  }
  // Distrito sem nenhum candidato "de origem" (raro): vale o mais votado ali que ainda não venceu.
  for (const d of empty)
    decide(
      d,
      rank(d, (idx) => !used.has(idx)),
    );

  const winsByComp = ds.competitors.map(() => 0);
  for (const idx of winnerCandidates) {
    const comp = idx === null ? undefined : ds.candidates[idx]?.comp;
    if (comp !== undefined) winsByComp[comp] = (winsByComp[comp] ?? 0) + 1;
  }
  return { plan, results, winnerCandidates, winsByComp };
}

function districtExtra(ds: Dataset, outcome: DistrictOutcome): Partial<SimulationResult> {
  return {
    districts: outcome.results,
    unitDistrict: Array.from(outcome.plan.unitDistrict),
    mapPoints: districtMapPoints(ds, outcome.plan),
    maxDistrictDeviationPct: outcome.plan.maxDeviationPct,
  };
}

export function simulate(ds: Dataset, system: SystemId): SimulationResult {
  const seats = ds.seats;
  switch (system) {
    case 'atual':
      return officialResult(ds);

    case 'lista-fechada':
      return toResult(
        ds,
        system,
        closedListSeats(ds, seats).map((i) => winnerOf(ds, i, 'lista')),
        { listSeats: seats },
      );

    case 'distritao': {
      const top = ds.candidates
        .map((_, i) => i)
        .sort((a, b) => (ds.candidates[b]?.votes ?? 0) - (ds.candidates[a]?.votes ?? 0) || a - b)
        .slice(0, seats);
      return toResult(
        ds,
        system,
        top.map((i) => winnerOf(ds, i, 'mais-votados')),
      );
    }

    case 'distrital-puro': {
      const outcome = districtPlurality(ds, seats);
      const winners = outcome.winnerCandidates.flatMap((idx, d) =>
        idx === null ? [] : [winnerOf(ds, idx, 'distrito', d)],
      );
      return toResult(ds, system, winners, {
        districtSeats: outcome.plan.count,
        ...districtExtra(ds, outcome),
      });
    }

    case 'distrital-misto':
      return mixedMember(ds);
  }
}

/** Votos válidos por partido (nominais dos candidatos + legenda atribuída ao partido). */
export function partyVotes(ds: Dataset): PartyVotes {
  const out: PartyVotes = {};
  for (const c of ds.candidates) out[c.party] = (out[c.party] ?? 0) + c.votes;
  for (const comp of ds.competitors) {
    for (const [party, v] of Object.entries(comp.legendByParty)) out[party] = (out[party] ?? 0) + v;
  }
  return out;
}

/** Soma resultados de várias circunscrições (ex.: 27 UFs → Câmara dos Deputados). */
export function mergeResults(
  areaKey: string,
  system: SystemId,
  parts: SimulationResult[],
): SimulationResult {
  const seatsByParty: Record<string, number> = {};
  const winners: Winner[] = [];
  let seats = 0;
  let districtSeats = 0;
  let listSeatsTotal = 0;
  let overhangSeats = 0;
  for (const p of parts) {
    seats += p.seats;
    districtSeats += p.districtSeats;
    listSeatsTotal += p.listSeats;
    overhangSeats += p.overhangSeats;
    winners.push(...p.winners);
    for (const [party, n] of Object.entries(p.seatsByParty)) {
      seatsByParty[party] = (seatsByParty[party] ?? 0) + n;
    }
  }
  return {
    system,
    areaKey,
    seats,
    districtSeats,
    listSeats: listSeatsTotal,
    overhangSeats,
    seatsByParty,
    winners,
  };
}
