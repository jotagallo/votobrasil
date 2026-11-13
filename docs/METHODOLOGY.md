# Metodologia

Este documento descreve, de forma auditável, como o VotoBrasil transforma os dados oficiais em simulações. O código correspondente está em `packages/etl` (dados) e `packages/shared` (algoritmos).

## 1. O que é (e o que não é)

O VotoBrasil responde a uma pergunta **contrafactual**: _se os votos dados em 2026 (gerais) e 2024 (municipais) fossem apurados por outro sistema, como ficariam as cadeiras?_ Não é uma previsão. Eleitores, partidos e candidatos mudariam de comportamento sob outras regras (voto útil, coligações, número de candidatos, campanhas locais), e nada disso é modelado.

## 2. Fontes de dados

Todas oficiais e públicas; o `sha256` de cada arquivo usado fica em `meta.json` (`sources`) e é exibido no site.

| Dado                                                  | Fonte                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Votos por candidato e por partido, por município-zona | TSE — Dados Abertos (`votacao_candidato_munzona`, `votacao_partido_munzona`) |
| Totais oficiais de votos válidos e eleitorado         | TSE — `detalhe_votacao_munzona`                                              |
| Locais de votação, coordenadas e eleitorado           | TSE — `eleitorado_locais_votacao`                                            |
| Votos por seção (apenas municipais 2024)              | TSE — `votacao_secao`                                                        |
| Municípios e malhas territoriais                      | IBGE — API de localidades e de malhas (v1/v3)                                |
| População residente por município                     | IBGE — Censo 2022, SIDRA tabela 4709, variável 93                            |

## 3. Tratamento dos dados

1. **Competidor** = federação partidária (quando existe) ou partido isolado. Os votos de legenda valem para o competidor.
2. **Votos válidos** = votos nominais válidos + votos de legenda válidos. Brancos e nulos ficam de fora.
3. **Integridade:** para cada área, os votos válidos do conjunto gerado são comparados com o total oficial de `detalhe_votacao_munzona`; a execução do ETL falha se houver qualquer diferença.
4. **Unidade geográfica mínima:**
   - _Estados_: zona eleitoral dentro de cada município, posicionada na média das coordenadas dos locais de votação da zona ponderada pelo eleitorado. Coordenadas fora do polígono do município (erro de cadastro) são descartadas; zonas sem coordenada válida usam o município e, em último caso, o centroide do polígono.
   - _Municípios (2024)_: local de votação. A votação por seção apenas reparte o total oficial de cada zona entre os locais da zona (método do maior resto), de modo que os totais coincidem exatamente com a apuração do TSE.
5. As malhas do IBGE (RFC 7946) são reorientadas para o padrão do `d3-geo` antes de qualquer teste de pertencimento ou desenho.

## 4. Sistemas simulados

Seja _N_ o número de cadeiras da circunscrição (estado ou município), igual ao real. Só o distrital misto pode ultrapassá-lo, com as cadeiras excedentes previstas na PEC 2/2025 (4.5).

### 4.1 Atual — proporcional de lista aberta

É o **resultado oficial**: os eleitos informados pelo TSE (`ELEITO POR QP`, `ELEITO POR MÉDIA`). Não é recalculado.

### 4.2 Lista fechada

