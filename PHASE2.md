# Phase 2 — Multi-workflow harness com HITL

Captura a visão, ordem de construção, dúvidas abertas e critérios de pronto para a próxima release. Pensado para ser puxado um tier por vez em sessões futuras.

Complementa (não substitui): `CLAUDE.md` (invariantes, gotchas, preferências) e `CHANGELOG.md` (o que já foi entregue).

---

## Por que Phase 2

Phase 1 entregou o loop single-workflow (planner → dev → validator) via CLI. Phase 2 generaliza isso em uma plataforma capaz de servir ao stack real de projetos do usuário, com múltiplas formas de iniciar e múltiplas formas de acompanhar.

---

## Necessidades do projeto

### Categorias de projeto

1. **OSS** (`~/dev/projetos/oss/*`) — mantenedor solo + comunidade.
2. **Supernova / consultoria** (`~/dev/projetos/snl/*`) — colaboração com membros da empresa.
3. **Pessoais** — investimentos, casa, contratos, pesquisa. Não é código tradicional mas segue mesma estrutura de tarefas.

### Tipos de workflow

- **Issue triage** — agente lê issue nova, pesquisa, decide (comentário, label, release, fechar). Trigger: webhook GitHub/Linear por issue, ou cron a cada 4h pro backlog.
- **Feature develop** — o harness atual. CLI pra coisas grandes; API pra coisas que chegam via webhook.
- **Bug fix** — investigate → write failing test → fix → validate.
- **Docs** — writer → reviewer.
- **Release / architecture** — **FORA DO HARNESS**. Feito direto no Claude Code pelo usuário.

### Formas de invocação

- **CLI interativo** — humano presente, responde perguntas inline, aprova tools no prompt.
- **API (local HTTP)** — POST para servidor local, headless, pode ou não aceitar interação via fila UI.
- **Webhook** — GitHub/Linear dispara workflow. Headless.
- **Cron** — processamento agendado de backlog. Headless.

### Modos de interação

- **Interativo** — aceita perguntas e approvals.
- **`--silent`** — agente adivinha com default, nunca para. Pra automação de alta confiança.
- **Headless com fila UI** — run pausa, estado persistido, humano destrava via web depois.

---

## Âncoras filosóficas (decisões já tomadas — não reabrir sem evidência)

1. **Workflows como sequência de fases-agente primeiro; DAG depois (talvez).** Passos determinísticos ficam expressos como instruções dentro do prompt do agente ("rode `npm test` e analise"). Nodes determinísticos reais só se a dor exigir.

2. **Archon = referência, não fork.** Copiar padrões (SSE+buffer, IsolationResolver, ApprovalNode, cost budget per step) mas manter codebase nosso. Forkar custa controle de direção + manutenção contínua.

3. **Invariantes do Phase 1 mantidas.** TS é sole writer dos artefatos de estado; sole committer; validator read-only; retry=resume, reset=fresh. `blocked` continua fatal **até Tier 3 chegar** — aí vira "pergunta humana via pending_questions".

4. **Observability (OpenTelemetry) fora de escopo** até eventual deploy em produção com stack de monitoring.

5. **Streaming mode NÃO é requisito.** Probe empírico (2026-04-20) confirmou hooks disparam em single mode apesar da doc afirmar o contrário. Single mode default; streaming só se capacidade futura comprovadamente exigir.

6. **SDK file checkpointing não é usado.** `git reset --hard <sha> && git clean -fd` cobre Bash, cross-session, diretórios — estritamente superior.

7. **Worktree como default de isolamento desde o início.** Execuções paralelas (3 webhooks simultâneos, por exemplo) não podem contaminar o git do repo principal. Dev machine (VM/remoto) fica pra depois; worktree resolve 80% dos casos com custo baixo (1-2 dias de trabalho) e trava o shape correto do registry.

---

## Mapa conceitual

