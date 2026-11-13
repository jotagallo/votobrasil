import { describe, expect, it } from 'vitest';
import { decodeState, DEFAULT_STATE, encodeState, patchSearch } from '../src/lib/urlState';

describe('decodeState', () => {
  it('devolve o padrão para query vazia', () => {
    expect(decodeState('')).toEqual(DEFAULT_STATE);
    expect(decodeState('?')).toEqual(DEFAULT_STATE);
  });

  it('lê sistema, modo do mapa e coalizão', () => {
    const state = decodeState('?sistema=distrital-misto&mapa=mudanca&coalizao=PT,PL,PSD');
    expect(state).toEqual({
      system: 'distrital-misto',
      mapMode: 'change',
      coalition: ['PT', 'PL', 'PSD'],
    });
  });

  it('ignora sistema inválido e valores fora do domínio', () => {
    expect(decodeState('?sistema=inexistente').system).toBe(DEFAULT_STATE.system);
    expect(decodeState('?mapa=qualquer').mapMode).toBe('leader');
  });

  it('links antigos dos dois modelos mistos abrem o distrital misto da PEC', () => {
    expect(decodeState('?sistema=misto-paralelo&distritos=0.4').system).toBe('distrital-misto');
    expect(decodeState('?sistema=misto-compensatorio').system).toBe('distrital-misto');
  });

  it('remove duplicatas e identificadores de partido suspeitos da coalizão', () => {
    const state = decodeState(
      `?coalizao=${encodeURIComponent('PT,PT,<script>alert(1)</script>,PC do B,,Solidariedade')}`,
    );
    expect(state.coalition).toEqual(['PT', 'PC do B', 'Solidariedade']);
  });

  it('aceita URLSearchParams', () => {
    expect(decodeState(new URLSearchParams({ sistema: 'distritao' })).system).toBe('distritao');
  });
});

describe('encodeState', () => {
  it('escreve o sistema explicitamente', () => {
    expect(encodeState({ system: 'distrital-misto' })).toBe('?sistema=distrital-misto');
  });

  it('omite o modo de mapa padrão e escreve coalizão com vírgulas literais', () => {
    expect(encodeState({ system: 'atual', mapMode: 'leader' })).toBe('?sistema=atual');
    expect(encodeState({ system: 'atual', mapMode: 'change', coalition: ['PT', 'PL'] })).toBe(
      '?sistema=atual&mapa=mudanca&coalizao=PT,PL',
    );
  });

  it('devolve string vazia quando não há nada a escrever', () => {
    expect(encodeState({})).toBe('');
  });

  it('faz ida e volta sem perder informação', () => {
    const state = {
      system: 'distrital-misto' as const,
      mapMode: 'change' as const,
      coalition: ['PT', 'PC do B', 'União'],
    };
    expect(decodeState(encodeState(state))).toEqual(state);
  });
});

describe('patchSearch', () => {
  it('aplica o patch preservando parâmetros desconhecidos', () => {
    expect(patchSearch('?foo=1&sistema=atual', { system: 'distritao' })).toBe(
      '?sistema=distritao&foo=1',
    );
  });

  it('preserva o estado já presente na query', () => {
    const next = patchSearch('?sistema=distrital-puro', { mapMode: 'change' });
    expect(decodeState(next)).toMatchObject({ system: 'distrital-puro', mapMode: 'change' });
  });

  it('descarta o parâmetro legado da fração distrital', () => {
    expect(patchSearch('?sistema=misto-paralelo&distritos=0.6', { mapMode: 'change' })).toBe(
      '?sistema=distrital-misto&mapa=mudanca',
    );
  });

  it('funciona a partir de uma query vazia', () => {
    expect(patchSearch('', { system: 'lista-fechada' })).toBe('?sistema=lista-fechada');
  });
});
