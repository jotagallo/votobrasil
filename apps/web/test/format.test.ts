import { describe, expect, it } from 'vitest';
import {
  createFormatters,
  formatBytes,
  formatDecimal,
  formatInt,
  formatPercent,
  formatShare,
  formatSigned,
  MINUS,
} from '../src/lib/format';

const plain = (text: string): string => text.replace(/\s/g, '');

describe('formatInt', () => {
  it('usa o separador de milhar de cada idioma, inclusive em es com 4 dígitos', () => {
    expect(formatInt(1234567, 'pt-BR')).toBe('1.234.567');
    expect(formatInt(1234567, 'en')).toBe('1,234,567');
    expect(formatInt(1234567, 'es')).toBe('1.234.567');
    expect(formatInt(1234, 'es')).toBe('1.234');
  });
});

describe('formatDecimal', () => {
  it('usa vírgula ou ponto conforme o idioma', () => {
    expect(formatDecimal(12.345, 'pt-BR', 1)).toBe('12,3');
    expect(formatDecimal(12.345, 'en', 1)).toBe('12.3');
    expect(formatDecimal(12, 'es', 2)).toBe('12,00');
  });
});

describe('formatPercent / formatShare', () => {
  it('recebe pontos percentuais', () => {
    expect(plain(formatPercent(12.34, 'pt-BR'))).toBe('12,3%');
    expect(plain(formatPercent(12.34, 'en'))).toBe('12.3%');
    expect(plain(formatPercent(12.34, 'es'))).toBe('12,3%');
  });

  it('formatShare recebe fração de 0 a 1', () => {
    expect(plain(formatShare(0.5, 'en'))).toBe('50%');
    expect(plain(formatShare(0.355, 'pt-BR', 1))).toBe('35,5%');
  });
});

describe('formatSigned', () => {
  it('mostra sinal explícito, com sinal de menos tipográfico', () => {
    expect(formatSigned(5, 'pt-BR')).toBe('+5');
    expect(formatSigned(-5, 'pt-BR')).toBe(`${MINUS}5`);
    expect(formatSigned(-1234, 'en')).toBe(`${MINUS}1,234`);
  });

  it('não mostra sinal para zero nem para valores que arredondam para zero', () => {
    expect(formatSigned(0, 'en')).toBe('0');
    expect(formatSigned(0.04, 'en', 1)).toBe('0.0');
    expect(formatSigned(-0.04, 'pt-BR', 1)).toBe('0,0');
  });
});

describe('formatBytes', () => {
  it('usa unidades decimais', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1_536_000, 'en')).toBe('1.5 MB');
    expect(formatBytes(1_536_000, 'pt-BR')).toBe('1,5 MB');
  });
});

describe('createFormatters', () => {
  it('encapsula o idioma', () => {
    const f = createFormatters('en');
    expect(f.int(1000)).toBe('1,000');
    expect(f.dec(1.25, 2)).toBe('1.25');
    expect(f.date('2026-10-04T12:00:00Z')).toContain('2026');
    expect(f.date('data inválida')).toBe('data inválida');
  });
});