```
    trigger (CLI | HTTP API | webhook | cron)
                  |
                  v
       +----------+-----------+
       | workflow manifest     |  (feature-dev, triage, bug-fix, docs)
       +----------+-----------+
                  |
                  v
       +----------+-----------+
       | sequência de fases    |  (agent phases com prompt + Zod schema)
       |  fresh ou loop        |
       |  approval opcional    |
       +----------+-----------+
                  |
      (pode pausar esperando humano)
                  |
                  v
       +----------+-----------+
       | run registry SQLite   |  estado compartilhado entre canais
       +----------+-----------+
                  |
                  v
       +----------+-----------+
       | consumidores          |  (CLI tail, Web UI, /improve externo)
       +----------+-----------+
```

**Workflow é shape. Run é instância. Registry é estado compartilhado. Canais são clientes finos.**

---

## Explicitamente fora do escopo

- Release workflow (usuário faz direto no Claude Code).
- DAG engine (pode vir depois).
- Streaming mode migration.
- SDK file checkpointing.
- OpenTelemetry observability.
- Web UI hospedada / multi-usuário.
- Fork do Archon.

---

## Tiers de implementação

---

### Tier 0 — Quick wins

**Objetivo:** Travar invariantes na máquina + começar captura de dataset pro `/improve`.

**O que entra:**
- 3 invariant guard hooks (PreToolUse):
  1. Validator nega Write/Edit/NotebookEdit (read-only).
  2. Developer nega Write/Edit em `.harness/<slug>/plan.json` (sole-writer).
  3. Developer nega Bash que matche `git (commit|push|reset|rebase|amend|--amend)` (sole-committer).
- Zod schema de problem annotations → `.harness/<slug>/problems.jsonl`. Categorias propostas: `environment | design | understanding | tooling` + severity + descrição livre.
- Atualização de prompts de dev/validator pra instruir a anotação.

**Por que primeiro:** Barato (horas). Guards previnem regressão em qualquer coisa depois. Problem annotations começam a acumular agora pra `/improve` ter meses de dados quando chegar.

**Dúvidas abertas:**
- Categorias são `{environment, design, understanding, tooling}` ou outra lista? Usuário mencionou "ambiente, design, entendimento" — é o conjunto inteiro?
- Problems do validator têm shape diferente dos do dev (ex: "acceptance criterion ambíguo")?

**Pronto quando:**
- Rodar o feature-dev atual dispara cada guard em probes negativos (teste dedicado).
- `problems.jsonl` é escrito com JSON válido por entrada, um problem por linha, e um CLI trivial (`harness problems tail <slug>`) mostra os últimos N.
- Prompts de dev/validator mencionam a anotação.

---

### Tier 1 — Workflow abstraction + isolamento por worktree

**Objetivo:** Generalizar o harness pra runner que aceita manifest de fases. Simultaneamente, estabelecer worktree como default de isolamento pra evitar contaminação de git em execuções paralelas.

**Approach (workflow):**
- `Workflow = { id, phases: Phase[] }`.
- `Phase = { name, promptTemplate, outputSchema, phaseConfig, loop? }`.
- `loop = { until: (phaseOutput, context) => boolean, maxIterations }` pro padrão dev/validator.
- Migrar feature-dev pra essa forma: `[planner, loop(developer, validator)]`.
- Adicionar template **issue-triage**: 1 fase, sem loop, input mínimo (issue payload), output estruturado (decisão).

**Approach (worktree):**
- `IsolationResolver` interface criada aqui (não esperar Tier 8).
- Provider `worktree` default: `git worktree add <path> -b <branch>` antes das phases; `git worktree remove <path>` no cleanup.
- `cwd` das phases = worktree path.
- `.harness/<slug>/` fica no **repo principal**, não no worktree (audit sobrevive cleanup).
- Provider `inline` mantido como escape hatch via `--isolation inline`.
- Precondição muda: deixa de exigir clean tree no principal; exige só que branch alvo não exista.

