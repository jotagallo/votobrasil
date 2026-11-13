import { describe, expect, it } from 'vitest';
import { translate } from '@votobr/shared';
import { mixedExample, proportionalExample } from '../src/lib/examples';
import { formatInt } from '../src/lib/format';

describe('exemplo proporcional (quociente eleitoral e sobras)', () => {
  const example = proportionalExample();

  it('calcula quociente, cadeiras diretas e sobras', () => {
    expect(example.totalVotes).toBe(230000);
    expect(example.quotient).toBe(28750);
    expect(example.direct).toEqual([3, 2, 1, 0]);
    expect(example.leftover).toBe(2);
  });

  it('distribui as sobras por D’Hondt e coincide com D’Hondt direto neste exemplo', () => {
    expect(example.final).toEqual([4, 3, 1, 0]);
    expect(example.dhondt).toEqual(example.final);
    expect(example.final.reduce((a, b) => a + b, 0)).toBe(example.seats);
  });
});

describe('exemplo distrital misto (PEC 2/2025)', () => {
  const example = mixedExample();

  it('metade das cadeiras em distritos e total proporcional aos votos de lista', () => {
    expect(example.districtSeats).toBe(5);
    expect(example.entitled).toEqual([4, 4, 2]);
    expect(example.fromList).toEqual([1, 2, 2]);
    expect(example.final).toEqual(example.entitled);
    expect(example.overhang).toBe(0);
  });

  it('vitórias distritais além do direito proporcional viram cadeiras excedentes', () => {
    const over = mixedExample([5, 0, 0]);
    expect(over.final).toEqual([5, 4, 2]);
    expect(over.overhang).toBe(1);
  });
});

describe('textos explicativos × exemplos calculados', () => {
  const proportional = proportionalExample();
  const mixed = mixedExample();

  for (const locale of ['pt-BR', 'en', 'es'] as const) {
    it(`${locale}: os números literais das notas coincidem com o cálculo`, () => {
      const note = translate(locale, 'systems.examples.proportional.note');
      const averages = [25000, 80000 / 3, 15000, 20000, 25000, 20000, 15000, 20000].map((v) =>
        formatInt(v, locale),
      );
      for (const value of averages) expect(note).toContain(value);
      const conjunction = { 'pt-BR': 'e', en: 'and', es: 'y' }[locale];
      const head = proportional.final.slice(0, -1).join(', ');
      expect(note).toContain(`(${head} ${conjunction} ${proportional.final.at(-1)})`);

      const mixedNote = translate(locale, 'systems.examples.mixed.note');
      expect(mixedNote).toContain(
        `A ${mixed.entitled[0]}, B ${mixed.entitled[1]}, C ${mixed.entitled[2]}`,
      );
      expect(mixedNote).toContain(`${mixed.seats}`);
    });
  }
});
