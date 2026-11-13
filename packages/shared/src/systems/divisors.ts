export type AveragesMethod = 'dhondt' | 'sainte-lague';

function divisor(method: AveragesMethod, seats: number): number {
  return method === 'dhondt' ? seats + 1 : 2 * seats + 1;
}

/**
 * Método das maiores médias. `initial` permite partir de cadeiras já conquistadas
 * (usado na compensação dos sistemas mistos e nas sobras eleitorais).
 * Empates: maior votação total e, depois, menor índice (determinístico).
 * `eligible` limita quem ainda pode receber cadeiras.
 */
export function highestAverages(
  votes: readonly number[],
  seats: number,
  options: {
    method?: AveragesMethod;
    initial?: readonly number[];
    eligible?: (index: number, current: readonly number[]) => boolean;
  } = {},
): number[] {
  const method = options.method ?? 'dhondt';
  const alloc = votes.map((_, i) => options.initial?.[i] ?? 0);
  for (let n = 0; n < seats; n++) {
    let best = -1;
    for (let i = 0; i < votes.length; i++) {
      const vi = votes[i] ?? 0;
      if (vi <= 0) continue;
      if (options.eligible && !options.eligible(i, alloc)) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const vb = votes[best] ?? 0;
      // vi/di > vb/db  <=>  vi*db > vb*di (aritmética inteira exata)
      const left = vi * divisor(method, alloc[best] ?? 0);
      const right = vb * divisor(method, alloc[i] ?? 0);
      if (left > right || (left === right && vi > vb)) best = i;
    }
    if (best === -1) break;
    alloc[best] = (alloc[best] ?? 0) + 1;
  }
  return alloc;
}

/** Quociente eleitoral (CE art. 106): fração igual ou inferior a 0,5 é desprezada; maior que 0,5 vale 1. */
export function electoralQuotient(validVotes: number, seats: number): number {
  if (seats <= 0) return 0;
  const q = validVotes / seats;
  const base = Math.floor(q);
  return q - base > 0.5 ? base + 1 : base;
}
