/** Gerador pseudoaleatório determinístico (mulberry32) e utilitários. */
export type Rng = () => number;

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts: Array<string | number>): Rng {
  return mulberry32(hashSeed(parts.join('|')));
}

/** Normal padrão (Box–Muller). */
export function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/** Índice sorteado proporcionalmente aos pesos (`cumulative` = somas acumuladas). */
export function weightedIndex(rng: Rng, cumulative: readonly number[]): number {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const target = rng() * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function cumulativeSums(weights: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    out.push(acc);
  }
  return out;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
