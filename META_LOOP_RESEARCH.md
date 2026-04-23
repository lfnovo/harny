# Meta-Loop Research — A disciplina de mover decisões do código para a especificação

Documento de pesquisa em modo **discovery**. Não é spec, não é roadmap. É material de discussão para orientar uma série de features do harny — incluindo a próxima leva de Skills para Claude Code.

O que está aqui está sujeito a revisão a qualquer momento. Onde há incerteza, ela é marcada explicitamente em seções `Dúvida em aberto` e `Pontos de validação`.

---

## 0. Como ler este documento

- **Seções 1-3** definem a alma do projeto. Tudo que vem depois decorre disso.
- **Seções 4-8** são o corpo analítico: categorias de drift, arsenal, dimensões que antes estavam ausentes.
- **Seções 9-11** são explicitamente abertas: dúvidas, validações pendentes, conexões com features em planejamento.

A ordem foi escolhida para que decisões práticas nunca precedam a clareza sobre o que estamos tentando fazer.

---

## 1. Tese central — o que o harny é de verdade

> **O harny não é uma ferramenta de automação. É uma disciplina para mover decisões do código para a especificação. A automação é o subproduto — o que acontece depois que uma decisão foi entendida com clareza suficiente para virar docs, critérios, padrões.**

Sem o entendimento, automatizar é apenas congelar confusão.

### 1.1 O dev que o harny produz

Depois de tempo suficiente de uso, o dev muda. A contribuição intelectual dele sobe de nível:

- Para de pensar em *"como centralizo essa div"* e *"como refatoro essa assinatura"*.
- Passa a pensar em *"o que escala"*, *"isso está no lugar certo"*, *"existe uma abstração?"*, *"este critério de decisão está claro?"*
- Troca **"como"** por **"por quê"**.

O dev que fica com o harny é o dev que **não se assusta com essa mudança** — o que embarca nela. Quem continua querendo fazer a correção tática no detalhe não é o público do produto.

### 1.2 O modo de falha mais grave

Não é um run que deu errado. É um dev que usa o harny durante meses e **não evolui** — que continua fazendo correção tática, que deixa o harny automatizar tudo mas fica no mesmo lugar cognitivo.

Quando isso acontece, o produto automatizou, mas não **educou**. É falha do harny, não do dev.

Este critério precisa guiar decisões de produto tanto quanto métricas de eficiência.

### 1.3 Workflow como composição de etapas quality-contributing

O harny não é um pipeline fixo com uma gate de validação no final. É uma **composição de etapas**, cada uma contribuindo com qualidade mensurável ao run.

Etapas podem ser de muitas naturezas: planning, implementação, code review, validação, documentação, ai-dev-support (geração de arsenal para agentes), e outras que ainda vamos descobrir. Cada projeto compõe suas etapas de acordo com o que precisa.

O threshold de qualidade de um run não é o veredicto de uma etapa única. É a **combinação** da qualidade aportada por cada etapa ao longo do pipeline. Qualquer etapa pode ser uma gate de qualidade — não existe uma "etapa especial" privilegiada. A composição é que define o perfil de confiabilidade do workflow.

---

## 2. A jornada, não a tensão

A discussão "automação total vs. humano no controle" é uma falsa dicotomia. Não é um dial, é uma **trajetória**.

Cada peça do workflow passa por três estágios:

1. **Entender decisões** — o humano estuda, define critérios, refina.
2. **Automatizar o que está pronto** — critério claro o suficiente para virar código/prompt/validação.
3. **Delegar o que ainda exige julgamento** — o agente decide, o humano aprova em pontos estratégicos.

### 2.1 "Only where necessary"

O princípio operacional: **não automatize pelo ato de automatizar**. A postura é quase *anti-automação disfarçada de pró-automação*:

- Automatize o que está maduro.
- Delegue o que ainda exige julgamento.
- Mantenha humano nas decisões ainda em aberto.

Forçar um passo antes da hora congela confusão. Atrasar um passo que já está maduro desperdiça o humano em trabalho tático.

### 2.2 Maturidade por peça do workflow

Cada peça do workflow de um projeto tem uma maturidade própria:

```
human decide → human aprova → automatizado
```

O harny não tem um único nível de automação — ele tem um **gradiente** aplicado peça por peça. A arte é saber graduar na hora certa: nem antes, nem depois.

### 2.3 A composição também gradua

A maturidade não vive só nas peças individuais. A própria **composição do workflow** também amadurece. Projetos imaturos tendem a adicionar etapas extras de checagem (code review explícito, docs gate, validador mais estrito) porque o arsenal ainda não é confiável. Projetos maduros podem simplificar — peças graduadas para automatizado dispensam checagens redundantes.

Composições típicas podem variar pelo tipo de task e nível de risco:

- **`feature-dev-quick`**: planner → coder → validator
- **`feature-dev-high-stakes`**: planner → coder → code-review → validator → docs → ai-dev-support
- **`refactor-safe`**: planner → coder → test-coverage-review → validator

A própria composição vira um knob. Mudar composição é uma ação da meta-loop tanto quanto mudar prompts.