**Por que segundo:** Todo tier abaixo (registry, HITL, UI, cost) assume workflow shape. Worktree entra junto porque o registry do Tier 2 precisa armazenar `worktree_path` — fazer isso com registry já pronto vira migration desnecessária. Matar os dois coelhos na mesma cirurgia.

**Dúvidas abertas (GATING):**
- **Formato do manifest**: TS tipado com `defineWorkflow(...)` helper, JSON, ou YAML?
- **`until` predicate do loop**: closure inline (exige manifest TS) ou registry de predicates nomeados?
- **Output entre fases**: context object explícito, ou pipe estruturado nomeado?
- **Issue-triage input**: raw GitHub payload, ou extrair `{title, body, labels, url}` antes de entregar ao agente?
- **Worktree cleanup policy**: imediato no done, TTL (X dias) pra debug, ou só quando explícito?
- **Worktree commit flow**: orchestrator faz merge pro branch de destino no success, ou deixa pro usuário?
- **Path de `.harness/<slug>/`**: confirmar repo principal (atual) vs `~/.harness/<repo>/<slug>/` (fora do repo, mais limpo mas invisível)?

**Pronto quando:**
- `defineWorkflow(...)` descreve feature-dev em ~30 linhas.
- `--workflow feature-dev` produz comportamento idêntico ao atual (com worktree default).
- `--workflow issue-triage --input <issue.json>` produz decisão estruturada.
- Mesmo runner code path pra ambos; zero copy-paste.
- 3 runs simultâneos (3 terminais, 3 workflows) não colidem no mesmo repo.
- Worktree é criado no start, removido no done/failed; `.harness/<slug>/` no principal sobrevive.

---

### Tier 2 — Estado centralizado (run registry + pause/resume)

**Objetivo:** Estado persistido compartilhado entre canais. Permite multi-invocação + HITL persistido.

**Approach:**
- SQLite em `~/.harness/runs.db` via `better-sqlite3`. Schema:
  - `runs(id, workflow_id, cwd, status, started_at, ended_at, ended_reason, pending_question_id)`
  - `run_events(id, run_id, phase, event_type, payload_json, at)`
  - `pending_questions(id, run_id, kind, prompt, options_json, asked_at, answered_at, answer_json)`
- `run.status in (running | waiting_human | done | failed)`.
- Orchestrator escreve início/fim de fase, transições, perguntas/respostas.
- Pause/resume: quando fase emite `needs_user_input`, orchestrator parqueia, grava pergunta, retorna. Qualquer canal chama `resumeRun(runId, answer)`.

**Por que terceiro:** HITL exige pergunta persistida. Multi-invocação exige estado compartilhado. Construir HITL sem registry = máquina de estados ad-hoc que vira retrabalho.

**Dúvidas abertas:**
- JSONL de phase fica canônico (human-greppable) e registry guarda só ponteiros + summary? Meu voto: sim.
- Agente SDK permite parar limpo no meio de uma phase, ou só no fim? Precisa teste.
- Um run = um cwd. Workflows cross-repo (ex: meta task) — designar pra isso ou punt?
- Retenção: runs antigos (> 90 dias?) migram pra arquivo e somem do db?

**Pronto quando:**
- Rodar workflow via CLI cria linha em `runs` e streama eventos pra `run_events`.
- `harness ls --status waiting_human --cwd <path>` lista com filtro.
- Workflow que simula pergunta parqueia, persiste, retoma quando `harness answer <runId> <text>` é chamado.

---

### Tier 3 — HITL (perguntas + approvals)

**Objetivo:** Agente pergunta humano no meio do run. Humano aprova/nega tool uses sensíveis.

**Approach:**
- **Perguntas**: tool `askUser({prompt, options?})` que o harness implementa. CLI interativo → prompt inline. Headless → grava em `pending_questions`, parqueia.
- **Approvals**: `canUseTool` SDK + matchers configuráveis. Mesma mecânica CLI vs headless.
- **`--silent`**: agente recebe hint "silent=true, chute com default", não pergunta. Tools que exigem approval falham em silent (fail-closed).
- **`blocked` deixa de ser fatal** — vira "ask via pending_question" quando HITL existe.

