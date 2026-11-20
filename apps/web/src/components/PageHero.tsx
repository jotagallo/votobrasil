import type { ReactNode } from 'react';

/**
 * Faixa de abertura das páginas internas, de largura total: fundo escuro (páginas de conteúdo)
 * ou claro (ferramentas), com malha de gradiente e grade decorativa só em CSS.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  tone = 'dark',
  before,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  tone?: 'dark' | 'light';
  /** Conteúdo acima do sobretítulo (ex.: trilha de navegação). */
  before?: ReactNode;
  /** Conteúdo abaixo do título (ex.: fatos e ferramentas). */
  children?: ReactNode;
}) {
  return (
    <header className={`page-hero page-hero--${tone}`}>
      <div className="container page-hero__inner">
        {before}
        {eyebrow ? <p className="eyebrow eyebrow--pill">{eyebrow}</p> : null}
        <h1 className="page-hero__title">{title}</h1>
        {lede ? <p className="page-hero__lede">{lede}</p> : null}
        {children}
      </div>
    </header>
  );
}