Cadeiras por **maiores médias (D'Hondt)** entre os competidores, com base na soma de votos nominais e de legenda. Como a ordem de uma lista fechada seria definida pelo partido, adota-se como _aproximação_ a ordem pela votação nominal obtida em 2026/2024.

### 4.3 Distritão

Os _N_ candidatos mais votados da circunscrição, sem considerar partidos.

### 4.4 Distrital puro

A circunscrição é dividida em _N_ distritos de uma vaga (ver 5). Pluralidade simples, sem segundo turno:

- **Distrito de origem:** cada candidato disputa apenas o distrito onde teve a sua maior votação (como no Radar do Voto).
- **Vencedor:** em cada distrito vence o **candidato** mais votado entre os que o têm como distrito de origem. Se nenhum candidato tiver ali a sua maior votação, vence o mais votado no distrito que ainda não tenha sido eleito.
- Votos de legenda não elegem candidatos distritais (contam só para a lista nos mistos e nos indicadores).

> Até a versão anterior, o distrito era atribuído ao **partido** com mais votos somados no distrito (todos os candidatos + legenda). Essa regra favorecia sistematicamente o maior partido e foi abandonada — ver 4.7.

### 4.5 Distrital misto (PEC 2/2025)

O site simula um único modelo misto, o definido pela PEC 2/2025 (art. 45, §§ 1º a 5º, na redação proposta):

- **Distritos:** `⌈N/2⌉` ("cinquenta por cento, ou o número inteiro maior mais próximo", § 1º), decididos como em 4.4.
- **Direito proporcional:** D'Hondt sobre as _N_ cadeiras pelos votos de lista de cada competidor (nominais + legenda, usados como proxy do voto no partido, § 2º).
- **Lista:** cada competidor recebe `direito − vitórias distritais` vagas de lista, preenchidas pelos candidatos não eleitos nos distritos em ordem de votação nominal (proxy da lista preordenada, § 3º). Se a lista se esgotar, a vaga passa ao próximo quociente.
- **Cadeiras excedentes:** quem vence mais distritos do que o seu direito mantém as vitórias, e a diferença é **acrescida** à casa (§ 4º). Não há cadeiras de nivelamento para os demais. Por isso a casa simulada pode ter mais que _N_ cadeiras; a interface informa o tamanho resultante.

O inciso I do mesmo artigo menciona "2/3 em distritos uninominais e 1/3 por listas", em contradição com o § 1º. O simulador segue o § 1º, que detalha a regra. A PEC trata apenas da Câmara dos Deputados; assembleias e câmaras municipais usam a mesma regra como extensão comparativa.

### 4.6 Fora do escopo: Senado

O Senado não é simulado. A eleição é majoritária (uma ou duas vagas por estado, decididas pelos mais votados), de modo que não há distribuição proporcional de cadeiras a comparar entre sistemas.

### 4.7 Comparação com outras simulações

Os resultados foram comparados com simulações independentes do voto distrital misto feitas com os mesmos votos:

| Referência                                                                                            | Regra do distrito                                                       | Resultado comparável                                     |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| [Ranking dos Políticos](https://ranking.org.br/artigos/simulacao-voto-distrital-misto-congresso-2026) | candidato mais votado                                                   | compensatório: PL 121 → 125; 449 de 513 eleitos mantidos |
| [Radar do Voto](https://radardovoto.com/voto-distrital)                                               | candidato mais votado; cada um concorre só no distrito de maior votação | compensatório troca 79 deputados federais                |
| [HubPolítico (PLS 86/2017)](https://hubpolitico.com.br/distrital)                                     | transfere votos nominais ao candidato do partido; exclui legenda        | múltiplos mapas; hipótese diferente da usada aqui        |
| Nota técnica do DIAP                                                                                  | sem distritos ("distritão misto")                                       | não comparável diretamente                               |

| Câmara dos Deputados      | Partido mais votado no distrito; bisseção por eleitores | Candidato mais votado; bisseção por eleitores | Candidato mais votado; distritos atuais (5) |
| ------------------------- | ------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| PL no distrital puro      | 238                                                     | 80                                            | 76                                          |
| PL no misto compensatório | 148                                                     | 128 (casa com 532 cadeiras, 19 excedentes)    | 128 (casa com 531 cadeiras, 18 excedentes)  |
| Eleitos mantidos no misto | —                                                       | 450 de 513                                    | 450 de 513                                  |

A regra anterior somava no distrito os votos de todos os candidatos de um partido, o que dá vantagem estrutural ao partido com mais candidatos e votos espalhados, e penalizava partidos de centro com candidatos fortes regionalmente. Com a regra por candidato, o VotoBrasil converge para as referências. O novo desenho dos distritos (população, municípios inteiros, ±5%) muda pouco o agregado nacional; as diferenças restantes vêm do traçado (cada simulação desenha os seus distritos, ver 5.4) e das cadeiras excedentes.

## 5. Desenho dos distritos

Os distritos do simulador são **ilustrativos**: servem para comparar sistemas, não para propor um mapa eleitoral. O desenho se inspira em critérios do PLS 86/2017 e da PEC 2/2025, sem certificar cumprimento integral desses projetos. É **determinístico** (semente fixa: a mesma entrada produz sempre o mesmo mapa). Código: `packages/etl/src/districting.ts` (montagem do grafo) e `packages/shared/src/systems/partition.ts` (partição). Votos, candidatos e partidos não entram na função de desenho.

### 5.1 Critérios

| Critério             | Regra adotada                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Número de distritos  | Distrital puro: _N_. Misto: `⌈N/2⌉` (PEC 2/2025, § 1º).                                                                                                                                                                                |
| Peso a equilibrar    | Totais municipais do **Censo 2022** (IBGE, SIDRA tabela 4709). Dentro dos municípios, inclusive nos mapas estaduais, a população é estimada por local de votação, proporcionalmente ao eleitorado; não são usados setores censitários. |
| Tolerância           | Meta de **±5%** em relação à média; limite operacional de **±10%**. O build falha se algum distrito passar do limite. A restrição do PLS sobre quantos distritos podem usar a exceção não é imposta pelo simulador.                    |
| Conectividade        | Verificada no grafo. Vizinhança municipal do IBGE e triangulação entre locais; componentes isolados são conectados por proximidade. Não garante continuidade exata das áreas de Voronoi exibidas.                                      |
| Municípios           | Inicialmente indivisíveis até **meia cota**; os maiores podem ser divididos por local de votação. Novas tentativas podem reduzir esse limiar para 1/4 e 1/10 da cota, com penalidade por pedaço extra.                                 |
| Compacidade e coesão | Penalidades para o momento de inércia e para cada pedaço extra de um município, de uma **região geográfica imediata** do IBGE ("formação histórica", PEC 2/2025) e, nas cidades, de um bairro.                                         |

O [texto do PLS 86/2017, enviado à Câmara como PL 9212/2017](https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=1626744) admite desvio de até 10% em apenas um distrito ou em 10% dos distritos, o que for maior. Portanto, estar abaixo de 10% em todos os distritos **não demonstra conformidade** com essa regra.

Municípios ausentes do Censo 2022 usam uma estimativa pela razão população/eleitorado dos municípios conhecidos da circunscrição, com aviso no ETL. Na base atual, isso ocorre com Boa Esperança do Norte (MT, código 5101837). Mudanças territoriais posteriores ao Censo não são reconciliadas com setores censitários; os totais dessa área não devem ser tratados como uma contagem demográfica atualizada. Não há fallback de população quando toda a circunscrição está sem referência censitária: o ETL falha.

### 5.2 Grafo

1. **Átomos.** Nos estados, cada município até meia cota é um átomo; os maiores viram um átomo por coordenada de local de votação. Nas cidades, cada local de votação é um átomo.
2. **Arestas.** Uma única triangulação de Delaunay de todos os átomos. Entre municípios diferentes, a aresta é aceita quando são vizinhos na malha do IBGE (vizinhos que a triangulação não liga recebem a aresta entre o par de átomos mais próximo). Dentro do município, descartam-se arestas maiores que 6× a mediana; a distância é apenas uma heurística, não detecta baías, serras ou represas. Locais isolados voltam a se ligar ao próprio município pelo par mais próximo. Componentes ainda separados, como ilhas, também recebem ligações de proximidade. A conectividade vale para esse grafo aumentado, não para todos os recortes geográficos possíveis.
3. **Coordenadas dos locais.** Locais sem coordenada recebem a do mesmo local na eleição de referência (2026), depois o centro do bairro e, por último, o da zona. Coordenadas genéricas (o mesmo ponto para locais de bairros diferentes, marcador do cadastro do TSE) e coordenadas fora do polígono do município são descartadas.

### 5.3 Partição

1. **Bisseção recursiva por árvore geradora** (como o `recursive_tree_part` do GerryChain/MGGG): sorteiam-se árvores geradoras mínimas, com arestas que cruzam municípios, regiões ou bairros mais caras, e corta-se a aresta cujos dois lados têm a população certa para o número de distritos de cada lado, preferindo o corte mais compacto e que menos divide grupos. Os dois lados são sempre conexos.
2. **Recombinação** (como o ReCom do MGGG): distrito fora da meta é unido a um ou dois vizinhos e o conjunto é redividido, deslocando o excesso de população ao longo de cadeias.
3. **Busca local:** move átomos de fronteira entre distritos vizinhos enquanto isso reduz a função-objetivo (desvio, com penalidade forte acima de 5%, + compacidade + coesão), sem desconectar distrito algum.
4. **Novas tentativas:** se o pior desvio de um estado passar de 8%, o desenho é refeito permitindo dividir municípios menores (acima de 1/4 e depois de 1/10 da cota). Ex.: no Amapá, Oiapoque sozinho fica a −10% da cota e somado a Calçoene passa de +15%.

**Resultado da última execução:** 130 desenhos (puro e misto × 65 casas), nenhum distrito fora de ±10%; maior desvio de 8,2% (Rio de Janeiro, 51 distritos), seguido de 7,3% (Alerj, 35) e 7,0% (Amapá, 24); 61 desenhos inteiramente dentro de ±5%.

**Verificação:** todos os 130 desenhos persistidos foram reproduzidos a partir dos arquivos TSE/IBGE usados pelo ETL. A geração verifica cobertura dos átomos, número de distritos e conectividade de cada grupo no grafo. `npm run data:validate` verifica índices, locais, população finita/positiva por distrito e o limite de desvio. Isso valida invariantes do modelo, não uma divisão eleitoral oficial nem uma amostra estatística de todos os mapas possíveis.

### 5.4 Votos por distrito

A votação **utilizada neste ETL para estados** é agregada por município e zona eleitoral. Quando uma zona de um município dividido fica em mais de um distrito, seus votos são repartidos na proporção dos eleitores dos locais de votação de cada parte. Nas cidades, a unidade é o local de votação (votos por seção, ver 3.4), e cada local pertence a um único distrito.

### 5.5 Comparação com outros desenhos

| Simulação                                                                                             | Peso                                        | Unidade                                                                 | Tolerância                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| [HubPolítico](https://hubpolitico.com.br/distrital)                                                   | população (Censo 2022)                      | múltiplos mapas; unidade não detalhada na página citada                 | ±5%, exceções do PLS até ±10% |
| [Radar do Voto](https://radardovoto.com/voto-distrital)                                               | eleitores                                   | municípios e regiões do IBGE; locais de votação nas cidades             | 10%, 15% ou 25%, selecionável |
| [Ranking dos Políticos](https://ranking.org.br/artigos/simulacao-voto-distrital-misto-congresso-2026) | eleitores                                   | municípios pequenos inteiros (algoritmo não detalhado)                  | não informada                 |
| **VotoBrasil**                                                                                        | população municipal e estimativas por local | municípios divisíveis acima de meia cota, com novas tentativas até 1/10 | meta **±5%**, limite **±10%** |

Outro desenho que cumprisse os mesmos critérios poderia eleger outros candidatos nos distritos disputados; por isso o mapa e o desvio de cada distrito são exibidos junto com o resultado. Regras de votação, compensação e excedentes também diferem entre simuladores: proximidade dos totais de cadeiras não é uma validação independente dos distritos.

## 6. Indicadores

- **Desproporcionalidade de Gallagher** (mínimos quadrados): 0 = cadeiras exatamente proporcionais aos votos.
- **Número efetivo de partidos** (Laakso–Taagepera), 1/Σp², calculado sobre a distribuição de cadeiras.
- Partidos com cadeira, partidos necessários para a maioria, maior bancada e percentual de votos que não elegeram ninguém.

Os votos de cada partido somam votos nominais dos seus candidatos e votos de legenda atribuídos ao partido.

## 7. Validação contra o resultado oficial

Para garantir que o motor de apuração é fiel, o ETL reaplica as regras de **lista aberta** (quociente eleitoral, quociente partidário e sobras por maiores médias) a todas as áreas e compara com os eleitos oficiais do TSE. O resultado fica em `validation.json` e é exibido na página de metodologia.

Resultado da última execução do ETL (dados 2026 e 2024):

| Conjunto de regras testado                                                                                                                          | Áreas exatas | Eleitos divergentes |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------- |
| **Lei 14.211/2021**: quociente partidário, barreira de 10% do QE por candidato e, nas sobras, partidos com ≥ 80% do QE e candidatos com ≥ 20% do QE | **65 de 65** | **0**               |
| Variante testada: todos os partidos disputam as sobras, mantida apenas a barreira individual de 10% do QE                                           | 43 de 65     | 40                  |

As 65 áreas são as 27 bancadas na Câmara dos Deputados (uma por UF), as 27 Assembleias/Câmara Legislativa e as 11 Câmaras Municipais. O motor usa as regras que reproduzem o resultado oficial sem nenhuma divergência. O ETL escolhe o conjunto com menos divergências e grava o resultado em `validation.json`; a página de metodologia mostra o relatório, com a lista de áreas inexatas (vazia hoje).

Além disso, o ETL confere, para cada uma dessas 64 áreas, que a soma de votos nominais e de legenda coincide **exatamente** com os votos válidos publicados pelo TSE (`detalhe_votacao_munzona`), e interrompe o build se houver diferença. O comando `npm run data:validate` repete essas conferências sobre os arquivos gerados (cadeiras = eleitos oficiais, eleitorado = soma das unidades, coordenadas dentro do Brasil, votos por unidade = votos totais).

## 8. Limitações conhecidas

- **Um voto por eleitor:** o simulador usa os votos nominais e de legenda como foram dados. Em sistemas com dois votos (misto) o eleitor poderia dividir o voto entre distrito e lista; isso não é modelado.
- **Zonas, não seções (estados):** os votos por candidato são publicados por zona; nos municípios divididos, a repartição de uma zona entre distritos é estimada pelos eleitores de cada parte (5.4).
- **Candidaturas e coligações:** em sistemas distritais, o número de candidatos e as alianças mudariam. A simulação mantém as candidaturas de 2026/2024.
- **Cadeiras fixas, exceto excedentes:** a quantidade de cadeiras por circunscrição é a real (513 na Câmara dos Deputados); no distrital misto, as cadeiras excedentes da PEC podem ampliá-la.
- **Distritos hipotéticos:** o desenho segue critérios objetivos (5.1), mas é um entre muitos possíveis; em distritos disputados, outro traçado pode mudar o vencedor.
- **Câmaras municipais:** apenas as cidades com 1 milhão de eleitores ou mais (11 em 2024); Brasília não tem eleição municipal.
