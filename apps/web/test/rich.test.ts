import { describe, expect, it } from 'vitest';
import { parseRich } from '../src/lib/rich';

describe('parseRich', () => {
  it('devolve um nó de texto para texto simples', () => {
    expect(parseRich('texto simples')).toEqual([{ type: 'text', value: 'texto simples' }]);
    expect(parseRich('')).toEqual([]);
  });

  it('reconhece negrito, código e links internos e externos', () => {
    expect(parseRich('a **b** `c` [d](/sistemas) e [f](https://exemplo.org/x?y=1)')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', value: 'b' },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'c' },
      { type: 'text', value: ' ' },
      { type: 'link', label: 'd', href: '/sistemas', external: false },
      { type: 'text', value: ' e ' },
      { type: 'link', label: 'f', href: 'https://exemplo.org/x?y=1', external: true },
    ]);
  });

  it('aceita mailto e rejeita esquemas perigosos, http simples e URLs relativas ao protocolo', () => {
    const nodes = parseRich(
      '[a](mailto:oi@exemplo.org) [b](javascript:alert) [c](http://exemplo.org) [d](//evil.example) [e](data:text/html,x)',
    );
    const links = nodes.filter((n) => n.type === 'link');
    expect(links).toEqual([
      { type: 'link', label: 'a', href: 'mailto:oi@exemplo.org', external: true },
    ]);
    expect(nodes.some((n) => n.type === 'text' && n.value.includes('javascript:alert'))).toBe(true);
  });

  it('não interpreta HTML: tags permanecem como texto', () => {
    expect(parseRich('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', value: '<img src=x onerror=alert(1)>' },
    ]);
  });
});