> **Dúvida em aberto:** como explicitar essa maturidade no sistema? Um registro por peça no `harny.json`? Tags no workflow? E como sinalizar "esta peça está pronta para graduar"? Isso precisa ser observável tanto pelo humano quanto pelo harny.

### 2.4 Tipos de nodes disponíveis

Uma composição é feita de **nodes** (etapas). Nem todos os nodes têm a mesma natureza. Agrupando por função:

| Grupo | Exemplos | Natureza |
|---|---|---|
| **Upstream** | pre-planner, discuss-with-user, requirement-clarifier | Refinam intenção antes de executar |
| **Planning** | planner, post-planner, task-splitter | Transformam intenção em estrutura executável |
| **Generation** | coder, designer, docs-writer | Produzem artefato |
| **Review AI-driven** | code-reviewer, security-gate, tester AI, docs-reviewer | Julgam com certo grau de subjetividade |
| **Review determinístico** | lint, unit tests, type-check, coverage-check, SAST scanner | Binário: passou ou não |
| **Meta / post-execution** | ai-dev-support, arsenal-audit, learnings-writer | Geram arsenal a partir do que aconteceu |

A lista não é fechada — projetos vão inventar nodes próprios. O ponto é que **cada grupo tem propriedades diferentes na função objetivo**:

- Nodes determinísticos não têm assertividade (são pass/fail). Baratos e previsíveis. Quando bem-desenhados, graduam rápido.
- Nodes AI têm a tripla completa (qualidade, assertividade, custo). Mais caros e mais subjetivos.
- Nodes humanos (approval, discuss-with-user) emitem a tripla de forma ainda não resolvida — design UX, não só de código.

> **Direções em aberto:**
> - Um catálogo central de nodes reutilizáveis entre projetos? Registry com contratos default?
> - Projetos definem nodes próprios facilmente ou só consomem do catálogo?
> - Vale bias para nodes determinísticos sempre que possível, pelo custo baixo? Ou isso engessa decisões que não cabem em regra?
> - Nodes de grupos diferentes podem ter modos de agregação diferentes na tripla do run (§6.1.7)?

---

## 3. A meta-loop como espelho externo

A meta-loop não é só "o harny aprende com runs passados". Ela é o **espelho externo da operação mental que o dev aprende a fazer**.

Toda vez que o dev, diante de uma falha, troca a pergunta de:

> *"Como eu conserto isso?"*

para:

> *"Onde eu deveria ter especificado, documentado, ilustrado melhor para que essa correção não fosse necessária?"*

...ele está rodando a meta-loop dentro da cabeça.

**A ferramenta ensina a disciplina ao forçar o ritmo.** Ao externalizar esse loop — capturar observações, categorizar drift, propor upgrades no arsenal — o harny faz o dev praticar involuntariamente a habilidade que o eleva.

### 3.1 Por que isso muda tudo

Cada feature do harny deve ser avaliada por duas perguntas:

1. **Reduz drift no próximo run?** (eficiência imediata)
2. **Convida o dev a fazer a pergunta certa no momento certo?** (evolução cognitiva)

Features que resolvem #1 sem contribuir para #2 são armadilhas de longo prazo. Produzem eficiência no curto, estagnação no longo.

> **Dúvida em aberto:** como o harny conversa com o dev nos momentos de falha de forma que convide à reflexão meta, em vez de só resolver? Relatório pós-run? Prompts diagnósticos no review? Skill dedicada?

### 3.2 Meta-loop inline e meta-loop externa

O mesmo mecanismo — observar execução, categorizar drift, propor melhorias — pode operar em dois pontos:

**Meta-loop externa**: fora do run, agregando sinais entre runs. Propõe upgrades de arsenal, composição, prompts. Opera em escala de dias/semanas. É o uso clássico.

**Meta-loop inline**: dentro do run, como uma etapa do próprio workflow. Exemplo concreto: uma etapa `ai-dev-support` que, depois do dev concluir, observa o que o dev enfrentou durante a execução, propõe docs e exemplos para agentes, e cristaliza no projeto antes do run terminar. Opera em escala do próprio run.

As duas não são mutuamente exclusivas — são pontos de aplicação diferentes do mesmo padrão. Inline captura lições do run atual imediatamente. Externa acumula padrões entre runs que só aparecem em agregado.

> **Dúvida em aberto:** qual a divisão de trabalho ótima entre as duas? Hipótese inicial: inline cuida de padrões locais ao run atual; externa cuida de padrões cross-run e cross-project. Validar com uso real.

---

## 4. Onde os problemas aparecem — categorias de drift

Toda falha ou ineficiência em um run autônomo se encaixa em uma das quatro famílias abaixo. A categoria determina **onde mora o fix**, e portanto quem/como deve agir.

### 4.1 Caso de uso específico *(fix: melhorar o input daquela rodada)*

Problemas que vivem no input do run e não reaparecem sistemicamente.

- Requisito não foi claro ou está incompleto.

**Quem corrige:** o humano que submete o PRD.

**Cauda longa.** Sempre vai existir. Não é otimizável sistemicamente, mas **é o input mais alto da cadeia** — ver seção 6.3.1 sobre PRD quality como alavanca.

### 4.2 Setup do ambiente *(fix: construir infra, docs, ferramentas — beneficia todos os runs)*