**Por que quarto:** Registry pronto → pergunta persistível. Shape de workflow pronto → HITL integra como concern da phase, não cross-cutting. Precisa estar pronto antes de webhooks pra headless ter história real.

**Dúvidas abertas:**
- `canUseTool` vs `PreToolUse` hook: ambos denegam. Qual pra qual caso?
- Default policy: quais tools exigem approval out-of-the-box? Meu default: nenhum; usuário opta via harness.json.
- Timeout de `waiting_human`: expira depois de N horas? Fail ou fica dormindo?
- Prompt engineering: como o agente sabe quando perguntar vs. chutar? Hint "pergunte só se criterio de aceitação for materialmente ambíguo".

**Pronto quando:**
- Run CLI interativo com planner input ambíguo → pergunta inline → continua com resposta.
- Mesmo run `--silent` → procede com default.
- Mesmo run headless → pergunta em registry → `harness answer` destrava.
- Tool sensível (Bash com `rm -rf`) dispara approval em interativo e headless.

---

### Tier 4 — Multi-invocação (HTTP + webhooks + cron)

**Objetivo:** Disparar workflows de CLI, API HTTP, webhook GitHub/Linear, cron.

**Approach:**
- Servidor HTTP local (Hono) com rotas:
  - `POST /runs` — dispara (body: `{workflow, cwd, input, silent}`)
  - `GET /runs` — lista (filtros: status, workflow, cwd, data)
  - `GET /runs/:id` — detalhe
  - `GET /runs/:id/stream` — SSE de events live
  - `POST /runs/:id/answer` — resolve pergunta pendente
  - `POST /runs/:id/kill` — cancela
- Webhook adapter: `POST /webhooks/github`, valida assinatura HMAC, dispara issue-triage com payload.
- Cron: entrada no crontab do usuário invocando `harness run --workflow triage --cwd <repo> --silent`. Sem máquina de cron própria.

**Por que quinto:** Registry + HITL = fundação. Canal é cliente fino com a máquina pronta.

**Dúvidas abertas:**
- Server bind 127.0.0.1 (sem auth). OK?
- Quais webhooks primeiro? GH issues + Linear issues prováveis.
- Cron home-grown vs OS-level? Voto: OS-level, configurado pelo usuário.

**Pronto quando:**
- `curl POST /runs` dispara run real; events streamam em `/runs/:id/stream`.
- Webhook GH com payload de teste dispara triage → aparece no registry.
- Crontab rodando triage a cada 4h registra resultados.

---

### Tier 5 — TODO tracking

**Objetivo:** Expor o plano vivo de cada agente pra CLI e UI.

**Approach:**
- Instrumentar orchestrator pra capturar uso do SDK `TodoWrite` tool → persistir em registry.
- CLI interativo renderiza tree vivo.
- Hint nos prompts: "mantenha TodoWrite refletindo seu plano". Opcional por phase.

**Por que sexto:** Barato, depende do registry. Bom sinal pra timeline UI + debug.

**Dúvidas abertas:**
- Renderização CLI: ncurses-style overwrite ou print de deltas?
- Forçar todos (rejeita phase sem) ou só requisitar?

**Pronto quando:**
- Dev phase usando TodoWrite tem todos capturados no registry, visíveis via `harness show <runId> todos`.
- CLI interativo mostra todos vivos.

---

### Tier 6 — Web UI

**Objetivo:** Browser local pra monitorar, filtrar, inspecionar, intervir.

