# VotoBrasil

Simulador público e de código aberto que mostra, com **dados oficiais do TSE**, como as cadeiras do Legislativo brasileiro seriam distribuídas se o país adotasse outro sistema eleitoral.

## O que é

Cada eleição segue regras que decidem como os votos viram cadeiras. O VotoBrasil pega os **votos reais** de eleições passadas e refaz a contagem com outras regras, para você ver o que mudaria: quais partidos ganhariam ou perderiam cadeiras, quão fiel ao voto seria o resultado e como ficaria o mapa de cada estado ou cidade. Ele existe para dar base de dados a um debate público importante, como a PEC 2/2025, que propõe mudar o sistema político.

## O que você encontra

- **Câmara dos Deputados** e **Assembleias Legislativas** (incluindo a Câmara Legislativa do DF): eleições gerais de 2026, uma simulação por estado.
- **Senado**: fora do escopo (eleição majoritária; não há o que simular entre sistemas proporcionais).
- **Câmaras Municipais**: eleições de 2024 das 26 capitais estaduais e das demais cidades com mais de 1 milhão de habitantes no Censo 2022 (28 cidades no total; Brasília não tem eleição municipal).
- **Sistemas comparados**: o atual (proporcional de lista aberta), lista fechada, distritão, distrital puro e o distrital misto da PEC 2/2025 (metade das cadeiras em distritos, total proporcional ao voto no partido e cadeiras excedentes).
- Mapa interativo, gráficos, indicadores de proporcionalidade e uma página de metodologia. Há ainda uma página de subprioridade sobre semipresidencialismo.
- Interface em português (padrão), inglês e espanhol.

> As simulações são **contrafactuais**: partem dos votos dados em 2026 e 2024 sob as regras atuais e não preveem como eleitores, partidos e candidatos se comportariam sob outras regras. Veja os limites em [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## De onde vêm os dados

Tudo vem de fontes públicas: os [Dados Abertos do TSE](https://dadosabertos.tse.jus.br/) (resultados eleitorais) e as [malhas e localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/) (mapas). O VotoBrasil é um projeto independente: não é um serviço do TSE, do IBGE nem de qualquer órgão do governo, partido ou campanha. Código, premissas e a lista de arquivos usados são abertos para que qualquer pessoa possa conferir e criticar.

## Para quem quer mexer no projeto

Em poucas palavras: um ETL transforma os arquivos oficiais em dados compactos, uma API calcula as simulações e uma página web mostra os resultados. Para rodar no seu computador: `npm ci`, `npm run data:build` e `npm run dev`.

| Quero…                                   | Veja                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| configurar e rodar o projeto             | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)                            |
| entender a arquitetura e as decisões     | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                          |
| conhecer os algoritmos, fontes e limites | [docs/METHODOLOGY.md](docs/METHODOLOGY.md)                            |
| publicar o site na AWS                   | [docs/DEPLOY.md](docs/DEPLOY.md) e [infra/README.md](infra/README.md) |
| contribuir com código, dados ou textos   | [CONTRIBUTING.md](CONTRIBUTING.md)                                    |
| reportar uma vulnerabilidade             | [SECURITY.md](SECURITY.md)                                            |

Nunca faça commit de `.env`, chaves ou `*.tfstate`: o `.gitignore` já os exclui e o CI roda varredura de segredos.

## Licença

Defina a licença do projeto antes de publicar (sugestão: MIT para o código; os dados do TSE e do IBGE são abertos e mantêm suas próprias condições de uso).
