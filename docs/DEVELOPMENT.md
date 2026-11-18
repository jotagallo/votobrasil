# Guia técnico

Configuração, arquitetura e operação do VotoBrasil para quem vai rodar, alterar ou publicar o projeto. A visão geral, para qualquer leitor, está no [README](../README.md).

Outros documentos: [ARCHITECTURE.md](ARCHITECTURE.md) (decisões e fluxo de dados), [METHODOLOGY.md](METHODOLOGY.md) (algoritmos, fontes e limites), [DEPLOY.md](DEPLOY.md) (passo a passo na AWS), [../infra/README.md](../infra/README.md) (Terraform e CI/CD), [../apps/web/README.md](../apps/web/README.md) (frontend), [../CONTRIBUTING.md](../CONTRIBUTING.md) e [../SECURITY.md](../SECURITY.md).

## Arquitetura em uma frase

Um ETL offline transforma os arquivos abertos do TSE e do IBGE em conjuntos de dados compactos; uma API Fastify (sem banco de dados, com cache em memória) executa as simulações com a biblioteca de algoritmos compartilhada; uma SPA React consome a API. Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md).

```
apps/web        SPA (Vite + React + TypeScript)
apps/api        API (Fastify) — também serve a SPA em produção
packages/shared algoritmos, tipos, métricas, i18n e contrato da API (usados por web, api e etl)
packages/etl    download/validação dos dados oficiais → data/processed
infra/          Terraform (AWS Elastic Beanstalk + CloudFront)
.github/        CI/CD (testes, deploy, atualização manual de dados)
```

## Requisitos

- Node.js 22 (`.nvmrc`) e npm 10+
- Para gerar os dados: ~3 GB de disco livre e rede. O download inicial do TSE passa de 1 GB, em especial as seções de São Paulo.
- Opcional: Docker e Terraform (ver [../infra/README.md](../infra/README.md)).

## Como rodar localmente

```bash
npm ci
npm run data:build      # baixa os dados oficiais e gera data/processed (primeira vez: ~20 min)
npm run data:validate   # confere a integridade dos dados gerados
npm run dev             # API em :8080 e web em :5173
```

Sem os dados, o servidor de desenvolvimento da web usa um mock com números inventados (ver [../apps/web/README.md](../apps/web/README.md)).

Para servir API e SPA juntas, como em produção:

```bash
npm run build
node apps/api/dist/server.mjs     # http://localhost:8080
```

Com Docker: `docker compose up --build app` (ver comentários em [../docker-compose.yml](../docker-compose.yml)).

### Makefile

O [Makefile](../Makefile) centraliza os comandos do projeto (`make` lista todos). Os principais:

| Comando             | O que faz                                                                           |
| ------------------- | ----------------------------------------------------------------------------------- |
| `make setup`        | cria `.env` a partir de `.env.example` e instala as dependências                    |
| `make dev`          | API e web em modo desenvolvimento                                                   |
| `make check`        | as mesmas verificações do CI (formato, lint, tipos, testes, build)                  |
| `make data`         | ETL completo; `make data-offline` usa só os downloads já existentes                 |
| `make data-refresh` | apaga `data/processed`, regera e valida (mantém os downloads)                       |
| `make data-status`  | tamanho de `data/raw`/`data/processed` e `dataVersion` atual                        |
| `make flush`        | apaga dados processados, builds, coverage e `.cache` (mantém `data/raw`)            |
| `make flush-raw`    | apaga os downloads do TSE/IBGE (~2 GB) — pede confirmação                           |
| `make flush-all`    | reset total: dados, builds, `node_modules` e recursos Docker — pede confirmação     |
| `make flush-cdn`    | invalida `/*` no CloudFront de produção (requer credenciais AWS) — pede confirmação |

Use `CONFIRM=1` para pular as confirmações (ex.: em scripts). Após um flush, reinicie a API: os
datasets ficam em cache na memória do processo.

### Scripts

| Comando                 | O que faz                                                           |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | API e web em modo desenvolvimento                                   |
| `npm run build`         | compila `shared`, a SPA e a API (`apps/*/dist`)                     |
| `npm test`              | testes de todos os pacotes                                          |
| `npm run typecheck`     | verificação de tipos                                                |
| `npm run lint`          | ESLint                                                              |
| `npm run data:build`    | ETL: baixa, valida e gera `data/processed`                          |
| `npm run data:validate` | confere a consistência dos dados gerados                            |
| `npm run bundle`        | gera `dist/bundle.zip` (API + SPA + dados) para o Elastic Beanstalk |