Problemas sistêmicos do projeto que afetam qualquer run contra aquele codebase.

- Documentação faltando ou confusa.
- Infra ausente (serviço não sobe, acesso, API key).
- Sem forma de testar (testes ausentes, quebrados, lentos).
- Ferramenta faltando (MCP server, CLI tool).
- Falta de exemplos de padrões do codebase.
- Ambiente mudou entre runs (deps, serviços externos).

**Quem corrige:** o time que mantém o projeto. Fix estrutural e duradouro.

### 4.3 Configuração do workflow *(fix: tunar composição, prompts, parâmetros do harness)*

Problemas de como o pipeline executa. Aplicam-se a **qualquer etapa quality-contributing** — validação, code review, docs, ai-dev-support, etc. — não só à validator clássica.

- Etapa quality-contributing mal calibrada (leniente, estrita, feedback vago).
- Developer ou etapa anterior "passando" uma etapa sem resolver o problema real (gaming).
- Decomposição de tasks ruim (grandes demais, ordem errada, dependências ocultas).
- Critério de "done" não definido antes da implementação.
- Prompts do harness estagnados (escritos para outro modelo/codebase).
- Limites de iteração mal calibrados (`maxRetries`, `maxIterations`).
- Composição do workflow errada para o tipo/risco da task (etapas a menos quando deveria ter mais, ou vice-versa).

**Quem corrige:** quem mantém o workflow — via `harny.json`, overlays, ou a própria meta-loop propondo mudanças.

### 4.4 Confiabilidade do harness *(fix: o próprio harny precisa ser corrigido)*

Problemas que são responsabilidade do mecanismo de controle, não do input nem do workflow.

- Estado sujo de runs anteriores.
- Task além da capacidade do modelo no contexto disponível (o harness deveria ter detectado e decomposto).

**Quem corrige:** o harny. Falhas aqui erodem a confiança em todo o sistema; deveriam tender a zero ao longo do tempo.

### 4.5 Distribuição esperada (hipótese)

- **Setup do ambiente** domina no começo de um projeto com harny.
- **Configuração do workflow** cresce em peso à medida que o setup amadurece. Vira o alvo principal da meta-loop.
- **Caso de uso específico** é a cauda longa.
- **Confiabilidade do harness** deveria tender a zero.

> **Ponto de validação:** quando tivermos observabilidade suficiente (state.json + transcripts + Phoenix), devemos classificar cada run por categoria e verificar se essa distribuição se confirma, ou se a realidade é outra.

---

## 5. O arsenal — o que dar aos agentes

O arsenal é o conjunto de insumos que reduzem **ambiguidade de interpretação** e **custo de descoberta** durante a execução.

> **Princípio unificador:** tudo que o agente precisa descobrir sozinho é tempo, tokens e risco de erro.

### 5.1 Como o arsenal se relaciona com a tese

Cada item de arsenal é uma **decisão que graduou** — que saiu do "humano decide caso a caso" e virou docs, hook, lint, fixture, skill. O arsenal é a **memória institucional cristalizada** das decisões que o projeto já entendeu.

Arsenal ruim = decisão mal entendida, congelada em código. Por isso o arsenal não é só "adicionar coisas"; é manter o que serve e remover o que não serve mais (ver 6.2).

### 5.2 Inventário

#### Feedback imediato durante execução
- Claude Code hooks específicos por parte do código — checando, lintando, validando em tempo real.
- Linters customizados que enforçam padrões de design do projeto (não só estilo genérico).
- Observabilidade durante execução — logs estruturados que o próprio agente consulta.

#### Contexto tailored
- Pedaços de contexto pensados para o desafio (não blob de docs genérico).
- Documentação na granularidade certa.
- Clareza de padrões, dos and donts explícitos.
- Exemplos canônicos ("golden files").
- ADRs / decision records.
- Mapa de dependências entre módulos.
- Lista de "gotchas" do projeto.

#### Testabilidade
- Testes rápidos, de qualidade, assertivos — liberam agente e etapas de review para iterar.
- Fixtures e seed data prontos.
- Health check scripts.

#### Ferramentas
- Tools específicas por etapa (ex: Playwright MCP para front-end).
- Types gerados automaticamente de APIs/banco.
- Interface contracts (OpenAPI, GraphQL schema).

#### Setup e operação
- Scripts de setup do ambiente.
- Runbooks para operações comuns.
- Scope boundaries explícitos.
- Reversibility signals.

#### Meta-awareness do agente
- Budget awareness (quantas tentativas restam).
- Sinais de incerteza emitidos pelo próprio agente (ver 6.5).

### 5.3 Skills como mecanismo de entrega

A série de Skills para Claude Code que o harny vai lançar é **um dos principais mecanismos de entrega do arsenal**. Uma Skill empacota um pedaço de arsenal (hook, runbook, padrão de review, template de PRD) em formato consumível pelo dev.

> **Dúvida em aberto:** quais Skills são prioridade? Mapear o arsenal listado acima contra o formato Skill e identificar as mais alavancadas. Provável candidato forte: uma Skill para *PRD-authoring*, dado o peso da seção 6.3.1.

---

## 6. Dimensões que faltavam no esqueleto anterior

### 6.1 O que medimos — função objetivo

