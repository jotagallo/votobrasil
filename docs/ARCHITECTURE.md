# Arquitetura

## Visão geral

```
 TSE / IBGE (arquivos abertos)
        │  npm run data:build  (offline, em CI ou localmente)
        ▼
 packages/etl ──► data/processed/  meta.json · validation.json · geo/*.topo.json · datasets/*.json.br
                         │
                         ▼
 apps/api (Fastify) ── cache LRU em memória ── packages/shared (algoritmos)
        │  /api/v1/*   +   serve apps/web/dist
        ▼
 CloudFront ──► Elastic Beanstalk (1 instância)          navegador (SPA React)
```

Monólito TypeScript em workspaces npm, com front-end e back-end **desacoplados** (a SPA só conversa com a API por HTTP) e uma biblioteca compartilhada (`packages/shared`) usada pelos três lados.

## Pacotes

| Pacote            | Responsabilidade                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Tipos, contrato da API (`api.ts`), sistemas eleitorais (`systems/`), `simulate`, métricas (Gallagher, número efetivo de partidos), infraestrutura de i18n.                   |
| `packages/etl`    | Download com verificação (`sha256`, tamanho), leitura de CSV do TSE (ISO-8859-1), geometrias do IBGE, montagem dos conjuntos de dados, validação contra o resultado oficial. |
| `apps/api`        | Rotas HTTP, cache, cabeçalhos de segurança, rate limit; serve a SPA em produção.                                                                                             |
| `apps/web`        | SPA: mapa, hemiciclo, comparação de sistemas, metodologia, subprioridade (semipresidencialismo).                                                                             |

## Por que os dados são processados offline

O requisito original sugeria consultar as APIs oficiais. O projeto usa os **arquivos abertos oficiais** (CSV por município-zona e por seção), pois:

1. são a única forma de obter votos por **zona/seção** (necessário para desenhar distritos), que as APIs de resultado não oferecem;
2. o site fica independente da disponibilidade do TSE e muito mais rápido;
3. cada arquivo tem `sha256` registrado, tornando qualquer número auditável e reprodutível (`npm run data:build`).

A cache interna exigida é feita em duas camadas: arquivos Brotli no disco da instância e LRU em memória (conjuntos de dados e resultados de simulação).

## Unidades geográficas

- **Estados (Câmara dos Deputados e Assembleias):** a unidade mínima é a **zona eleitoral dentro do município**, posicionada pela média das coordenadas dos locais de votação ponderada pelo eleitorado (com fallback para a zona, o município e o centroide do polígono). O TSE publica coordenadas por local de votação, mas a votação por candidato só por município-zona. Os distritos (população do Censo 2022, ±5%, municípios inteiros salvo os grandes; ver [METHODOLOGY.md](METHODOLOGY.md#5-desenho-dos-distritos)) dividem os municípios grandes pelos locais de votação, e os votos de uma zona repartida entre distritos são divididos na proporção dos eleitores de cada parte.
- **Câmaras Municipais (2024, cidades com 1 milhão de eleitores ou mais):** a unidade é o **local de votação**. A votação por seção apenas reparte o total de cada zona entre os locais da zona (método do maior resto), de modo que os totais coincidem exatamente com a apuração oficial.

## Formato dos dados (`data/processed`)

| Arquivo                                      | Conteúdo                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `meta.json`                                  | versão dos dados, fontes (`sha256`), áreas por casa legislativa          |
| `validation.json`                            | reprodução do resultado oficial por área                                 |
| `datasets/{ano}-{casa}-{área}.json.br`       | candidatos, competidores (partido/federação) e unidades, em Brotli       |
| `geo/br.topo.json`, `geo/uf/*`, `geo/city/*` | TopoJSON simplificado (IBGE, anéis reorientados para o padrão do d3-geo) |

`dataVersion` é um hash do conteúdo gerado e das fontes; a API o inclui nas respostas e o front-end o envia em `?v=`, o que permite cache imutável no CloudFront.

## API

| Rota                                                               | Resposta                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `GET /healthz`                                                     | `{ status, dataVersion }` (não exige o header de origem)   |
| `GET /api/v1/meta`                                                 | casas, áreas, sistemas disponíveis, fontes e `dataVersion` |
| `GET /api/v1/simulate/:office/:area?system=&v=`                    | resultado de um sistema numa área (+ métricas e distritos) |
| `GET /api/v1/chamber/:office?system=&v=`                           | soma das 27 UFs (Câmara dos Deputados e Assembleias)       |
| `GET /api/v1/validation`                                           | relatório de reprodução do resultado oficial               |
| `GET /api/v1/geo/br.topo.json`, `/geo/uf/:file`, `/geo/city/:file` | geometrias                                                 |

Erros seguem `{ "error": { "code", "message" } }`. As entradas são validadas de forma estrita (casa, área e sistema).

### Cache

- **Servidor:** LRU de conjuntos de dados (dimensionada em bytes) e de resultados serializados, com deduplicação de cálculos simultâneos.
- **HTTP:** `ETag` por resposta; `Cache-Control: immutable` somente quando `?v` é a versão atual, senão 60 s; `index.html` nunca fica em cache e `/assets/*` é imutável.
- **CloudFront:** política própria para `/api/*` (encaminha a query string) e outra para a SPA.

### Segurança

- Atrás do CloudFront, a API exige o header secreto `x-origin-verify` (comparação em tempo constante) e a instância só aceita tráfego dos IPs do CloudFront.
- CSP restrita (`default-src 'self'`; Umami como única origem externa), `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`. O HSTS fica a cargo do CloudFront.
- Rate limit por IP (com `TRUST_PROXY_HOPS=2` em produção) e limite de tamanho de parâmetros; nenhum segredo no repositório.

## Algoritmos (`packages/shared`)

Todos são funções puras e determinísticas, cobertas por testes com valores calculados à mão. As regras estão em [METHODOLOGY.md](METHODOLOGY.md).

## Infraestrutura e CI/CD

Em [../infra/README.md](../infra/README.md) e `.github/workflows/`: CI (lint, tipos, testes, build, varredura de segredos, checagem da imagem Docker), deploy via OIDC e atualização periódica dos dados.
