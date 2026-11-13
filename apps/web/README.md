# @votobr/web

Frontend do VotoBrasil: SPA em Vite + React 19 + TypeScript estrito, com roteamento por `wouter`, mapas com `d3-geo`/`d3-delaunay`/`topojson-client` e CSS escrito à mão (sem framework de UI, sem fontes ou CDNs externos). Consome somente o contrato HTTP de `@votobr/shared` (`packages/shared/src/api.ts`).

## Desenvolvimento

```bash
npm run dev -w @votobr/web          # http://localhost:5173
```

O servidor de desenvolvimento encaminha `/api` e `/healthz` para `http://localhost:8080` (mude com `API_PROXY_TARGET`). A variável `VITE_MOCK_API` controla o mock de dados sintéticos:

| `VITE_MOCK_API` | Comportamento                                                                              |
| --------------- | ------------------------------------------------------------------------------------------ |
| `1`             | Sempre usa o mock (`VITE_MOCK_API=1 npm run dev -w @votobr/web`).                          |
| `0`             | Nunca usa o mock; só o proxy para a API real.                                              |
| vazio           | Sonda `${API_PROXY_TARGET}/healthz` (700 ms): se responder, usa a API real; senão, o mock. |

O mock (`dev/mock-api.ts` + `dev/mock/*`) é um plugin Vite que só existe em `vite serve`: não é importado pelo build de produção. Ele gera, de forma determinística (RNG com semente), datasets inventados com ≈8 partidos, e calcula as respostas com `simulate`, `officialResult`, `partyVotes`, `computeMetrics` e `mergeResults` de `@votobr/shared`. Os números **não são dados reais**. As geometrias reais de `data/processed/geo/` (`br.topo.json`, `uf/*.topo.json`, `city/*.topo.json`) são servidas quando existem; na falta delas, o mock gera polígonos sintéticos. O primeiro `/api/v1/meta` leva alguns segundos (constrói os datasets).

## Scripts

```bash
npm run typecheck -w @votobr/web    # tsc --noEmit
npm test -w @votobr/web             # vitest (lógica pura, mock e i18n × código)
npm run build -w @votobr/web        # typecheck + vite build → apps/web/dist (assets com hash em /assets)
npm run preview -w @votobr/web      # serve dist em :4173 com o mesmo proxy
```

## Variáveis de ambiente (públicas; ver `.env.example`)

| Variável                            | Uso                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `VITE_UMAMI_WEBSITE_ID`             | ID público do site no Umami. Vazio = nenhum script de análise é carregado. |
| `VITE_UMAMI_SRC`                    | URL do script do Umami (padrão `https://cloud.umami.is/script.js`).        |
| `VITE_SITE_URL`                     | Origem pública (canonical, hreflang, `og:url`).                            |
| `VITE_REPO_URL`                     | Link do repositório de código aberto.                                      |
| `VITE_MOCK_API`, `API_PROXY_TARGET` | Somente desenvolvimento (ver acima).                                       |

## Análise de audiência e CSP

`src/analytics.ts` é um invólucro independente de provedor. Hoje usa Umami (sem cookies), carregado **somente** se `VITE_UMAMI_WEBSITE_ID` estiver definido, o navegador não sinalizar Do Not Track nem Global Privacy Control e o visitante aceitar o aviso de privacidade (LGPD). A escolha fica em `localStorage` (`votobr:analytics-consent`) e pode ser revista em “Preferências de privacidade”, no rodapé (`src/components/ConsentBanner.tsx`). O script usa `data-auto-track="false"` (as visualizações de página são enviadas a cada troca de rota da SPA, só com o caminho), `data-do-not-track="true"` e `data-exclude-search="true"`. Eventos: `system_change`, `area_change`, `language_change`, `share_click`, `coalition_toggle`, sempre com valores categóricos (sistema, UF, idioma), sem dados pessoais.

Origens que a política CSP do servidor precisa liberar (também exportadas como `ANALYTICS_CSP` em `src/analytics.ts`):

| Diretiva      | Umami Cloud (padrão)       | Umami próprio              |
| ------------- | -------------------------- | -------------------------- |
| `script-src`  | `https://cloud.umami.is`   | origem de `VITE_UMAMI_SRC` |
| `connect-src` | `https://gateway.umami.is` | origem de `VITE_UMAMI_SRC` |

Além disso, o frontend usa estilos em atributos `style` definidos via React/CSSOM (permitidos sob `style-src` sem `'unsafe-inline'` quando aplicados por JavaScript) e não carrega fontes, imagens ou scripts de terceiros.

