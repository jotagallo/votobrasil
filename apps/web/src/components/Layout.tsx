import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { LOCALES, type Locale } from '@votobr/shared';
import { analyticsConfigured, readConsent, trackEvent } from '../analytics';
import { useLocale, useT } from '../i18n';
import { PATHS, housePath, withLocale } from '../lib/routes';
import { ConsentBanner } from './ConsentBanner';

const LANGUAGE_LABEL: Record<Locale, string> = { 'pt-BR': 'PT', en: 'EN', es: 'ES' };

/** Marca: três arcos concêntricos (um hemiciclo) sobre um quadrado arredondado. */
function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#002776" />
      <g fill="none" strokeWidth="2.6" strokeLinecap="round">
        <path d="M5.5 23.5a10.5 10.5 0 0 1 21 0" stroke="#fff" />
        <path d="M10 23.5a6 6 0 0 1 12 0" stroke="#19b35a" />
      </g>
      <circle cx="16" cy="23.5" r="1.9" fill="#ffdf00" />
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
            <span className="brand__name" aria-hidden="true">
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
              Voto<span>Brasil</span>
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
      </footer>
      {consentOpen ? <ConsentBanner onClose={() => setConsentOpen(false)} /> : null}
    </div>
  );
}