**Approach:**
- React + Vite servido pelo mesmo Hono server.
- SSE pra streaming; buffered reconnect (padrão Archon).
- Views:
  - **Launcher** — escolhe workflow, cwd, input, modo → `POST /runs`.
  - **Runs list** — filtros por cwd, workflow, status, data.
  - **Run detail** — timeline de events, sessions das phases, todos, approvals, custo.
  - **Approvals queue** — todas perguntas pending através dos runs, responder inline.
  - **Intervenção** — git reset do branch do run, destruir worktree, kill.

**Por que sétimo:** Consome tudo acima. Construir cedo força reescrita conforme backend muda.

**Dúvidas abertas:**
- Stack: React+Vite+Tailwind (voto) ou mais leve (HTMX, Solid)?
- Persistência de preferências UI (filtros) em local storage?

**Pronto quando:**
- `harness serve` abre UI local que lista runs.
- Clicar num run mostra timeline completa.
- Approvals respondidos via UI destravam runs headless.
- Trigger de git reset do UI funciona.

---

### Tier 7 — Composição e extensibilidade

**Objetivo:** Usuário e repo alvo customizam o que os agentes podem fazer.

**Approach:**
- **Sub-agents do repo alvo**: `Agent` tool nos allowedTools de dev/validator; `settingSources: ["project", "user"]` já carrega `.claude/agents/`. Override per-phase em harness.json: `agents: { "backend-expert": {...} }`.
- **User hooks via harness.json**: usuário define PreToolUse/PostToolUse próprios. Nossos defaults (3 guardas) sempre on, merged primeiro.
- **Cost tracking**: captura usage events do SDK, agrega por phase/run/workflow. `maxBudgetUsd` opcional por phase — aborta se estourar (Archon).

**Por que oitavo:** São modificadores sobre shapes já construídos.

**Dúvidas abertas:**
- User hooks: shell commands (Archon) ou callbacks JS (mais flexível, exige eval)?
- Subagent restriction: deny-list ou allow-list por phase? Voto: allow-list.
- Source of truth do custo: usage events do SDK por turn confiáveis?

**Pronto quando:**
- Repo alvo com `.claude/agents/backend-expert.md` é invocado por dev quando configurado.
- Hook de usuário em harness.json bloqueando edits em `requirements.txt` respeitado junto das 3 guardas.
- Custo por phase visível em run detail; overshoot de budget aborta.

---

### Tier 8 — Isolamento remoto (dev machine / sandbox)

**Objetivo:** Adicionar providers de isolamento além do worktree — pra uso remoto, containerizado, ou em dev machine à la Stripe Minions.

**Approach:**
- `IsolationResolver` interface já existe desde Tier 1.
- Provider `devMachine`: executa workflow em VM/container/SSH remoto.
- Opcional: provider `docker` local, se caso de uso aparecer.

**Por que nono:** Worktree (Tier 1) já resolve paralelismo + não-contaminação (o 80% dos casos). Dev machine é pra quando a máquina local não serve: capacidade, isolamento de blast radius, integração com infra de empresa.

**Dúvidas abertas:**
- VM local (Orbstack/Lima) ou remoto via SSH? Qual encaixa no fluxo Stripe-Minions-like?
- Provisionamento: imagem pré-construída ou setup on-demand?
- SDK Claude hospedado dentro da VM ou fora fazendo remote file ops?

**Pronto quando:**
- `--isolation devMachine` executa workflow em ambiente remoto/isolado.
- Interface idêntica à de worktree do ponto de vista do orchestrator (swap transparente).

---

### Tier 9 — Mais templates de workflow

**Objetivo:** Usar a abstração pros workflows que o usuário quer de verdade.

**Templates:**
- **bug-fix**: `[investigator, test-writer, fixer, loop(validator)]`.
- **docs**: `[writer, reviewer]`.
- **issue-triage**: já construído no Tier 1.
- (Release: NÃO entra.)

**Por que décimo:** Com engine maduro, template é engenharia de prompt + schema. Baixo risco, alto valor.

