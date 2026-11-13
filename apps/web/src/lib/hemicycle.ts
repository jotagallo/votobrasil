export interface SeatDot {
  x: number;
  y: number;
  /** Ângulo em radianos, de 0 (esquerda) a π (direita). */
  angle: number;
  row: number;
}

export interface HemicycleLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  dotRadius: number;
  rows: number;
  /** Cadeiras ordenadas da esquerda para a direita (blocos de partido contíguos). */
  seats: SeatDot[];
}

export interface HemicycleOptions {
  width?: number;
  innerRatio?: number;
  maxRows?: number;
  /** Raio máximo da cadeira, para poucas cadeiras não virarem círculos enormes. */
  maxDotRadius?: number;
}

/** Cadeiras por fileira, proporcionais ao raio, somando exatamente `total`. */
export function seatsPerRow(total: number, radii: readonly number[]): number[] {
  const radiusSum = radii.reduce((a, b) => a + b, 0);
  const exact = radii.map((r) => (total * r) / radiusSum);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);
  for (const { index } of order) {
    if (remaining <= 0) break;
    counts[index] = (counts[index] ?? 0) + 1;
    remaining--;
  }
  return counts;
}

interface RowPlan {
  rows: number;
  radii: number[];
  counts: number[];
  /** Menor espaçamento entre cadeiras, relativo ao raio externo (1). */
  spacing: number;
}

function planRows(total: number, rows: number, innerRatio: number): RowPlan {
  const radii = Array.from({ length: rows }, (_, i) =>
    rows === 1 ? 1 : innerRatio + ((1 - innerRatio) * i) / (rows - 1),
  );
  const counts = seatsPerRow(total, radii);
  let spacing = rows > 1 ? (1 - innerRatio) / (rows - 1) : Infinity;
  radii.forEach((r, i) => {
    const n = counts[i] ?? 0;
    if (n > 1) spacing = Math.min(spacing, (Math.PI * r) / (n - 1));
  });
  return { rows, radii, counts, spacing };
}

export function hemicycleLayout(total: number, options: HemicycleOptions = {}): HemicycleLayout {
  const width = options.width ?? 400;
  const innerRatio = options.innerRatio ?? 0.38;
  const maxRows = Math.min(options.maxRows ?? 14, Math.max(1, total));
  const maxDot = options.maxDotRadius ?? width * 0.035;

  if (total <= 0) {
    return {
      width,
      height: width / 2,
      cx: width / 2,
      cy: width / 2,
      outerRadius: width / 2,
      innerRadius: (width / 2) * innerRatio,
      dotRadius: 0,
      rows: 0,
      seats: [],
    };
  }

  // Escolhe o número de fileiras que permite as maiores cadeiras sem sobreposição.
  let best = planRows(total, 1, innerRatio);
  for (let rows = 2; rows <= maxRows; rows++) {
    const plan = planRows(total, rows, innerRatio);
    if (plan.counts.some((n) => n === 0)) continue;
    if (plan.spacing > best.spacing * 1.0001) best = plan;
  }

  const gap = 0.84;
  const spacingFraction = Number.isFinite(best.spacing) ? best.spacing : 0.5;
  // R_px = (W/2 - 1) / (1 + dot/R) com dot = gap * spacing/2 * R_px, limitado por maxDot.
  const unconstrainedR = (width / 2 - 1) / (1 + (gap * spacingFraction) / 2);
  let dotRadius = (gap * spacingFraction * unconstrainedR) / 2;
  let outerRadius = unconstrainedR;
  if (dotRadius > maxDot) {
    dotRadius = maxDot;
    outerRadius = width / 2 - 1 - dotRadius;
  }

  const cx = width / 2;
  const cy = outerRadius + dotRadius + 1;
  const seats: SeatDot[] = [];
  best.radii.forEach((r, row) => {
    const n = best.counts[row] ?? 0;
    for (let j = 0; j < n; j++) {
      const angle = n === 1 ? Math.PI / 2 : (Math.PI * j) / (n - 1);
      const radius = r * outerRadius;
      seats.push({
        x: cx - radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
        angle,
        row,
      });
    }
  });
  seats.sort((a, b) => a.angle - b.angle || a.row - b.row);

  return {
    width,
    height: cy + dotRadius + 1,
    cx,
    cy,
    outerRadius,
    innerRadius: innerRatio * outerRadius,
    dotRadius,
    rows: best.rows,
    seats,
  };
}

export interface SeatAssignment {
  id: string;
  /** Índices em `layout.seats`. */
  from: number;
  to: number;
}

/** Atribui as cadeiras (já ordenadas por ângulo) a blocos contíguos de partidos. */
export function assignSeatBlocks(
  blocks: readonly { id: string; seats: number }[],
): SeatAssignment[] {
  const out: SeatAssignment[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.seats <= 0) continue;
    out.push({ id: block.id, from: cursor, to: cursor + block.seats });
    cursor += block.seats;
  }
  return out;
}

/** Ângulo (rad) da linha que separa as cadeiras `index - 1` e `index`; usado na marca de maioria. */
export function boundaryAngle(layout: HemicycleLayout, index: number): number | null {
  const before = layout.seats[index - 1];
  const after = layout.seats[index];
  if (!before || !after) return null;
  return (before.angle + after.angle) / 2;
}
