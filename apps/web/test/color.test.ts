import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextColor, relativeLuminance } from '../src/lib/color';
import { OTHERS_COLOR, PARTY_PALETTE } from '../src/lib/parties';

const PAPER = '#F2F6FB';

/** Distância euclidiana no espaço OKLab (≈ diferença perceptual). */
function oklabDistance(a: string, b: string): number {
  const toLab = (hex: string): number[] => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [toLab(a), toLab(b)] as [number[], number[]];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

describe('contraste (WCAG)', () => {
  it('luminância de preto e branco', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
  });

  it('razão de contraste preto × branco é 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 4);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 4);
  });

  it('escolhe texto claro sobre fundos escuros e escuro sobre fundos claros', () => {
    expect(readableTextColor('#002776')).toBe('#FFFFFF');
    expect(readableTextColor('#FFDF00')).toBe('#0B1633');
  });

  it('cores inválidas não quebram', () => {
    expect(relativeLuminance('azul')).toBe(0.5);
  });
});

describe('paleta de partidos', () => {
  it('permite texto legível sobre cada cor (≥ 4,5:1 com branco ou com o tom escuro)', () => {
    for (const color of [...PARTY_PALETTE, OTHERS_COLOR]) {
      const text = readableTextColor(color);
      expect(contrastRatio(color, text), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cada cor da paleta é distinguível do fundo (≥ 3:1, WCAG 1.4.11)', () => {
    for (const color of [...PARTY_PALETTE, OTHERS_COLOR]) {
      expect(contrastRatio(color, PAPER), color).toBeGreaterThanOrEqual(3);
    }
  });

  it('tem 16 cores únicas e nenhum par perceptualmente próximo (inclui o cinza de "outros")', () => {
    expect(new Set(PARTY_PALETTE).size).toBe(16);
    const all = [...PARTY_PALETTE, OTHERS_COLOR];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(oklabDistance(all[i]!, all[j]!), `${all[i]} × ${all[j]}`).toBeGreaterThanOrEqual(
          0.06,
        );
      }
    }
  });

  it('não usa o vermelho de alerta nem tons próximos dele', () => {
    for (const color of PARTY_PALETTE) {
      expect(oklabDistance(color, '#C8102E'), color).toBeGreaterThan(0.12);
    }
  });
});
