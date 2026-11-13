import { describe, expect, it } from 'vitest';
import {
  coalitionSeats,
  coalitionStatus,
  largestPartiesForMajority,
  majorityOf,
  sanitizeCoalition,
  toggleParty,
} from '../src/lib/coalition';

describe('majorityOf', () => {
  it('é ⌊S/2⌋ + 1', () => {
    expect(majorityOf(513)).toBe(257);
    expect(majorityOf(512)).toBe(257);
    expect(majorityOf(1024)).toBe(513);
    expect(majorityOf(81)).toBe(41);
    expect(majorityOf(1)).toBe(1);
  });
});

describe('coalitionStatus', () => {
  const seats = { A: 100, B: 90, C: 80, D: 70 };

  it('soma só partidos existentes e sem duplicatas', () => {
    expect(coalitionSeats(seats, ['A', 'A', 'X', 'C'])).toBe(180);
  });

  it('indica quanto falta quando a maioria não é atingida', () => {
    expect(coalitionStatus(seats, ['A', 'C'], 171)).toEqual({
      total: 180,
      majority: 171,
      hasMajority: true,
      missing: 0,
      surplus: 9,
    });
    expect(coalitionStatus(seats, ['D'], 171)).toEqual({
      total: 70,
      majority: 171,
      hasMajority: false,
      missing: 101,
      surplus: 0,
    });
  });

  it('atinge exatamente a maioria', () => {
    const status = coalitionStatus({ A: 100, B: 71 }, ['A', 'B'], 171);
    expect(status.hasMajority).toBe(true);
    expect(status.surplus).toBe(0);
    expect(status.missing).toBe(0);
  });

  it('coalizão vazia não tem cadeiras', () => {
    expect(coalitionStatus(seats, [], 171).total).toBe(0);
  });
});

describe('largestPartiesForMajority', () => {
  it('toma as maiores bancadas até atingir a maioria', () => {
    expect(largestPartiesForMajority({ A: 150, B: 120, C: 100, D: 80, E: 63 }, 257)).toEqual([
      'A',
      'B',
    ]);
  });

  it('desempata por nome e conta três partidos quando necessário', () => {
    expect(largestPartiesForMajority({ D: 50, C: 50, B: 50, A: 50 }, 101)).toEqual(['A', 'B', 'C']);
  });

  it('ignora partidos sem cadeiras e devolve todos se a maioria for inalcançável', () => {
    expect(largestPartiesForMajority({ A: 10, B: 0 }, 100)).toEqual(['A']);
  });
});

describe('sanitizeCoalition / toggleParty', () => {
  it('mantém só partidos com cadeiras, sem duplicatas, na ordem recebida', () => {
    expect(sanitizeCoalition(['PT', 'X', 'PL', 'PT'], { PT: 10, PL: 5, X: 0 })).toEqual([
      'PT',
      'PL',
    ]);
  });

  it('alterna a presença de um partido sem alterar o original', () => {
    const original = ['A', 'B'];
    expect(toggleParty(original, 'C')).toEqual(['A', 'B', 'C']);
    expect(toggleParty(original, 'A')).toEqual(['B']);
    expect(original).toEqual(['A', 'B']);
  });
});
