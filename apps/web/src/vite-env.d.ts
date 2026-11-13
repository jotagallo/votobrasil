/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ID público do site no Umami; vazio desativa a análise de audiência. */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  /** URL do script do Umami (padrão: Umami Cloud). */
  readonly VITE_UMAMI_SRC?: string;
  /** Origem pública do site (usada em canonical, hreflang e Open Graph). */
  readonly VITE_SITE_URL?: string;
  /** URL do repositório de código aberto. */
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
