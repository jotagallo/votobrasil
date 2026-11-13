/** Identificador do grupo que reúne os partidos menores. */
export const OTHERS_ID = '__others__';

export const OTHERS_COLOR = '#707683';

/**
 * Paleta categórica estável, sem o vermelho de alerta: 16 matizes espaçados (azul, ameixa,
 * laranja, dourado, oliva, verde-folha, verde, azul-petróleo, azul-céu, índigo, violeta, roxo,
 * magenta, marrom, ardósia e verde-água). Cada cor tem contraste ≥ 3:1 com os fundos claros do site
 * e ≥ 4,5:1 com texto branco ou azul-marinho (validado em `test/color.test.ts`).
 */
export const PARTY_PALETTE = [
  '#2563C9',
  '#D4650E',
  '#0A6B3A',
  '#A32A7E',
  '#3E92D8',
  '#A88200',
  '#7A2F9E',
  '#2FA04E',
  '#4E6590',
  '#D24FBB',
  '#0E6F7C',
  '#8A4A1B',
  '#9672E0',
  '#5E6B14',
  '#1B9A86',
  '#3B2F9E',
] as const;

/** FNV-1a de 32 bits: estável entre sessões, plataformas e idiomas. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Posições fixas na paleta para as doze maiores bancadas da Câmara dos Deputados, de modo que o
 * mesmo partido tenha a mesma cor em todas as páginas. Partidos vizinhos no hemiciclo (os maiores)
 * recebem matizes bem distintos.
 */
const PINNED_SLOTS: Readonly<Record<string, number>> = {
  PL: 0,
  PT: 3,
  UNIÃO: 5,
  PSD: 7,
  PP: 10,
  REPUBLICANOS: 6,
  MDB: 1,
  PODE: 4,
  PSB: 9,
  PSOL: 13,
  PCDOB: 11,
  PSDB: 12,
};

const RESERVED_SLOTS = new Set(Object.values(PINNED_SLOTS));

function pinnedSlot(id: string): number | undefined {
  return Object.hasOwn(PINNED_SLOTS, id) ? PINNED_SLOTS[id] : undefined;
}

/** Cor "preferida" do partido, derivada apenas do identificador. */
export function partyColor(id: string): string {
  if (id === OTHERS_ID) return OTHERS_COLOR;
  const slot = pinnedSlot(id) ?? hashString(id) % PARTY_PALETTE.length;
  return PARTY_PALETTE[slot] as string;
}

/**
 * Cores únicas para o conjunto exibido. Partidos com posição fixa mantêm sempre a mesma cor; os
 * demais partem do hash do identificador e, em colisão, avançam para a próxima cor livre,
 * preferindo as não reservadas (processados em ordem alfabética, o resultado é determinístico).
 */
export function assignPartyColors(ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<number>();
  const size = PARTY_PALETTE.length;
  const sorted = [...new Set(ids)]
    .filter((id) => id !== OTHERS_ID)
    .sort((a, b) => a.localeCompare(b));

  const rest: string[] = [];
  for (const id of sorted) {
    const slot = pinnedSlot(id);
    if (slot === undefined) {
      rest.push(id);
      continue;
    }
    used.add(slot);
    out[id] = PARTY_PALETTE[slot] as string;
  }

  for (const id of rest) {
    const start = hashString(id) % size;
    const order = Array.from({ length: size }, (_, i) => (start + i) % size);
    const slot =
      order.find((s) => !used.has(s) && !RESERVED_SLOTS.has(s)) ??
      order.find((s) => !used.has(s)) ??
      start;
    used.add(slot);
    out[id] = PARTY_PALETTE[slot] as string;
  }
  out[OTHERS_ID] = OTHERS_COLOR;
  return out;
}

export type SeatMap = Record<string, number>;

/** Ordena partidos por maior bancada entre os dois cenários (empate: cenário, depois nome). */
export function rankParties(a: SeatMap, b: SeatMap): string[] {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids]
    .filter((id) => (a[id] ?? 0) > 0 || (b[id] ?? 0) > 0)
    .sort(
      (x, y) =>
        Math.max(b[y] ?? 0, a[y] ?? 0) - Math.max(b[x] ?? 0, a[x] ?? 0) ||
        (b[y] ?? 0) - (b[x] ?? 0) ||
        x.localeCompare(y),
    );
}

export interface PartyGroups {
  shown: string[];
  others: string[];
}

/** Mantém os `max` maiores partidos e agrupa o restante em "outros" (só se sobrar mais de um). */
export function groupParties(a: SeatMap, b: SeatMap, max = 10): PartyGroups {
  const ranked = rankParties(a, b);
  if (ranked.length <= max + 1) return { shown: ranked, others: [] };
  return { shown: ranked.slice(0, max), others: ranked.slice(max) };
}

/** Funde os partidos fora de `shown` em `OTHERS_ID`. */
export function collapseSeats(seats: SeatMap, groups: PartyGroups): SeatMap {
  const out: SeatMap = {};
  let others = 0;
  for (const [id, n] of Object.entries(seats)) {
    if (n <= 0) continue;
    if (groups.others.includes(id)) others += n;
    else out[id] = n;
  }
  if (others > 0) out[OTHERS_ID] = others;
  return out;
}

export interface SeatBlock {
  id: string;
  seats: number;
}

/** Blocos em ordem decrescente de bancada; "outros" sempre por último. */
export function seatBlocks(seats: SeatMap): SeatBlock[] {
  return Object.entries(seats)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, seats: n }))
    .sort((x, y) => {
      if (x.id === OTHERS_ID) return 1;
      if (y.id === OTHERS_ID) return -1;
      return y.seats - x.seats || x.id.localeCompare(y.id);
    });
}

/** Cadeiras que mudam de partido: soma dos ganhos líquidos por partido. */
export function seatsChanged(baseline: SeatMap, scenario: SeatMap): number {
  const ids = new Set([...Object.keys(baseline), ...Object.keys(scenario)]);
  let gained = 0;
  for (const id of ids) gained += Math.max(0, (scenario[id] ?? 0) - (baseline[id] ?? 0));
  return gained;
}

/** Partido de maior bancada; empate resolvido por nome, para não depender da ordem das chaves. */
export function leadingParty(seats: SeatMap): string | null {
  let best: string | null = null;
  for (const [id, n] of Object.entries(seats)) {
    if (n <= 0) continue;
    if (
      best === null ||
      n > (seats[best] ?? 0) ||
      (n === seats[best] && id.localeCompare(best) < 0)
    ) {
      best = id;
    }
  }
  return best;
}

export function sumSeats(seats: SeatMap): number {
  return Object.values(seats).reduce((a, b) => a + b, 0);
}