A meta-loop não opera sem uma função objetivo clara. A formulação que emergiu:

#### 6.1.1 Hierarquia de otimização

1. **Qualidade** é piso, não objetivo. Não existe trade-off abaixo do piso — a barra precisa ser alta o suficiente para se confiar no output de agentes sem revisão tática manual.
2. **Tempo desperdiçado** é a função objetivo principal, acima do piso.
3. **Custo** em tokens é constraint operacional, não objetivo. Só aparece quando duas opções entregam qualidade e tempo equivalentes.

#### 6.1.2 Qualidade como sinal composto — a tripla por etapa

Qualidade do run emerge da composição das etapas, não do veredicto de uma única gate. Cada etapa contribui com uma tripla mensurável:

- **Qualidade aportada** ao output final.
- **Assertividade** — quão certa a etapa está do que entregou (sinal de incerteza intrínseco).
- **Tempo/custo** que gastou.

O threshold do run é a combinação dessas triplas. Cada etapa é um contribuinte mensurável, não uma checkbox. Isso vale para qualquer natureza de etapa.

> **A razão de o harny escrever workflows inspecionáveis é exatamente essa**: queremos saber qualidade, assertividade e tempo gasto **por etapa**. Sem granularidade por etapa, não há função objetivo operável — é tudo qualitativo.

##### O que cada dimensão significa muda por tipo de node

"Qualidade aportada" não é a mesma coisa para todos. Pro planner, é qualidade da decomposição. Pro coder, aderência ao que foi pedido. Pro reviewer, perspicácia de catches. Pro designer, coerência visual. **Sem um contrato explícito por tipo de node, as triplas não são comparáveis.**

Aponta para uma possível necessidade: cada tipo de node teria um **contrato** — o que entrega, em que dimensões pode ser avaliado, com que rubric. Um `node-contract` por tipo de node, virando arsenal de primeira ordem.

> **Direções em aberto:**
> - Contrato vive no catálogo de nodes (§2.4) ou configurável por projeto?
> - Contratos também podem ser versionados e graduar ao longo do tempo?
> - Sprint contracts (paper Anthropic) são caso particular — negociados antes de executar. Vale adotar o mesmo padrão ou é complexidade a mais?

##### Qualidade × assertividade é a distinção crítica

Não são a mesma coisa. Uma etapa pode entregar output ruim com alta certeza (errou confiante), ou output bom com baixa certeza (acertou no chute).

| Qualidade | Assertividade | Diagnóstico |
|---|---|---|
| Alta | Alta | Etapa confiável — candidata a graduar (§2.2) |
| Alta | Baixa | Acertou no chute — instável, vai falhar em task diferente |
| Baixa | Alta | Over-confident errada — **categoria mais perigosa** para a filosofia throwaway |
| Baixa | Baixa | Etapa consciente do limite — investigar: arsenal gap ou task fora da capacidade |

A célula "over-confident errada" é a que mais ameaça a filosofia throwaway (§6.1.4). A etapa aprova com firmeza algo ruim, e o dev confia no sinal. **A meta-loop precisa caçar essa célula ativamente.**

##### Como extrair assertividade — várias vias possíveis, nenhuma exclusiva

- **Auto-reportada**: via structured output do próprio node (ex.: "confidence: low | medium | high" por item entregue).
- **Inferida por comportamento**: número de hesitações, tentativas, ratio thinking/action no transcript.
- **Derivada por consistência**: roda a mesma etapa N vezes — sai a mesma coisa?
- **Validada por etapa posterior**: coder disse "certo", reviewer derrubou → assertividade do coder estava errada. **Sinal ouro** porque é observado, não declarado.

Provavelmente a meta-loop consolida múltiplas fontes em um score. Cada via tem custo e confiabilidade diferentes.

##### Calibração de assertividade ao longo do tempo

Um conceito que emerge diretamente: se em 100 runs o planner disse "alta certeza", quantos realmente deram certo downstream? Se acertou 70%, o planner está **over-confident por 30 pontos**. Calibração é aprendível, trackável, e provavelmente diferente por tipo de task e por área do codebase.

Uma etapa bem-calibrada é aquela cuja assertividade declarada bate com a qualidade observada depois.

> **Direções em aberto:**
> - Calibração tracked por node? Por tipo de task? Por área do codebase? Por combinação? Granularidade fina tem custo.
> - Calibração ruim é input para: retreinar prompt? trocar modelo? adicionar arsenal? Cada mitigação pesa diferente.
> - Calibração é comparável entre projetos, ou é idiossincrática?

#### 6.1.3 Taxonomia de tempo desperdiçado

Nem todo tempo é desperdício. Tempo junto entre humano e AI em decisões de design, tempo do humano escrevendo PRD, tempo iterando o próprio workflow — tudo isso produz valor. A meta-loop não reduz tempo globalmente; ela **move tempo da coluna desperdiçada para a coluna que produz valor**.

