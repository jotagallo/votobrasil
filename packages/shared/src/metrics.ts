import type { ChamberMetrics, PartyVotes } from './types.js';

/**
 * Índice de desproporcionalidade de Gallagher (least squares), em pontos percentuais:
 * 0 = cadeiras exatamente proporcionais aos votos.
 */
export function gallagher(voteShares: readonly number[], seatShares: readonly number[]): number {
  let sum = 0;
  const n = Math.max(voteShares.length, seatShares.length);
  for (let i = 0; i < n; i++) {
    const d = ((voteShares[i] ?? 0) - (seatShares[i] ?? 0)) * 100;
    sum += d * d;
  }
  return Math.sqrt(sum / 2);
}

/** Número efetivo de partidos (Laakso–Taagepera): 1 / Σ p². */
export function effectiveNumber(shares: readonly number[]): number {
  const sq = shares.reduce((a, s) => a + s * s, 0);
  return sq > 0 ? 1 / sq : 0;
}

export function computeMetrics(
  seatsByParty: Record<string, number>,
  votes: PartyVotes,
  seats: number,
): ChamberMetrics {
  const parties = [...new Set([...Object.keys(seatsByParty), ...Object.keys(votes)])].sort();
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const totalSeats = Object.values(seatsByParty).reduce((a, b) => a + b, 0) || seats;
  const voteShares = parties.map((p) => (totalVotes > 0 ? (votes[p] ?? 0) / totalVotes : 0));
  const seatShares = parties.map((p) => (seatsByParty[p] ?? 0) / totalSeats);

  const majority = Math.floor(seats / 2) + 1;
  const sortedSeats = Object.values(seatsByParty)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  let acc = 0;
  let partiesForMajority = 0;
  for (const n of sortedSeats) {
    acc += n;
    partiesForMajority++;
    if (acc >= majority) break;
  }

  const withoutSeat = parties.reduce(
    (a, p) => ((seatsByParty[p] ?? 0) === 0 ? a + (votes[p] ?? 0) : a),
    0,
  );

  return {
    seats,
    majority,
    gallagher: gallagher(voteShares, seatShares),
    effectiveParties: effectiveNumber(seatShares.filter((s) => s > 0)),
    partiesWithSeats: sortedSeats.length,
    partiesForMajority,
    largestShare: sortedSeats.length ? (sortedSeats[0] as number) / totalSeats : 0,
    votesWithoutSeatPct: totalVotes > 0 ? (withoutSeat / totalVotes) * 100 : 0,
  };
}
