import type { SeatMap } from './parties';

export function coalitionSeats(seats: SeatMap, selected: readonly string[]): number {
  return [...new Set(selected)].reduce((sum, id) => sum + (seats[id] ?? 0), 0);
}

export interface CoalitionStatus {
  total: number;
  majority: number;
  hasMajority: boolean;
  /** Cadeiras que faltam para a maioria (0 se já atingida). */
  missing: number;
  /** Cadeiras acima da maioria (0 se não atingida). */
  surplus: number;
}

export function coalitionStatus(
  seats: SeatMap,
  selected: readonly string[],
  majority: number,
): CoalitionStatus {
  const total = coalitionSeats(seats, selected);
  return {
    total,
    majority,
    hasMajority: total >= majority,
    missing: Math.max(0, majority - total),
    surplus: Math.max(0, total - majority),
  };
}

/** Maioria absoluta: ⌊S/2⌋ + 1. */
export function majorityOf(totalSeats: number): number {
  return Math.floor(totalSeats / 2) + 1;
}

/** Menor conjunto de partidos que soma a maioria, tomando as maiores bancadas primeiro. */
export function largestPartiesForMajority(seats: SeatMap, majority: number): string[] {
  const sorted = Object.entries(seats)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: string[] = [];
  let acc = 0;
  for (const [id, n] of sorted) {
    out.push(id);
    acc += n;
    if (acc >= majority) break;
  }
  return out;
}

/** Mantém só os partidos existentes, sem duplicatas, na ordem recebida. */
export function sanitizeCoalition(selected: readonly string[], available: SeatMap): string[] {
  return [...new Set(selected)].filter((id) => (available[id] ?? 0) > 0);
}

export function toggleParty(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((p) => p !== id) : [...selected, id];
}
