/**
 * Estatísticas de audiência (Google Analytics 4), isoladas neste módulo. O aviso de cookies aparece
 * para todo visitante até o "Entendi". A medição só é carregada depois do clique, se
 * `VITE_GA_MEASUREMENT_ID` estiver definido e o visitante não tiver pedido privacidade (DNT/GPC):
 * antes disso, nenhum script externo é baixado e nenhum cookie é criado. O registro de que o aviso
 * foi visto fica no `localStorage`.
 * Nunca enviamos dados pessoais: apenas nomes de eventos e valores categóricos (sistema, UF, idioma).
 */

export type AnalyticsEvent =
  'system_change' | 'area_change' | 'language_change' | 'share_click' | 'coalition_toggle';

export type EventData = Record<string, string | number | boolean>;

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,}$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    doNotTrack?: string;
    globalPrivacyControl?: boolean;
  }
}

/** Origens que a CSP do servidor precisa liberar (valores padrão de `apps/api/src/config.ts`). */
export const ANALYTICS_CSP = {
  scriptSrc: ['https://*.googletagmanager.com'],
  connectSrc: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
  ],
  imgSrc: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
} as const;

/** Devolve o ID de medição (`G-XXXXXXXXXX`) em formato válido, ou `null`. */
export function parseMeasurementId(value: string | undefined): string | null {
  const id = value?.trim().toUpperCase();
  return id && MEASUREMENT_ID.test(id) ? id : null;
}

/** Só mede o domínio público do site: acessos locais e de pré-visualização ficam de fora. */
export function hostAllowed(hostname: string, siteUrl: string | undefined): boolean {
  const configured = siteUrl?.trim();
  if (!configured) return true;
  try {
    return new URL(configured).hostname === hostname;
  } catch {
    return true;
  }
}

export function privacyOptOut(
  nav: Pick<Navigator, 'doNotTrack'> & { globalPrivacyControl?: boolean } = navigator,
): boolean {
  const dnt = nav.doNotTrack ?? (typeof window !== 'undefined' ? window.doNotTrack : undefined);
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}

export const CONSENT_KEY = 'votobr:cookie-notice';

type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): NoticeStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** O visitante já clicou em "Entendi"? */
export function cookiesAcknowledged(storage: NoticeStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

/** A medição pode rodar: ID configurado, domínio do site e sem pedido de privacidade do navegador. */
export function analyticsConfigured(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    parseMeasurementId(import.meta.env.VITE_GA_MEASUREMENT_ID) !== null &&
    hostAllowed(window.location.hostname, import.meta.env.VITE_SITE_URL) &&
    !privacyOptOut()
  );
}

/** O aviso de cookies aparece até o visitante clicar em "Entendi". */
export function cookieNoticePending(storage: NoticeStorage | null = defaultStorage()): boolean {
  return !cookiesAcknowledged(storage);
}

let enabled = false;
let injected = false;

/** O `gtag.js` exige o objeto `arguments` (e não um array) na `dataLayer`. */
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  (window.dataLayer ??= []).push(arguments);
}

/** Inicia a medição somente se o visitante já tiver clicado em "Entendi". */
export function initAnalytics(): void {
  if (cookiesAcknowledged()) startAnalytics();
}

/** Registra o "Entendi" (guardado no navegador) e inicia a medição. */
export function acknowledgeCookies(storage: NoticeStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(CONSENT_KEY, '1');
  } catch {
    /* armazenamento indisponível: o aviso vale só para esta visita */
  }
  startAnalytics();
  if (enabled) trackPageview(window.location.pathname);
}

function startAnalytics(): void {
  if (typeof document === 'undefined' || enabled) return;
  const id = parseMeasurementId(import.meta.env.VITE_GA_MEASUREMENT_ID);
  if (!id || !analyticsConfigured()) return;

  window.gtag = gtag;
  gtag('js', new Date());
  // As visualizações de página são enviadas à mão: a navegação do SPA não recarrega a página.
  gtag('config', id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  enabled = true;
  if (injected) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(id)}`;
  script.addEventListener('error', () => {
    enabled = false;
    injected = false;
    script.remove();
  });
  injected = true;
  document.head.appendChild(script);
}

export function analyticsEnabled(): boolean {
  return enabled;
}

/** Visualização de página em navegação SPA (somente o caminho; estado fica fora da URL enviada). */
export function trackPageview(path: string): void {
  if (!enabled) return;
  window.gtag?.('event', 'page_view', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
  });
}

export function trackEvent(name: AnalyticsEvent, data?: EventData): void {
  if (!enabled) return;
  window.gtag?.('event', name, data);
}
