import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { LOCALES, type Locale } from '@votobr/shared';
import { analyticsConfigured, readConsent, trackEvent } from '../analytics';
import { useLocale, useT } from '../i18n';
import { PATHS, housePath, withLocale } from '../lib/routes';
import { ConsentBanner } from './ConsentBanner';

const LANGUAGE_LABEL: Record<Locale, string> = { 'pt-BR': 'PT', en: 'EN', es: 'ES' };

const AUTHOR_LINKS = [
  { href: 'https://instagram.com/jotagallo', label: 'João Otávio Gallo' },
  { href: 'https://jotagallo.dev', label: 'JOTAGALLO' },
] as const;

function BrandMark({ className = 'brand__mark' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 52"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 26.5 8.8-16.4q.8-1.5 2.6-2l8.6-2.4q1.5-.4 3.1-.1l37.6 6q2.4.4 2.1 2.9l-2.1 15q-.2 1.8-1.5 3.2L51.4 45.5q-2 2-4.6 1L6.1 31.2q-2.8-1.1-1.1-4.7Z" />
      <path d="m15 8.5 43.8 8.4q2.9.6 1.8 3.2L49 46.9M61.2 18l6.1-5.3" />
      <path d="m20 14.2 13.6 2.9q2.5.5 1.3 2.9l-6.4 12.7q-1.1 2.3-3.4 1.4l-12.7-4.9q-2.3-.9-1.1-3.2l5.4-10.2q1-2.1 3.3-1.6Z" />
      <image
        href="/favicon.svg"
        width="32"
        height="32"
        transform="matrix(.52 .11 -.23 .52 40.5 19)"
      />
    </svg>
  );
}

function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useT();
  const locale = useLocale();
  const [path] = useLocation();
  const search = useSearch();
  const query = search ? `?${search}` : '';
  return (
    <nav className={className} aria-label={t('lang.label')}>
      <ul className="lang">
        {LOCALES.map((code) => (
          <li key={code}>
            <Link
              href={`~${withLocale(code, path)}${query}`}
              hrefLang={code}
              lang={code}
              aria-current={code === locale ? 'true' : undefined}
              aria-label={t(`lang.names.${code}`)}
              className={code === locale ? 'lang__link is-active' : 'lang__link'}
              onClick={() => {
                if (code !== locale) trackEvent('language_change', { to: code });
              }}
            >
              {LANGUAGE_LABEL[code]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavLink({
  href,
  children,
  exact = false,
  alsoUnder,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  alsoUnder?: string;
}) {
  const [path] = useLocation();
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  const active = (exact ? path === href : under(href)) || (alsoUnder ? under(alsoUnder) : false);
  return (
    <Link
      href={href}
      className={active ? 'nav__link is-active' : 'nav__link'}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const repoUrl = import.meta.env.VITE_REPO_URL?.trim();
  const [consentAsked] = useState(analyticsConfigured);
  const [consentOpen, setConsentOpen] = useState(() => consentAsked && readConsent() === null);

  // Troca de rota: fecha o menu, volta ao topo e move o foco para o conteúdo (leitores de tela).
  useEffect(() => {
    setMenuOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [path]);

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo" onClick={() => mainRef.current?.focus()}>
        {t('app.skip')}
      </a>
      <header className="site-header">
        <div className="container site-header__row">
          <Link href={PATHS.home} className="brand" aria-label={t('app.homeLabel')}>
            <BrandMark />
            <span className="brand__name wordmark" aria-hidden="true">
              Voto<span>Brasil</span>
            </span>
          </Link>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="menu-toggle__icon" aria-hidden="true" />
            {menuOpen ? t('nav.close') : t('nav.menu')}
          </button>
          <div id={menuId} className={menuOpen ? 'site-header__menu is-open' : 'site-header__menu'}>
            <nav aria-label={t('nav.main')} className="nav nav--utility">
              <NavLink href={PATHS.systems}>{t('nav.systems')}</NavLink>
              <NavLink href={PATHS.methodology}>{t('nav.methodology')}</NavLink>
              <NavLink href={PATHS.semipresidentialism}>{t('nav.semipresidentialism')}</NavLink>
              <NavLink href={PATHS.about}>{t('nav.about')}</NavLink>
            </nav>
            <LanguageSwitcher />
            <Link href={housePath('federal')} className="btn btn--sm header-cta">
              {t('nav.simulate')}
            </Link>
          </div>
        </div>
        <div className="houses-bar">
          <nav className="container houses-bar__row" aria-label={t('nav.houses')}>
            <NavLink href={PATHS.home} exact alsoUnder={housePath('federal')}>
              {t('houses.federal.short')}
            </NavLink>
            <NavLink href={housePath('state')}>{t('houses.state.short')}</NavLink>
            <NavLink href={housePath('municipal')}>{t('houses.municipal.short')}</NavLink>
          </nav>
        </div>
      </header>

      <main id="conteudo" ref={mainRef} tabIndex={-1} className="main">
        {children}
      </main>

      <footer className="site-footer">
        <div className="container site-footer__grid">
          <div>
            <p className="site-footer__brand">
              <BrandMark className="site-footer__mark" />
              <span className="wordmark">
                Voto<span>Brasil</span>
              </span>
            </p>
            <p className="site-footer__note">{t('footer.disclaimer')}</p>
          </div>
          <nav aria-label={t('footer.links')}>
            <ul className="site-footer__links">
              <li>
                <Link href={PATHS.methodology}>{t('nav.methodology')}</Link>
              </li>
              <li>
                <Link href={PATHS.systems}>{t('nav.systems')}</Link>
              </li>
              <li>
                <Link href={PATHS.about}>{t('nav.about')}</Link>
              </li>
              {consentAsked ? (
                <li>
                  <button
                    type="button"
                    className="site-footer__button"
                    onClick={() => setConsentOpen(true)}
                  >
                    {t('consent.manage')}
                  </button>
                </li>
              ) : null}
              {repoUrl ? (
                <li>
                  <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                    {t('footer.source')}
                  </a>
                </li>
              ) : null}
            </ul>
          </nav>
          <div>
            <LanguageSwitcher className="lang-footer" />
            <p className="site-footer__note">{t('footer.data')}</p>
          </div>
        </div>
        <div className="site-footer__bar">
          <div className="container site-footer__signature">
            <p className="site-footer__credit">
              <span>{t('footer.credit')}</span>
              <span className="site-footer__authors">
                {AUTHOR_LINKS.map((author, index) => (
                  <span key={author.href} className="site-footer__credit-item">
                    {index > 0 ? <span aria-hidden="true">•</span> : null}
                    <a href={author.href} target="_blank" rel="noopener noreferrer">
                      {author.label}
                    </a>
                  </span>
                ))}
              </span>
            </p>
            <a
              href="https://github.com/jotagallo/votobrasil"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--glass btn--sm"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16" />
              </svg>
              {t('footer.openSource')}
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </footer>
      {consentOpen ? <ConsentBanner onClose={() => setConsentOpen(false)} /> : null}
    </div>
  );
}
