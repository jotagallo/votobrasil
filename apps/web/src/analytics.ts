/**
 * Análise de audiência independente de provedor. Hoje usa Umami (sem cookies), carregado só se
 * `VITE_UMAMI_WEBSITE_ID` estiver definido, o visitante não tiver pedido privacidade (DNT/GPC) e
 * tiver consentido expressamente (LGPD, art. 7º, I). A escolha fica no `localStorage`.
 * Nunca enviamos dados pessoais: apenas nomes de eventos e valores categóricos (sistema, UF, idioma).
 */

export type AnalyticsEvent =
  'system_change' | 'area_change' | 'language_change' | 'share_click' | 'coalition_toggle';

export type EventData = Record<string, string | number | boolean>;

const DEFAULT_SRC = 'https://cloud.umami.is/script.js';
const UMAMI_CLOUD_HOST = 'cloud.umami.is';
const UMAMI_CLOUD_GATEWAY = 'https://gateway.umami.is';

interface UmamiApi {
  track: (
    arg?: string | ((props: Record<string, unknown>) => Record<string, unknown>),
    data?: EventData,
  ) => void;
}

declare global {
  interface Window {
    umami?: UmamiApi;
    doNotTrack?: string;
    globalPrivacyControl?: boolean;
  }
}

/** Origens que o CSP do servidor precisa liberar para o provedor configurado. */
export function analyticsCspOrigins(src: string = DEFAULT_SRC): {
  scriptSrc: string[];
  connectSrc: string[];
} {
  try {
    const url = new URL(src);
    const connect = url.hostname === UMAMI_CLOUD_HOST ? UMAMI_CLOUD_GATEWAY : url.origin;
    return { scriptSrc: [url.origin], connectSrc: [connect] };
  } catch {
    return { scriptSrc: [], connectSrc: [] };
  }
}

/** Valores padrão (Umami Cloud) para copiar na política CSP do backend. */
export const ANALYTICS_CSP = analyticsCspOrigins(DEFAULT_SRC);

export function privacyOptOut(
  nav: Pick<Navigator, 'doNotTrack'> & { globalPrivacyControl?: boolean } = navigator,
): boolean {
  const dnt = nav.doNotTrack ?? (typeof window !== 'undefined' ? window.doNotTrack : undefined);
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}

export type Consent = 'granted' | 'denied';

export const CONSENT_KEY = 'votobr:analytics-consent';

type ConsentStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ConsentStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readConsent(storage: ConsentStorage | null = defaultStorage()): Consent | null {
  try {
    const value = storage?.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

/** Há algo a consentir: analytics configurado e sem pedido de privacidade do navegador. */
export function analyticsConfigured(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean(import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim()) && !privacyOptOut();
}

let enabled = false;
let injected = false;
let loaded = false;
const queue: Array<() => void> = [];

function run(fn: () => void): void {
  if (!enabled) return;
  if (loaded && window.umami) fn();
  else if (queue.length < 50) queue.push(fn);
}

/** Inicia o analytics somente se o visitante já tiver consentido. */
export function initAnalytics(): void {
  if (readConsent() === 'granted') startAnalytics();
}

/** Registra a escolha do visitante; o consentimento pode ser revogado a qualquer momento. */
export function setConsent(consent: Consent, storage: ConsentStorage | null = defaultStorage()) {
  try {
    storage?.setItem(CONSENT_KEY, consent);
  } catch {
    /* armazenamento indisponível: a escolha vale só para esta visita */
  }
  if (consent === 'granted') {
    startAnalytics();
    if (typeof window !== 'undefined') trackPageview(window.location.pathname);
  } else {
    enabled = false;
    queue.length = 0;
  }
}

function startAnalytics(): void {
  if (typeof document === 'undefined' || enabled) return;
  if (injected) {
    enabled = true;
    return;
  }
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim();
  if (!websiteId || privacyOptOut()) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = import.meta.env.VITE_UMAMI_SRC?.trim() || DEFAULT_SRC;
  script.dataset.websiteId = websiteId;
  script.dataset.autoTrack = 'false';
  script.dataset.doNotTrack = 'true';
  script.dataset.excludeSearch = 'true';
  const siteUrl = import.meta.env.VITE_SITE_URL?.trim();
  if (siteUrl) {
    try {
      script.dataset.domains = new URL(siteUrl).hostname;
    } catch {
      /* URL inválida: sem restrição de domínio */
    }
  }
  script.addEventListener('load', () => {
    loaded = true;
    queue.splice(0).forEach((fn) => fn());
  });
  script.addEventListener('error', () => {
    enabled = false;
    injected = false;
    queue.length = 0;
  });
  enabled = true;
  injected = true;
  document.head.appendChild(script);
}

export function analyticsEnabled(): boolean {
  return enabled;
}

/** Visualização de página em navegação SPA (somente o caminho; estado fica fora da URL enviada). */
export function trackPageview(path: string): void {
  run(() => window.umami?.track((props) => ({ ...props, url: path, title: document.title })));
}

export function trackEvent(name: AnalyticsEvent, data?: EventData): void {
  run(() => window.umami?.track(name, data));
}
