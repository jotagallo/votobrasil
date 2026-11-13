import { describe, expect, it } from 'vitest';
import {
  assignSeatBlocks,
  boundaryAngle,
  hemicycleLayout,
  seatsPerRow,
} from '../src/lib/hemicycle';

describe('seatsPerRow', () => {
  it('soma exatamente o total e cresce com o raio', () => {
    const radii = [0.4, 0.55, 0.7, 0.85, 1];
    for (const total of [5, 81, 513, 1024]) {
      const counts = seatsPerRow(total, radii);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i] as number).toBeGreaterThanOrEqual((counts[i - 1] as number) - 1);
      }
    }
  });
});

describe('hemicycleLayout', () => {
  it.each([1, 2, 7, 8, 24, 81, 513, 1024])(
    'posiciona exatamente %i cadeiras dentro do SVG',
    (total) => {
      const layout = hemicycleLayout(total, { width: 400 });
      expect(layout.seats).toHaveLength(total);
      expect(layout.dotRadius).toBeGreaterThan(0);
      for (const seat of layout.seats) {
        expect(seat.x - layout.dotRadius).toBeGreaterThanOrEqual(-1e-6);
        expect(seat.x + layout.dotRadius).toBeLessThanOrEqual(layout.width + 1e-6);
        expect(seat.y - layout.dotRadius).toBeGreaterThanOrEqual(-1e-6);
        expect(seat.y + layout.dotRadius).toBeLessThanOrEqual(layout.height + 1e-6);
      }
    },
  );

  it('ordena as cadeiras da esquerda para a direita (ângulo não decrescente)', () => {
    const { seats } = hemicycleLayout(513);
    for (let i = 1; i < seats.length; i++) {
      expect((seats[i] as { angle: number }).angle).toBeGreaterThanOrEqual(
        (seats[i - 1] as { angle: number }).angle,
      );
    }
    expect(seats[0]?.angle).toBeCloseTo(0, 6);
    expect(seats[seats.length - 1]?.angle).toBeCloseTo(Math.PI, 6);
  });

  it('não sobrepõe cadeiras em câmaras grandes', () => {
    const layout = hemicycleLayout(513, { width: 600 });
    let min = Infinity;
    for (let i = 0; i < layout.seats.length; i++) {
      for (let j = i + 1; j < layout.seats.length; j++) {
        const a = layout.seats[i] as { x: number; y: number };
        const b = layout.seats[j] as { x: number; y: number };
        min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(min).toBeGreaterThan(2 * layout.dotRadius);
  });

  it('é determinístico', () => {
    expect(hemicycleLayout(81)).toEqual(hemicycleLayout(81));
  });

  it('devolve layout vazio para zero cadeiras', () => {
    const layout = hemicycleLayout(0);
    expect(layout.seats).toEqual([]);
    expect(layout.rows).toBe(0);
  });

  it('limita o raio da cadeira em câmaras pequenas', () => {
    const layout = hemicycleLayout(3, { width: 400, maxDotRadius: 10 });
    expect(layout.dotRadius).toBeLessThanOrEqual(10);
  });
});

describe('assignSeatBlocks / boundaryAngle', () => {
  it('cria faixas contíguas e ignora blocos vazios', () => {
    expect(
      assignSeatBlocks([
        { id: 'A', seats: 3 },
        { id: 'B', seats: 0 },
        { id: 'C', seats: 2 },
      ]),
    ).toEqual([
      { id: 'A', from: 0, to: 3 },
      { id: 'C', from: 3, to: 5 },
    ]);
  });

  it('calcula o ângulo entre duas cadeiras e rejeita índices fora do intervalo', () => {
    const layout = hemicycleLayout(81);
    const angle = boundaryAngle(layout, 41);
    expect(angle).not.toBeNull();
    expect(angle as number).toBeGreaterThan(0);
    expect(angle as number).toBeLessThan(Math.PI);
    expect(boundaryAngle(layout, 0)).toBeNull();
    expect(boundaryAngle(layout, 81)).toBeNull();
  });
});