**Dúvidas abertas:**
- Bug-fix: test-writer escreve failing test antes ou depois da investigação? Provavelmente depois (investigação informa o teste).
- Docs: artefato do writer? Markdown? Reviewer só aprova ou edita?
- Handoff cross-workflow: triage decide "é bug" → dispara bug-fix automaticamente?

**Pronto quando:**
- Cada template tem exemplo `assistants.json` + input sample.
- Bug-fix num bug deliberado produz fix com testes.
- Docs num módulo sem doc produz PR razoável.

---

### Tier 10 — `/improve` skill (externa) — DIFERIDO (Post-Phase 2)

**Status:** Adiado por decisão 2026-04-20. Acumular uso real do produto antes de saber o que `/improve` deve propor. Construível retroativamente a partir do `problems.jsonl` capturado desde Tier 0 — por isso a captura continua valendo desde o início.

**Objetivo:** Loop de melhoria contínua — harness aprende com próprias falhas.

**Approach:**
- 100% externa: skill em `~/.claude/skills/` invocada numa sessão Claude Code regular dentro de um repo alvo.
- Consome: `.harness/<slug>/problems.jsonl`, audit log (resets, blocked), possivelmente registry pra padrões cross-run.
- Propõe edits em: `harness.json` do repo, `CLAUDE.md` do repo, testes/docs se o root issue for ali.

**Por que último:** Consumer only. Zero trabalho no harness (dados já capturam desde Tier 0). Pode ser construída a qualquer hora depois do Tier 0 — não bloqueia nada.

**Dúvidas abertas:**
- Skill pura ou CLI tool? Voto: skill, como usuário disse.
- Auto-apply mudanças ou propor? Voto: propor com confirmação per-arquivo.

**Pronto quando:**
- `/improve` num repo alvo lista top N problems recorrentes com fixes propostos.
- Aplicar fix + rerun mostra melhoria mensurável (menos resets, menos problems da mesma categoria).

---

## Concerns cross-cutting

### Invariantes que seguem valendo

- Sole writer dos artefatos de estado — só o orchestrator.
- Sole committer — só o orchestrator.
- Validator read-only em código.
- Retry = resume; reset = fresh + git reset.
- `blocked` = fatal **até Tier 3 entregar HITL**, aí vira `ask human`.

### Formato de dado é contrato

- Schema de problems.jsonl travado no Tier 0 — `/improve` (Tier 10) depende. Versionar (`schema_version: 1`).
- Registry db schema idem — adicionar migrations quando precisar.

### Segurança

- HTTP server em 127.0.0.1 só.
- Webhook secrets em env, nunca no registry.
- `--silent` + webhook = combo mais perigoso. Política default: silent não pode invocar tool que exige approval (falha por construção).

---

## Dúvidas gating antes do Tier 1

Responder essas trava o design do Tier 1:

1. **Formato do manifest**: TS tipado (voto), JSON, YAML?
2. **Problem annotation categories**: `{environment, design, understanding, tooling}` ok?
3. **Issue-triage input**: raw payload ou extraído?
4. **Output entre fases**: context object ou pipe nomeado?
5. **Loop predicate**: closure inline ou registry de nomes?
6. **Worktree cleanup**: imediato no done, TTL, ou explícito?
7. **Worktree commit flow**: orchestrator faz merge pro branch de destino, ou deixa pro usuário?
8. **`.harness/<slug>/` path**: repo principal (atual) ou `~/.harness/<repo>/<slug>/`?

Demais dúvidas têm resposta proposta no próprio tier e resolvem-se na sessão que puxar o tier.

---

## Como puxar um tier em sessão futura

1. Ler este doc.
2. Ler `CLAUDE.md` (invariantes) + `CHANGELOG.md` (o que shipou desde então).
3. Pegar **um** tier. Resolver dúvidas abertas dele antes de codar. Não pular à frente.
4. Ao shipar: atualizar `CHANGELOG.md` com o que entrou e este doc com os critérios de pronto marcados (ou remover a seção se o tier todo foi entregue).