## Variáveis de ambiente

### API (em execução)

Todas opcionais; os valores padrão servem para desenvolvimento. Nenhuma contém segredo no repositório (ver [../.env.example](../.env.example)).

| Variável                | Padrão                                                                                         | Uso                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `PORT` / `HOST`         | `8080` / `127.0.0.1` (`0.0.0.0` em produção)                                                   | endereço de escuta                                                   |
| `DATA_DIR`              | `./data`, `./data/processed` ou `../../data/processed`                                         | saída do ETL                                                         |
| `WEB_DIR`               | `./web`, `apps/web/dist` ou `../web/dist`                                                      | build da SPA (se existir, a API também a serve)                      |
| `CORS_ORIGINS`          | vazio                                                                                          | origens autorizadas (dev server → API)                               |
| `ORIGIN_VERIFY_SECRET`  | vazio                                                                                          | exige o header `x-origin-verify` (produção, atrás do CloudFront)     |
| `TRUST_PROXY_HOPS`      | `0`                                                                                            | proxies confiáveis à frente do Node (CloudFront + nginx do EB = `2`) |
| `RATE_LIMIT_PER_MINUTE` | `600`                                                                                          | limite por IP nas rotas `/api`                                       |
| `DATASET_CACHE_MB`      | `384`                                                                                          | cache LRU de conjuntos de dados em memória                           |
| `RESULT_CACHE_MB`       | `64`                                                                                           | cache LRU de resultados de simulação                                 |
| `CSP_SCRIPT_SRC_EXTRA`  | `https://*.googletagmanager.com`                                                               | origens de script na CSP (estatísticas)                              |
| `CSP_CONNECT_SRC_EXTRA` | `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com` | origens de conexão na CSP (estatísticas)                             |
| `CSP_IMG_SRC_EXTRA`     | `https://*.google-analytics.com https://*.googletagmanager.com`                                | origens de imagem na CSP (estatísticas)                              |

Os três `CSP_*_EXTRA` são listas separadas por espaço ou vírgula que **substituem** o padrão; use string vazia para não liberar nenhuma origem externa. A SPA nunca carrega script externo antes do “Entendi” (ver abaixo), mas a CSP já libera as origens para que a medição funcione depois disso.

### Build da SPA (valores públicos, vão para o navegador)

