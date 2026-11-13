# VotoBrasil

Simulador público e de código aberto que mostra, com **dados oficiais do TSE**, como as cadeiras do Legislativo brasileiro seriam distribuídas se o país adotasse outro sistema eleitoral.

- **Câmara dos Deputados** e **Assembleias Legislativas** (incluindo a Câmara Legislativa do DF): eleições gerais de 2026, uma simulação por estado.
- **Senado**: fora do escopo (eleição majoritária; não há o que simular entre sistemas proporcionais).
- **Câmaras Municipais**: eleições de 2024 de todas as cidades com 1 milhão de eleitores ou mais (11 cidades; limiar ajustável em `VOTOBR_MIN_MUNICIPAL_VOTERS`).
- **Sistemas comparados**: o atual (proporcional de lista aberta), lista fechada, distritão, distrital puro e o distrital misto da PEC 2/2025 (metade das cadeiras em distritos, total proporcional ao voto no partido e cadeiras excedentes).
- Mapa interativo, gráficos, indicadores de proporcionalidade e uma página de metodologia. Há ainda uma página de subprioridade sobre semipresidencialismo.
- Interface em português (padrão), inglês e espanhol.

> As simulações são **contrafactuais**: partem dos votos dados em 2026 e 2024 sob as regras atuais e não preveem como eleitores, partidos e candidatos se comportariam sob outras regras. Veja os limites em [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Arquitetura em uma frase

Um ETL offline transforma os arquivos abertos do TSE e do IBGE em conjuntos de dados compactos; uma API Fastify (sem banco de dados, com cache em memória) executa as simulações com a biblioteca de algoritmos compartilhada; uma SPA React consome a API. Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
apps/web        SPA (Vite + React + TypeScript)
apps/api        API (Fastify) — também serve a SPA em produção
packages/shared algoritmos, tipos, métricas, i18n e contrato da API (usados por web, api e etl)
packages/etl    download/validação dos dados oficiais → data/processed
infra/          Terraform (AWS Elastic Beanstalk + CloudFront)
.github/        CI/CD (testes, deploy, atualização de dados)
```

## Requisitos

- Node.js 22 (`.nvmrc`) e npm 10+
- Para gerar os dados: ~3 GB de disco livre e rede. O download inicial do TSE passa de 1 GB, em especial as seções de São Paulo.
- Opcional: Docker e Terraform (ver [infra/README.md](infra/README.md)).

## Como rodar localmente

```bash
npm ci
npm run data:build      # baixa os dados oficiais e gera data/processed (primeira vez: ~20 min)
npm run data:validate   # confere a integridade dos dados gerados
npm run dev             # API em :8080 e web em :5173
```

Para servir API e SPA juntas, como em produção:

```bash
npm run build
node apps/api/dist/server.mjs     # http://localhost:8080
```

Com Docker: `docker compose up --build app` (ver comentários em [docker-compose.yml](docker-compose.yml)).

### Makefile

O [Makefile](Makefile) centraliza os comandos do projeto (`make` lista todos). Os principais:

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

### Variáveis de ambiente da API

Todas opcionais; os valores padrão servem para desenvolvimento. Nenhuma contém segredo no repositório (ver [.env.example](.env.example)).

| Variável                | Padrão                                                 | Uso                                                                  |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `PORT` / `HOST`         | `8080` / `127.0.0.1` (`0.0.0.0` em produção)           | endereço de escuta                                                   |
| `DATA_DIR`              | `./data`, `./data/processed` ou `../../data/processed` | saída do ETL                                                         |
| `WEB_DIR`               | `./web`, `apps/web/dist` ou `../web/dist`              | build da SPA (se existir, a API também a serve)                      |
| `CORS_ORIGINS`          | vazio                                                  | origens autorizadas (dev server → API)                               |
| `ORIGIN_VERIFY_SECRET`  | vazio                                                  | exige o header `x-origin-verify` (produção, atrás do CloudFront)     |
| `TRUST_PROXY_HOPS`      | `0`                                                    | proxies confiáveis à frente do Node (CloudFront + nginx do EB = `2`) |
| `RATE_LIMIT_PER_MINUTE` | `600`                                                  | limite por IP nas rotas `/api`                                       |
| `DATASET_CACHE_MB`      | `384`                                                  | cache LRU de conjuntos de dados em memória                           |
| `RESULT_CACHE_MB`       | `64`                                                   | cache LRU de resultados de simulação                                 |
| `CSP_SCRIPT_SRC_EXTRA`  | `https://cloud.umami.is`                               | origens extras de script na CSP (analytics)                          |
| `CSP_CONNECT_SRC_EXTRA` | endpoints do Umami Cloud                               | origens extras de conexão na CSP                                     |

## Dados

O site **não consulta o TSE em tempo de execução**: os arquivos abertos são baixados e processados offline (`npm run data:build`) e a API apenas lê o resultado. Isso mantém o site rápido, barato e imune a instabilidades externas. Cada execução registra o `sha256` de cada arquivo de origem em `meta.json`, e a versão dos dados (`dataVersion`) muda sempre que a saída muda, invalidando os caches.

Fontes (todas públicas): [Dados Abertos do TSE](https://dadosabertos.tse.jus.br/) (votação por candidato e partido por município-zona, votação por seção, eleitorado por local de votação) e [malhas e localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/).

## Analytics

O site usa [Umami](https://umami.is) (plano gratuito do Umami Cloud ou auto-hospedado): sem cookies, sem dados pessoais, respeita Do Not Track/GPC e só é carregado se `VITE_UMAMI_WEBSITE_ID` estiver definido **e** o visitante aceitar o aviso de privacidade (LGPD, consentimento opt-in guardado em `localStorage`; revogável no rodapé). Alternativas equivalentes: GoatCounter e Cloudflare Web Analytics.

## Deploy

Resumo em [infra/README.md](infra/README.md): o Terraform cria um Elastic Beanstalk (instância única `t4g.small`, sem load balancer) atrás de um CloudFront; o GitHub Actions publica via OIDC (sem chaves de longa duração). Custo estimado em torno de US$ 18/mês.

## Contribuindo e segurança

Veja [CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md). Nunca faça commit de `.env`, chaves ou `*.tfstate`: o `.gitignore` já os exclui e o CI roda varredura de segredos.

## Licença

Defina a licença do projeto antes de publicar (sugestão: MIT para o código; os dados do TSE e do IBGE são abertos e mantêm suas próprias condições de uso).
