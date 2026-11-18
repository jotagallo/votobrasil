/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ID de medição público (`G-XXXXXXXXXX`); vazio desativa as estatísticas (o aviso de cookies continua). */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** Origem pública do site (usada em canonical, hreflang e Open Graph). */
  readonly VITE_SITE_URL?: string;
  /** URL do repositório de código aberto. */
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