| Variável                 | GitHub (repositório) | Uso                                                                                                                                          |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GA_MEASUREMENT_ID` | `GA_MEASUREMENT_ID`  | ID de medição do Google Analytics 4 (`G-XXXXXXXXXX`). Vazio: sem estatísticas e sem script externo (o aviso de cookies aparece mesmo assim). |
| `VITE_SITE_URL`          | `SITE_URL`           | Origem pública do site: URLs absolutas de `og:*`/`canonical`/`hreflang`, `sitemap.xml` e domínio medido pelas estatísticas.                  |

No CI, o `deploy.yml` converte as variáveis do repositório em `VITE_*` na etapa de build. Localmente, defina-as no `.env`.

## Dados

O site **não consulta o TSE em tempo de execução**: os arquivos abertos são baixados e processados offline (`npm run data:build`) e a API apenas lê o resultado. Isso mantém o site rápido, barato e imune a instabilidades externas. Cada execução registra o `sha256` de cada arquivo de origem em `meta.json`, e a versão dos dados (`dataVersion`) muda sempre que a saída muda, invalidando os caches.

Como as eleições já aconteceram, os dados não mudam: o ETL roda no job de build do `deploy.yml` (só quando o cache de dados falha) e o `data-refresh.yml` é manual (`workflow_dispatch`). Para refazer tudo localmente a partir dos downloads em cache: `VOTOBR_OFFLINE=1 npm run data:build && npm run data:validate`.

Fontes (todas públicas): [Dados Abertos do TSE](https://dadosabertos.tse.jus.br/) (votação por candidato e partido por município-zona, votação por seção, eleitorado por local de votação) e [malhas e localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/).

O recorte municipal (26 capitais e demais cidades acima de 1 milhão de habitantes no Censo 2022; Brasília não tem eleição municipal) é ajustável em `VOTOBR_MIN_MUNICIPAL_POPULATION`.

## Estatísticas de audiência e cookies

O site mede o uso (páginas e simulações mais acessadas) com o Google Analytics 4, de forma agregada e sem fins publicitários. Em todo o texto do site só se fala em “cookies para estatísticas de uso”, sem nomear a ferramenta. O comportamento é todo definido em [`apps/web/src/analytics.ts`](../apps/web/src/analytics.ts):

- **Ativação.** Só existe se `VITE_GA_MEASUREMENT_ID` for um ID válido **e** o site estiver sendo acessado no domínio de `VITE_SITE_URL` (localhost e pré-visualizações ficam de fora quando a variável está definida).
- **Consentimento.** O aviso de cookies (`ConsentBanner`) aparece para todo visitante até o clique em “Entendi”, mesmo sem ID configurado; o clique é o consentimento (LGPD, art. 7º, I). O `gtag.js` só é baixado e cookies só são criados **depois** do clique. O registro de que o aviso foi visto fica em `localStorage` (`votobr:cookie-notice`).
- **Privacidade do navegador.** Com Do Not Track ou Global Privacy Control ligados, nada é carregado, mesmo depois do “Entendi”.
- **Revogação.** O visitante apaga ou bloqueia os cookies nas configurações do navegador (informado na página Sobre).
- **Dados enviados.** Visualizações de página (só o caminho, enviadas a cada troca de rota do SPA) e eventos com valores categóricos, nunca dados pessoais: `system_change`, `area_change`, `language_change`, `share_click`, `coalition_toggle`. Sinais de publicidade (`allow_google_signals`, `allow_ad_personalization_signals`) ficam desligados.

Para ativar em produção:

1. No Google Analytics, crie uma propriedade GA4 e um _data stream_ Web com o domínio público; copie o ID de medição (`G-…`).
2. Defina a variável do repositório `GA_MEASUREMENT_ID` (e `SITE_URL`, se ainda não definida) e faça um novo deploy: `gh variable set GA_MEASUREMENT_ID --repo <dono>/<repo> --body "G-XXXXXXXXXX"`.
3. (Opcional) Em _Admin_ → _Definições personalizadas_, registre como dimensões de evento os parâmetros `system`, `office`, `area`, `to`, `method`, `party` e `selected`; sem isso, eles não aparecem nos relatórios.
4. Confira em _Relatórios_ → _Tempo real_ depois de clicar em “Entendi”.

Localmente, para ver o aviso: defina `VITE_GA_MEASUREMENT_ID=G-TESTE12345` no `.env` com `VITE_SITE_URL=http://localhost:5173`, abra o site numa janela anônima e limpe `localStorage` para vê-lo de novo.

A CSP da API precisa liberar as origens do Google (padrões na tabela acima). A lista é duplicada em `ANALYTICS_CSP` (`apps/web/src/analytics.ts`) e em `apps/api/src/config.ts`: mantenha as duas em sincronia.

## SEO

- **Metatags por rota.** `apps/web/src/seo.ts` atualiza título, descrição, `canonical`, `hreflang`, `og:*` e `twitter:*` a cada navegação, nos três idiomas.
- **Imagem de compartilhamento.** `apps/web/public/og-image.png` (1200×630), usada em `og:image` e `twitter:image` (`summary_large_image`).
- **Dados estruturados.** `index.html` traz um JSON-LD `WebSite` com nome, descrição, idioma e autoria.
- **`robots.txt` e `sitemap.xml`.** Gerados no build por `apps/web/plugins/site-files.ts`. O sitemap lista cada página nos três idiomas (com `hreflang`), incluindo as áreas disponíveis em `data/processed/meta.json` quando o arquivo existe no build. Sem `VITE_SITE_URL` não há como montar URLs absolutas: o `sitemap.xml` não é gerado e o `robots.txt` sai sem a linha `Sitemap`.
- **Limitação.** O site é uma SPA: o Google executa JavaScript e vê as metatags de cada rota, mas rastreadores de pré-visualização que não executam (WhatsApp, Facebook, X) enxergam sempre as metatags da home.
- **Depois do deploy:** cadastre `https://<dominio>/sitemap.xml` no Google Search Console.

## Deploy

Resumo em [../infra/README.md](../infra/README.md) e passo a passo em [DEPLOY.md](DEPLOY.md): o Terraform cria um Elastic Beanstalk (instância única `t4g.small`, sem load balancer) atrás de um CloudFront; o GitHub Actions publica via OIDC (sem chaves de longa duração). Custo estimado em torno de US$ 18/mês.

## Contribuindo e segurança

Veja [../CONTRIBUTING.md](../CONTRIBUTING.md) e [../SECURITY.md](../SECURITY.md). Nunca faça commit de `.env`, chaves ou `*.tfstate`: o `.gitignore` já os exclui e o CI roda varredura de segredos.
