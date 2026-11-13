import type { Dataset } from '../types.js';
import { electoralQuotient, highestAverages } from './divisors.js';

export interface OpenListRules {
  /** Votação mínima do candidato, como fração do quociente eleitoral, para ser eleito por quociente partidário. */
  candidateMinQE: number;
  /** Fração do QE que o partido/federação precisa ter para disputar as sobras. */
  sobrasPartyMinQE: number;
  /** Fração do QE que o candidato precisa ter para ser eleito nas sobras. */
  sobrasCandidateMinQE: number;
}

/** Lei 14.211/2021 (art. 108 e 109 do Código Eleitoral). */
export const RULES_LEI_14211: OpenListRules = {
  candidateMinQE: 0.1,
  sobrasPartyMinQE: 0.8,
  sobrasCandidateMinQE: 0.2,
};

/** Interpretação do STF (ADI 7228/7263/7325, 2024): todos disputam as sobras, mantida a barreira individual de 10%. */
export const RULES_STF_2024: OpenListRules = {
  candidateMinQE: 0.1,
  sobrasPartyMinQE: 0,
  sobrasCandidateMinQE: 0,
};

export interface ElectedCandidate {
  candidate: number;
  tier: 'qp' | 'sobra';
}

export function competitorTotals(ds: Dataset): number[] {
  const totals = ds.competitors.map((c) => c.legend);
  for (const cand of ds.candidates) totals[cand.comp] = (totals[cand.comp] ?? 0) + cand.votes;
  return totals;
}

/** Candidatos de cada competidor ordenados por votos (desc.); empate: ordem do dataset. */
export function candidatesByCompetitor(ds: Dataset): number[][] {
  const lists: number[][] = ds.competitors.map(() => []);
  ds.candidates.forEach((cand, i) => lists[cand.comp]?.push(i));
  for (const list of lists) {
    list.sort((a, b) => (ds.candidates[b]?.votes ?? 0) - (ds.candidates[a]?.votes ?? 0) || a - b);
  }
  return lists;
}

/**
 * Proporcional de lista aberta brasileiro (quociente eleitoral/partidário + sobras por maiores médias).
 */
export function allocateOpenList(
  ds: Dataset,
  rules: OpenListRules = RULES_STF_2024,
  seats: number = ds.seats,
): ElectedCandidate[] {
  const totals = competitorTotals(ds);
  const lists = candidatesByCompetitor(ds);
  const validVotes = totals.reduce((a, b) => a + b, 0);
  const qe = electoralQuotient(validVotes, seats);
  const elected: ElectedCandidate[] = [];
  const taken = ds.competitors.map(() => 0);
  const votesOf = (i: number) => ds.candidates[i]?.votes ?? 0;

  if (qe > 0) {
    ds.competitors.forEach((_, c) => {
      const qp = Math.floor((totals[c] ?? 0) / qe);
      const list = lists[c] ?? [];
      let n = 0;
      while (n < qp && n < list.length && votesOf(list[n] as number) >= rules.candidateMinQE * qe) {
        elected.push({ candidate: list[n] as number, tier: 'qp' });
        n++;
      }
      taken[c] = n;
    });
  }

  let remaining = seats - elected.length;
  if (remaining > 0 && qe > 0) {
    const canTake = (c: number, current: readonly number[]) => {
      if ((totals[c] ?? 0) < rules.sobrasPartyMinQE * qe) return false;
      const next = lists[c]?.[current[c] ?? 0];
      return (
        next !== undefined && votesOf(next) >= rules.sobrasCandidateMinQE * qe && votesOf(next) > 0
      );
    };
    const alloc = highestAverages(totals, remaining, { initial: taken, eligible: canTake });
    ds.competitors.forEach((_, c) => {
      for (let n = taken[c] ?? 0; n < (alloc[c] ?? 0); n++) {
        elected.push({ candidate: lists[c]?.[n] as number, tier: 'sobra' });
      }
      taken[c] = alloc[c] ?? 0;
    });
    remaining = seats - elected.length;
  }

  if (remaining > 0) {
    // Art. 111: se ninguém mais puder disputar, vagas restantes vão aos mais votados.
    const chosen = new Set(elected.map((e) => e.candidate));
    const rest = ds.candidates
      .map((_, i) => i)
      .filter((i) => !chosen.has(i))
      .sort((a, b) => votesOf(b) - votesOf(a) || a - b)
      .slice(0, remaining);
    for (const candidate of rest) elected.push({ candidate, tier: 'sobra' });
  }
  return elected;
}
