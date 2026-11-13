import { describe, expect, it } from 'vitest';
import {
  assignPartyColors,
  collapseSeats,
  groupParties,
  hashString,
  leadingParty,
  OTHERS_COLOR,
  OTHERS_ID,
  partyColor,
  PARTY_PALETTE,
  rankParties,
  seatBlocks,
  seatsChanged,
  sumSeats,
} from '../src/lib/parties';

const twelve = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`P${String(i + 1).padStart(2, '0')}`, 100 - i * 5]),
);

describe('hashString', () => {
  it('é FNV-1a de 32 bits (vetores conhecidos)', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
});

describe('cores de partidos', () => {
  it('partyColor é estável e pertence à paleta; outros é cinza', () => {
    expect(partyColor('PT')).toBe(partyColor('PT'));
    expect(PARTY_PALETTE).toContain(partyColor('PT'));
    expect(partyColor(OTHERS_ID)).toBe(OTHERS_COLOR);
  });

  it('partidos de bancada grande mantêm a mesma cor em qualquer conjunto exibido', () => {
    const pinned = ['PL', 'PT', 'UNIÃO', 'PSD', 'PP', 'REPUBLICANOS', 'MDB', 'PODE', 'PSB'];
    const small = assignPartyColors(['PL', 'PT', 'NOVO']);
    const large = assignPartyColors([...pinned, 'NOVO', 'PV', 'AGIR', 'DC', 'AVANTE', 'PDT']);
    for (const id of ['PL', 'PT']) {
      expect(small[id]).toBe(large[id]);
      expect(small[id]).toBe(partyColor(id));
    }
    expect(new Set(Object.values(large)).size).toBe(Object.keys(large).length);
  });

  it('assignPartyColors atribui cores únicas, independentemente da ordem de entrada', () => {
    const ids = [
      'PT',
      'PL',
      'PSD',
      'MDB',
      'União',
      'PP',
      'PSB',
      'PDT',
      'Rep',
      'PSDB',
      'PSOL',
      'Pode',
    ];
    const a = assignPartyColors(ids);
    const b = assignPartyColors([...ids].reverse());
    expect(a).toEqual(b);
    const colors = ids.map((id) => a[id]);
    expect(new Set(colors).size).toBe(ids.length);
    expect(a[OTHERS_ID]).toBe(OTHERS_COLOR);
  });
});

describe('rankParties / groupParties', () => {
  it('ordena pela maior bancada entre oficial e cenário e ignora partidos sem cadeiras', () => {
    expect(rankParties({ A: 10, B: 5, C: 0 }, { A: 6, B: 12, C: 0, D: 7 })).toEqual([
      'B',
      'A',
      'D',
    ]);
  });

  it('agrupa em "outros" os partidos além dos maiores N', () => {
    const groups = groupParties(twelve, twelve, 10);
    expect(groups.shown).toHaveLength(10);
    expect(groups.others).toEqual(['P11', 'P12']);
  });

  it('não cria grupo "outros" para um único partido restante', () => {
    const eleven = Object.fromEntries(Object.entries(twelve).slice(0, 11));
    const groups = groupParties(eleven, eleven, 10);
    expect(groups.shown).toHaveLength(11);
    expect(groups.others).toEqual([]);
  });
});

describe('collapseSeats / seatBlocks', () => {
  it('soma os partidos agrupados em __others__ preservando o total', () => {
    const groups = groupParties(twelve, twelve, 10);
    const collapsed = collapseSeats(twelve, groups);
    expect(collapsed[OTHERS_ID]).toBe((twelve.P11 as number) + (twelve.P12 as number));
    expect(sumSeats(collapsed)).toBe(sumSeats(twelve));
    expect(Object.keys(collapsed)).toHaveLength(11);
  });

  it('ordena em ordem decrescente com "outros" sempre por último', () => {
    const blocks = seatBlocks({ [OTHERS_ID]: 50, B: 10, A: 10, C: 30, Z: 0 });
    expect(blocks.map((b) => b.id)).toEqual(['C', 'A', 'B', OTHERS_ID]);
  });
});

describe('seatsChanged / leadingParty', () => {
  it('conta as cadeiras que mudam de partido (ganhos líquidos)', () => {
    expect(seatsChanged({ A: 10, B: 5 }, { A: 8, B: 7 })).toBe(2);
    expect(seatsChanged({ A: 10, B: 5 }, { A: 10, B: 5 })).toBe(0);
    expect(seatsChanged({ A: 10 }, { B: 10 })).toBe(10);
  });

  it('escolhe a maior bancada e desempata por nome', () => {
    expect(leadingParty({ B: 5, A: 9, C: 2 })).toBe('A');
    expect(leadingParty({ B: 9, A: 9 })).toBe('A');
    expect(leadingParty({ A: 0 })).toBeNull();
    expect(leadingParty({})).toBeNull();
  });
});