| Tipo de desperdício | Natureza do custo | Mitigação |
|---|---|---|
| AI esperando humano em decisão já decidida | Oportunidade | Codificar: ADRs, patterns, rules |
| AI esperando humano em decisão decidível por teste | Oportunidade | Testes determinísticos como gate |
| AI em retrabalho por falta de entendimento | Tokens + tempo | Arsenal (contexto, exemplos, hooks) |
| AI em retrabalho por prompt mal-calibrado | Tokens + tempo | Tuning do workflow |
| Humano revisando output de baixo sinal | Atenção humana (o recurso mais escasso) | Trust signals + calibração de review |
| Humano corrigindo decisão que foi tomada errada | Atenção + retrabalho | PRD quality upstream |

Tempo que **não** é desperdício (e o harny não deve tentar eliminar):

- Humano escrevendo PRD (investimento upstream).
- Humano em colaboração em decisões de design de verdade.
- Humano iterando o próprio workflow.
- Humano fazendo review quando há incerteza legítima.

#### 6.1.4 A filosofia throwaway e sua precondição

O produto assume que, se um run produziu resultado ruim, o dev pode **jogá-lo fora** sem contaminar o codebase. A perda é só tempo e tokens — nunca qualidade do projeto.

Isso só funciona se a **composição de etapas do workflow nunca deixa código ruim passar**. A confiabilidade da gate composta — cada etapa cumprindo seu papel — é **precondição para a filosofia throwaway funcionar**. Se qualquer etapa da composição vaza, o dev precisa voltar a revisar tudo a fundo, e o custo de atenção humana explode. A filosofia quebra.

Por isso a meta-loop observa não só se um run "passou", mas **quanto cada etapa contribuiu com qualidade e assertividade**. Uma etapa que aprova sem aportar é o sinal mais perigoso do sistema.

#### 6.1.5 Inspectability como precondição infraestrutural

`state.json`, transcripts, Phoenix spans — tudo isso não é "feature nice-to-have". É a **infraestrutura que sustenta a função objetivo**. Sem sinais granulares por etapa, não há como distinguir "etapa X contribuiu, etapa Y não", não há como medir desperdício por tipo, não há como validar as precondições da filosofia throwaway.

> **Dúvida em aberto:** trust threshold é um número por run, ou há thresholds diferentes por tipo de output (código de produção vs. docs auxiliares vs. testes exploratórios)? Um único piso pode estar calibrado errado para contextos diferentes.

#### 6.1.6 Emissão da tripla por tipo de node

Como a tripla é produzida depende da natureza do node:

- **Nodes AI** emitem via structured output — o Zod schema já é infraestrutura natural. Precisa só estender para incluir qualidade/assertividade auto-reportadas.
- **Nodes determinísticos** emitem via exit code + duration + (opcional) parser do output. Assertividade colapsa em 1.0 — é passou/não passou.
- **Nodes humanos** (approval step, discuss-with-user) emitem de forma ainda não resolvida. Form de feedback com score? Inferência por tempo gasto? Botões de confiança? Precisa design UX específico.

> **Direções em aberto:**
> - Vale padronizar um schema único de tripla emitido por todo node, independente do tipo? Ou cada tipo tem seu próprio formato e a meta-loop normaliza?
> - Nodes AI podem "mentir" na auto-reportada. Cruzar com sinais inferidos do transcript é mitigação — mas adiciona complexidade.
> - Node humano bem-desenhado pode virar feature de engajamento (dev se sente ouvido) ou de fricção (um form a mais). Depende inteiramente do UX.

#### 6.1.7 Agregação pro run — elo mais fraco, soma, ou outra coisa

A tripla do run inteiro **não é a soma simples** das triplas das etapas. Hipótese de trabalho:

- **Qualidade do run**: limitada pela etapa que menos aportou. Um coder brilhante não compensa um planner ruim.
- **Assertividade do run**: limitada pelo menor elo. Se qualquer etapa duvidou em parte significativa, o humano precisa revisar aquele trecho.
- **Custo do run**: soma.

Se a hipótese se confirma, a meta-loop **otimiza por bottleneck, não por média**. Melhorar etapa já boa rende pouco; melhorar a mais fraca rende muito.

> **Direções em aberto:**
> - "Elo mais fraco" é heurística boa para qualidade, mas pode não ser para assertividade — uma etapa pequena duvidando de algo irrelevante não deveria derrubar o run inteiro. Talvez "elo mais fraco ponderado por impacto".
> - Etapas eliminatórias (security-gate fail = run fail) não se encaixam em "elo mais fraco" — são gates booleanas. Dois modos de agregação por etapa: contributiva e eliminatória?
> - A agregação deve ponderar importância relativa do node? Planner fraco pesa mais que docs-writer fraco?
> - Pode fazer sentido ter múltiplas triplas agregadas (uma por dimensão de qualidade do run), em vez de uma só?

#### 6.1.8 O que a tripla destrava — direções abertas

Se a tripla for coletada de forma confiável ao longo do tempo, várias possibilidades surgem. Nenhuma fechada, todas conectam com outras partes do documento.

##### A tripla como mecanismo de graduação (§2.2)

Até aqui a maturidade era conceitual. A tripla dá sinal concreto:

> Uma peça pode graduar quando exibe, ao longo de N runs, qualidade alta + assertividade bem-calibrada + custo estável.

A §2.2 deixa de ser escada subjetiva e vira **regime de graduação baseado em evidência**. A meta-loop passaria a propor: "peça X está pronta para mover de aprovação → automatizada", com justificativa mensurável.