## Design

- **Tokens**: cores, raios, sombras, espaçamentos e tipografia fluida (`clamp`) ficam em `src/styles/tokens.css`; `base.css`, `components.css` e `pages.css` só consomem variáveis. Não há modo escuro.
- **Tipografia**: Plus Jakarta Sans Variable, autohospedada pelo pacote `@fontsource-variable/plus-jakarta-sans` (importado em `src/main.tsx`, `font-display: swap`; o navegador baixa só o subconjunto necessário, normalmente o latino). `build.assetsInlineLimit: 0` em `vite.config.ts` garante que as fontes saiam como arquivos em `/assets` (nenhum `data:`), compatível com `font-src 'self'` e `style-src 'self'`.
- **Cores de partidos**: paleta categórica de 16 cores em `src/lib/parties.ts` (`PARTY_PALETTE`), sem o vermelho de alerta, com contraste ≥ 3:1 com o fundo e ≥ 4,5:1 com o texto sobre a cor (verificado em `test/color.test.ts`). As doze maiores bancadas da Câmara têm cor fixa; os demais partidos recebem cor pelo hash do id, evitando colisões no conjunto exibido. "Outros" é cinza. Nenhuma informação depende só da cor (rótulos e "ver tabela").
- **Movimento**: transições e animações de entrada só rodam sob `prefers-reduced-motion: no-preference`.

## Rotas da SPA

Pt-BR não tem prefixo; `/en/...` e `/es/...` espelham as mesmas rotas.

| Rota                    | Página                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| `/`                     | Home: Câmara dos Deputados nacional (hemiciclo, barras, métricas, mapa por UF) |
| `/casa/:office`         | Lista de áreas (`federal`, `state`, `municipal`); outros valores caem no 404   |
| `/casa/:office/:area`   | Painel da área, mapa de distritos, ganhadores e perdedores                     |
| `/sistemas`             | Explicação dos sistemas eleitorais                                             |
| `/metodologia`          | Fontes, validação, premissas e limites                                         |
| `/semipresidencialismo` | PEC 2/2025 e painel de governabilidade (montador de coalizão)                  |
| `/sobre`                | Projeto, créditos e privacidade                                                |

O estado selecionado fica na query (`?sistema=distrital-misto&mapa=mudanca&coalizao=PT,PL`) e é preservado ao compartilhar. Links antigos com `misto-paralelo`/`misto-compensatorio` abrem o distrital misto.

## Endpoints consumidos

`GET /api/v1/meta`, `/api/v1/simulate/:office/:area`, `/api/v1/chamber/:office` (`federal` e `state`), `/api/v1/validation`, `/api/v1/geo/br.topo.json`, `/api/v1/geo/uf/:uf.topo.json` e `/api/v1/geo/city/:ibge.topo.json`. Toda chamada leva `v=<dataVersion>` obtido em `/meta`. `/healthz` é usado só pela sonda do modo de desenvolvimento.

## Estrutura

```
apps/web
├── dev/                 mock da API (somente `vite serve`)
├── public/              favicon, robots.txt, site.webmanifest
├── src/
│   ├── components/      Hemicycle, ChamberPanel, BrazilMap, DistrictMap, Winners, Layout…
│   ├── pages/           uma página por rota (carregadas com React.lazy)
│   ├── lib/             lógica pura: urlState, format, hemicycle, parties, coalition,
│   │                    districts, voronoi, routes, rich, examples, color, api, geo
│   ├── i18n/            hook useT() sobre translate/translateList de @votobr/shared
│   ├── styles/          tokens, base, components, pages (CSS à mão)
│   ├── analytics.ts     Umami sem cookies, eventos e origens de CSP
│   └── seo.ts           title, description, og:*, twitter:*, canonical e hreflang por rota/idioma
└── test/                Vitest
```

Os textos de interface ficam **somente** em `packages/shared/src/locales/{pt-BR,en,es}.json` (pt-BR é a fonte; `packages/shared/test/i18n.test.ts` garante as mesmas chaves e placeholders nos três idiomas, e `test/i18n-keys.test.ts` garante que toda chave usada no código existe).

## Limitações conhecidas

- Não há imagem `og:image`; os cartões de compartilhamento são apenas texto.
- `robots.txt` não traz `Sitemap:` (exige URL absoluta, que depende do domínio de produção).
- As metatags por rota são atualizadas no cliente; rastreadores que não executam JavaScript veem os valores padrão (pt-BR) de `index.html`.