> **Direções em aberto:**
> - N mínimo de runs para graduar com confiança estatística? Varia por tipo de node?
> - Graduação é proposta sempre humana-aprovada ou pode ser automática em alguns casos?
> - E a degraduação? Peça automatizada que começa a degradar — como detectar e reverter?

##### A tripla como detector localizado de gap de arsenal

Onde a assertividade do coder cai de forma recorrente, o arsenal está furado naquela área. Se o coder mostra assertividade média em runs que tocam auth, a meta-loop pode localizar: "perdendo X% de qualidade recorrente em auth; ADR ou golden file resolveria".

Meta-loop em modo **diagnóstico localizado**, não genérico.

> **Direções em aberto:**
> - Localização exige ligar sinais de assertividade a caminhos do codebase. Rastreamento mais fino que o atual.
> - O diagnóstico é só sugestão ao humano ou pode virar arsenal automaticamente via meta-loop inline?
> - Pode haver falsos positivos — uma área difícil por natureza vai sempre parecer "com gap". Distinguir dificuldade intrínseca de gap real.

##### A tripla como input para composição dinâmica (§2.3)

Se o harny tem histórico de que o coder é pouco assertivo em tasks de DB, pode **adicionar code-reviewer automaticamente** quando a task toca DB. Ou sugerir. Composição deixa de ser estática e passa a ser roteada pela tripla histórica.

> **Direções em aberto:**
> - Composição dinâmica pode virar caixa-preta — dev não entende por que o harny adicionou etapa. Explicabilidade é requisito.
> - Existe risco de instabilidade: composição muda run a run, dev não consegue se calibrar no fluxo.
> - Quando sugerir vs quando aplicar automaticamente? Depende do perfil de risco da task? Do dev?

##### A tripla como base para trust signals ao revisor (§6.5)

Trust signals que o revisor humano usa para calibrar atenção são, no fundo, a assertividade agregada do run ou de etapas específicas. Mesma infraestrutura serve os dois fins — meta-loop e review.

> **Direções em aberto:**
> - Quanta granularidade mostrar ao revisor? Triplas completas podem ser ruidosas; um resumo interpretado pode ocultar informação útil.
> - Trust signal do revisor tem que bater com a experiência do revisor. Se o harny diz "alta certeza" e o revisor descobre bug, o trust no trust signal cai.

### 6.2 O que agregamos — cross-run e temporal

O valor real da meta-loop externa é **entre runs**, não em runs isolados.

- **Detecção de padrões recorrentes**: o mesmo drift apareceu em 7 runs? Está concentrado em que parte do codebase?
- **Manutenção do arsenal**: hooks e docs ficam stale. A meta-loop precisa detectar arsenal não usado e propor remoção — não só adição. Arsenal também sofre entropia.
- **Cross-project learning**: padrões de um projeto são candidatos em outro. Como compartilhar sem vazar código privado?
- **Cold start**: projeto novo sem histórico harny. Arsenal-bootstrap? Templates? Skills default?

> **Ponto de validação:** rodar a meta-loop com dados reais de N projetos e verificar se padrões cross-project emergem, ou se cada projeto é idiossincrático demais para essa transferência funcionar.

### 6.3 Onde o humano entra — dois momentos subestimados

#### 6.3.1 PRD quality — a alavanca mais alta da cadeia

A categoria 4.1 (requisito não claro) foi tratada como cauda longa, mas o PRD é o input mais alto. Melhorar a qualidade do PRD tem leverage enorme:

- Templates de PRD por tipo de task (feature, bug, refactor, docs).
- Agentes de clarificação pré-execução — perguntam antes de começar.
- Checklist de "intent completeness" — prova que o pedido está completo antes de virar run.
- Skill dedicada a escrever PRDs (candidata forte para a série Skills).

#### 6.3.2 PR review — feedback supervisionado de ouro

O que o humano corrige, reverte ou comenta no PR é o sinal mais puro de "o que o harny não pegou". A meta-loop precisa consumir isso:

- Diff entre o que o developer entregou e o que o humano deixou no merge.
- Comentários de review categorizados (é drift? é preferência? é novo requisito?).
- Reverts pós-merge como sinal altíssimo (o run passou por todas as gates e ainda errou).

> **Dúvida em aberto:** como capturar sinais de PR review sem fricção para o humano? Hook no `gh`? Parser de comentários? Step explícito pós-merge no harny?

### 6.4 Meta-loop como sistema adversarial

Goodhart's Law se aplica à própria meta-loop. Se ela otimiza para "etapa X aprovou", o workflow evolui para gaming dessa etapa.

- **Oracles por etapa**: runs com resposta conhecida não validam só "a validação final"; validam cada etapa quality-contributing. Um oracle que passa pelo planner mas falha no code-review revela calibração ruim do planner, não do code-review. Cada etapa pode e deve ter seus próprios oracles.
- **Anti-padrões explícitos**: a meta-loop pode sugerir arsenal que piora o sistema (mais docs confusas, mais hooks ruidosos). Precisa de mecanismo para recusar propostas ruins.
- **Propostas explicáveis**: o humano precisa confiar na sugestão. Cada proposta deve rastrear até os runs e etapas que a motivaram.

### 6.5 Calibração de confiança para o revisor humano

Se um dev precisa revisar 10 PRs do harny por dia, ele não pode ler todos com profundidade igual. O harny deveria sinalizar:

- *"Altíssima confiança — review rápido."*
- *"Fiz X com certeza, Y com dúvida — vale olhar Y."*
- *"Entrega completa mas não rodei cenário Z — verifique."*

Isso conecta com 6.3.2 — o review informado é de qualidade melhor, e o feedback que volta pra meta-loop também.

---

## 7. Tipo de task e o arsenal ideal

Tasks diferentes têm arsenals ideais diferentes. O documento inicial tratava tudo homogeneamente.

| Tipo de task | Arsenal mais alavancado |
|---|---|
| Bug fix | Reprodução automatizada, testes de regressão, mapas de dependência |
| Feature nova | PRD detalhado, golden files, ADRs, testes de aceitação |
| Refactor | Baseline de testes amplos, scope boundaries estritos, signals de reversibilidade |
| Docs | Exemplos canônicos, padrões explícitos, critérios de completude |
| Infra/config | Health checks, runbooks, ambientes de teste isolados |

> **Dúvida em aberto:** o workflow `feature-dev` atual é agnóstico a tipo de task. Vale ter workflows especializados (`bug-fix`, `refactor`, `docs`) com composições e arsenals default diferentes? Ou um só workflow que se adapta via detecção automática do tipo de task?

---

## 8. Paralelismo e operação em escala

Pouco explorado até aqui. Merece seção própria quando começarmos a rodar múltiplos harnys simultâneos em produção.

- Múltiplos runs simultâneos no mesmo projeto.
- Contenção de recursos (portas, DBs, API rate limits).
- Sibling-branch patterns — já existe guard mas pode precisar ser mais sofisticado.
- Ordem e dependência entre runs (um precisa do merge do outro).

> **Ponto de validação:** a demanda por isso só aparece quando o harny for adotado em equipes. Protelar aprofundamento até ter esse uso real.

---

## 9. Dúvidas em aberto (agregadas)

Lista consolidada das dúvidas marcadas ao longo do documento, para referência rápida:

### Sobre composição e nodes
1. Como explicitar maturidade do workflow peça por peça — e maturidade da composição? (§2.2, §2.3)
2. Catálogo central de nodes reutilizáveis vs nodes per-projeto? (§2.4)
3. Vale bias para nodes determinísticos sempre que possível? (§2.4)
4. Workflows especializados por tipo de task, ou um workflow adaptativo? (§7)

### Sobre a tripla
5. Contratos por tipo de node — parte do catálogo ou por projeto? Versionáveis? (§6.1.2)
6. Como extrair assertividade de forma confiável? Auto-reportada + inferida + validada downstream? (§6.1.2)
7. Calibração de assertividade — por node, task, área do codebase, ou combinação? (§6.1.2)
8. Schema único de tripla por todo node, ou um por tipo? (§6.1.6)
9. Como node humano emite a tripla sem virar fricção? (§6.1.6)
10. Agregação pro run — elo mais fraco, ponderado, com modo eliminatório separado? (§6.1.7)
11. N mínimo de runs para graduar uma peça com confiança estatística? (§6.1.8)
12. Composição dinâmica: sugerir vs aplicar automaticamente? Explicabilidade. (§6.1.8)

### Sobre o humano no loop
13. Como o harny conversa com o dev em falhas de forma que convide reflexão meta? (§3.1)
14. Divisão de trabalho ótima entre meta-loop inline e externa? (§3.2)
15. Trust threshold é um número por run ou múltiplos por tipo de output? (§6.1.5)
16. Como capturar sinais de PR review sem fricção? (§6.3.2)
17. Granularidade de trust signals ao revisor — resumo ou tripla completa? (§6.1.8)

### Sobre entrega
18. Quais Skills são prioridade? Mapear arsenal × formato Skill. (§5.3)

---

## 10. Pontos de validação — o que precisamos medir

Hipóteses que estão implícitas no documento e que precisam ser testadas empiricamente:

- **Distribuição de drift** (§4.5) se confirma com dados reais?
- **Cross-project learning** (§6.2) funciona ou cada projeto é idiossincrático demais?
- **PRD quality como alavanca** (§6.3.1) — quanto do drift some com PRDs melhores?
- **Trust signals** (§6.5) mudam a qualidade do review?
- **Dev evolution** (§1.1) — existe forma de medir que um dev está subindo de nível cognitivo ao usar o harny? Ou só qualitativa?
- **Precondição throwaway** (§6.1.4) — a composição das etapas realmente nunca vaza, ou há classes de erro que passam sistematicamente?
- **Elo mais fraco como heurística de agregação** (§6.1.7) — se sustenta, ou a média ponderada é melhor? Varia por projeto?
- **Assertividade auto-reportada vs validada downstream** (§6.1.2) — a assertividade declarada pelos nodes bate com o que se observa depois? Qual fonte é mais útil na prática?
- **Gap de arsenal localizado** (§6.1.8) — sinais de assertividade realmente se concentram em áreas específicas do codebase, ou é ruído?
- **Célula "over-confident errada"** (§6.1.2) — qual a prevalência real? Se é rara, é menos crítica. Se é comum, é a prioridade máxima da meta-loop.

---

## 11. Conexões com features em planejamento

### 11.1 Série de Skills para Claude Code

Contexto: harny está prestes a lançar uma série de Skills focadas no dev que usa Claude Code.

Skills são um mecanismo natural de entrega do arsenal (§5.3). Candidatos fortes a priorizar:

- **PRD-authoring** — ataca a alavanca mais alta (§6.3.1).
- **Drift-diagnosis** — ajuda o dev a categorizar o que deu errado em um run (convida a reflexão meta, §3.1).
- **Arsenal-audit** — inspeciona o arsenal atual do projeto e propõe o que remover (§6.2).
- **Review-calibration** — traduz trust signals do harny em guia de atenção para PR review (§6.5).
- **AI-dev-support** — etapa meta-loop inline que gera arsenal para agentes ao fim de cada run (§3.2).

> **Dúvida em aberto:** lista acima é especulativa. A priorização real depende de quais dores os primeiros usuários da série vão relatar. Vale usar este documento como guia mas validar com usuários antes de comprometer backlog.

### 11.2 Próximas seções do harny

Itens fora do escopo de Skills mas conectados a este documento:

- Sistema de métricas por etapa e dashboards (§6.1) — precondição para meta-loop operar.
- Captura de sinais de PR review (§6.3.2) — integração com GitHub.
- Arsenal-maintenance automático (§6.2) — detecção de entropia.
- Oracle runs por etapa (§6.4) — mecanismo de auto-validação do sistema.
- Composição dinâmica de workflow (§2.3) — knob explícito que a meta-loop pode ajustar.
- Catálogo de nodes com contratos default (§2.4, §6.1.2) — base para reuso entre projetos.
- Schema de tripla por node e emissão padronizada (§6.1.6) — infraestrutura para tudo que depende da tripla.
- Tracking de calibração de assertividade ao longo do tempo (§6.1.2) — precondição para graduação baseada em evidência.

---

## 12. Glossário operacional

Para evitar deriva de vocabulário em discussões futuras:

- **Arsenal**: conjunto de insumos (hooks, docs, fixtures, skills, runbooks) que reduzem ambiguidade e custo de descoberta durante a execução.
- **Assertividade**: quão certa uma etapa está do que entregou. Dimensão distinta de qualidade — dá origem à matriz qualidade × assertividade (§6.1.2).
- **Assertividade calibrada**: assertividade declarada que bate com qualidade observada downstream. Má calibração é feature da meta-loop capturar.
- **Composição**: sequência de etapas que compõem um workflow. A composição em si é um knob que gradua conforme a maturidade do projeto.
- **Contrato de node**: definição do que um tipo de node entrega, em que dimensões pode ser avaliado, com que rubric. Torna as triplas comparáveis.
- **Drift**: qualquer desvio entre o que o run entregou e o que era esperado — seja por falha, ineficiência ou retrabalho.
- **Etapa eliminatória**: etapa cujo fail derruba o run inteiro (ex.: security-gate). Agregação diferente de etapa contributiva.
- **Etapa quality-contributing**: qualquer etapa do workflow que contribui com qualidade mensurável ao output final. Não é uma categoria privilegiada — qualquer etapa bem desenhada contribui.
- **Função objetivo**: qualidade acima de um piso (não-negociável), tempo desperdiçado minimizado acima dele, custo como constraint.
- **Meta-loop externa**: mecanismo que observa runs passados entre si, categoriza drift, propõe upgrades. Opera em escala de dias/semanas.
- **Meta-loop inline**: etapa dentro do próprio workflow que captura lições do run atual e propõe arsenal imediatamente.
- **Maturidade do workflow**: estágio de cada peça (e da composição) na jornada `human decide → human aprova → automatizado`.
- **Node**: unidade atômica da composição de um workflow. Pode ser AI, determinístico ou humano. Ver §2.4 para taxonomia.
- **Over-confident errada**: célula da matriz qualidade × assertividade onde a etapa entrega ruim com alta certeza. A mais perigosa para a filosofia throwaway.
- **Tempo desperdiçado**: tempo que poderia ter sido evitado por codificação de decisão, arsenal, ou tuning. Distinguir de tempo que produz valor (colaboração, PRD, iteração do workflow).
- **Throwaway**: filosofia de que um run ruim pode ser descartado sem custo ao codebase. Depende da composição nunca vazar.
- **Tipo de node**: categoria funcional (upstream, planning, generation, review AI-driven, review determinístico, meta). Diferentes propriedades na função objetivo.
- **Tripla por etapa**: (qualidade aportada, assertividade, tempo/custo) — o sinal granular que cada etapa emite e que a meta-loop agrega.
- **Trust signals**: sinais de incerteza emitidos pelo próprio agente durante a execução, usados para calibrar atenção do revisor humano.
- **Oracle**: run de referência com resposta conhecida, usado para validar etapas quality-contributing. Pode ser por etapa, não só pelo resultado final.

---

*Documento iniciado em 2026-04-23. Modo discovery. Será revisado com frequência conforme features da série Skills e observabilidade da meta-loop forem tomando forma.*
