# Phase 2 — Multi-workflow harness com HITL

Captura a visão, ordem de construção, dúvidas abertas e critérios de pronto para a próxima release. Pensado para ser puxado um tier por vez em sessões futuras.

Complementa (não substitui): `CLAUDE.md` (invariantes, gotchas, preferências) e `CHANGELOG.md` (o que já foi entregue).

---

## Status (atualizado 2026-04-21)

| Tier | Status | Notas |
|---|---|---|
| 0. Quick wins (guards + problems) | **DONE** | Tier 0 + várias evoluções de infra durante dogfood. Ver "Evoluções pós-Tier-0". |
| 1a. Isolamento por worktree | **DONE** | Construído off-harness após 5 attempts de dogfood. `765afa7`. |
| 1b. Workflow abstraction | **DONE** | Self-build via harness, 2 commits, 0 retries. `a5e2445` + `e552e82`. Boundary cleanup (A1+A2+A3) follow-up landed manually post-review. |
| 2. Run registry + pause/resume | PENDING | Próximo a puxar. |
| 3. HITL (perguntas + approvals) | PENDING | |
| 4. Multi-invocação (HTTP + webhooks + cron) | PENDING | |
| 5. TODO tracking + display | **PARCIAL** | Logger compact/verbose/quiet entregue (`daa8c4c`). TodoWrite capture ainda pendente. |
| 6. Web UI | PENDING | |
| 7. Composição (sub-agents, user hooks, cost) | PENDING | |
| 8. Isolamento remoto (dev machine) | PENDING | Interface já existe desde Tier 1a. |
| 9. Mais templates de workflow | PENDING | Desbloqueado por Tier 1b. |
| 10. `/improve` skill | DEFERIDO (Post-Phase 2) | Schema captura desde Tier 0. |

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

### Tier 0 — Quick wins  **[DONE]**

**Objetivo:** Travar invariantes na máquina + começar captura de dataset pro `/improve`.

**Status:** Entregue em `15c30ca` (2026-04-20). Várias evoluções pós-entrega — ver "Evoluções pós-Tier-0" abaixo.

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

### Tier 1 — Workflow abstraction + isolamento por worktree  **[SPLIT]**

**Status:** Splitado em **1a (worktree, DONE)** e **1b (workflow abstraction, PENDING)**. A complexidade combinada justificou separar.

---

### Tier 1a — Isolamento por worktree  **[DONE]**

**Status:** Entregue em `765afa7` (2026-04-20), construído **off-harness** após 5 attempts de dogfood que cada um expôs um bug novo de infraestrutura.

**O que entrou:**
- `IsolationMode = "worktree" | "inline"`, default `worktree`.
- CLI flag `--isolation`, config `harness.json` field `isolation`.
- Per-task worktree em `<primary>/.harness/worktrees/<slug>/`.
- `.harness/<slug>/` (state) sempre no primary; phase cwd = worktree.
- Auto-remove no done; preserva no fail/blocked/exhausted (debug).
- `assertCleanTree` gated em `isolation === "inline"`.
- Path-anchor refactor: `primaryCwd` (state) vs `phaseCwd` (SDK + git ops) propagado por todo o stack.
- Guards refatorados: `validatorReadOnly` e `developerGitCommitter` aware de phaseCwd, com escape hatch pra paths fora.
- `.harness/.gitignore` tracked (`*` + `!.gitignore`) — nunca mais runtime-write.
- `addWorktree`, `removeWorktree`, `assertWorktreePathAbsent` em `git.ts`.
- Smoke test: `scripts/worktree-smoke.ts` (3/3: primitivas, sequential, concurrent).

**Decisões tomadas (resolvendo gating questions):**
- Cleanup policy: imediato no done; preserva no fail.
- Commit flow: orchestrator commita no branch do worktree, NÃO faz auto-merge pro main.
- `.harness/<slug>/` path: repo principal (não `~/.harness/`).

**Validado em produção:** 2 runs paralelos (`compact-logger` + `harness-clean-cli`) em worktrees distintos completaram sem colisão.

---

### Tier 1b — Workflow abstraction  **[DONE]**

**Status:** Entregue em `a5e2445` (workflow abstraction + featureDev migration) + `e552e82` (issue-triage), 2026-04-21. Self-build via dogfood: harness produziu ambos commits em ~60min, 2 tasks, 0 retries.

**O que entrou:**
- `src/harness/workflow.ts` — `Workflow<TInput>`, `WorkflowContext`, `WorkflowPhaseResult<T>`, `defineWorkflow()` helper de identidade pra inferência.
- `src/harness/workflows/featureDev.ts` — workflow atual reexpresso. Manifest top-level com ~22 linhas (planner → `runDevLoop(ctx)`); `decideAfterValidator`, `composeCommitMessage`, `runDevLoop` como helpers privados embaixo.
- `src/harness/workflows/issueTriage.ts` — novo template. `needsBranch:false`, `needsWorktree:false`, allowedTools restritos a `[Bash, Read, WebFetch, Grep, Glob]`. Sintetiza 1 PlanTask, roda 1 fase, persiste decisão em `task.output`.
- `src/harness/workflows/index.ts` — registry com `getWorkflow(id)` que joga erro descritivo listando IDs conhecidos.
- `src/harness/orchestrator.ts` — gutted de 484→152 linhas. Virou interpretador genérico: resolve workflow, configura git/worktree por flags, init plan, build context, chama `workflow.run(ctx)`, cleanup. Zero workflow-specific logic.
- `src/runner.ts` — `--workflow <name>` flag (alias `--harness` = `--workflow feature-dev`); `--input <path>` lê JSON validado contra `inputSchema`.
- `src/harness/verdict.ts` — `TriageVerdictSchema` com `{action: enum, target_url, payload, reasoning, problems?}`.
- `src/harness/types.ts` + `plan.ts` — `PlanTask.output?` campo + `createTriagePlanTask(url)` + `applyTriageVerdict(plan, task, verdict, sessionId)` helpers.

**Decisões tomadas (resolvendo gating questions):**
- **Manifest**: TS tipado com `defineWorkflow(...)`. Permite closures inline pros predicates de loop e schemas Zod direto sem serialização.
- **Loop predicate**: closure inline. Encaixa Q1.
- **Output entre fases**: context object (mantém shape atual). `WorkflowContext` é o canal; cada workflow escreve no `plan` via `ctx.updatePlan(mutator)`.
- **Issue-triage input**: `{ url: string }`, agente baixa via `gh issue view <url> --json ...`. Decisão D anterior também: triage só decide, não executa.
- **Capabilities expostas via ctx**: `updatePlan/audit/currentSha/commit/resetHard/cleanUntracked/runPhase<T>()`. `runPhase` genérico permite workflows novos sem importar `sessionRecorder` direto.

**Validado em produção (validator do próprio dogfood):**
- feature-dev: nested `npm run run -- --workflow feature-dev --task ac5-val 'create hello.txt'` em `/tmp` produziu commit `76e22d26` com `hello.txt='hello world'`.
- issue-triage: `npm run run -- --workflow issue-triage --input /tmp/issue.json 'triage this'` rodou end-to-end, `plan.json` ficou com `tasks[0].output.action='none'` + reasoning, sem branch/worktree criados.
- `--harness` continuou funcionando como alias.
- Erro de workflow desconhecido lista IDs disponíveis.

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

### Tier 5 — TODO tracking + display layer  **[PARCIAL]**

**Status:** Logger de 3 modos (`--compact` default, `--verbose`, `--quiet`) entregue em `daa8c4c` (2026-04-21). TodoWrite capture do agente ainda pendente.

**O que já entrou:**
- `LogMode = "compact" | "verbose" | "quiet"`.
- `--compact` (novo default) surfaceia só progresso significativo do orchestrator (phase transitions, validator verdict, decision, commit SHA).
- `--verbose` / `-v` mantém comportamento antigo (full SDK event dump).
- `--quiet` só status final + branch.
- `logMode` propagado por orchestrator + phases + sessionRecorder.

**O que falta (TODO tracking propriamente dito):**

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

## Dúvidas gating

### Resolvidas durante Tier 1a

- ~~**Worktree cleanup**~~: **resolvido — imediato no done, preserva no fail/blocked/exhausted.**
- ~~**Worktree commit flow**~~: **resolvido — orchestrator commita no branch do worktree, NÃO faz auto-merge pro main.** Usuário decide o destino.
- ~~**`.harness/<slug>/` path**~~: **resolvido — repo principal.**
- ~~**Problem annotation categories**~~: **resolvido — `{environment, design, understanding, tooling}` em uso e funcionando.**

### Resolvidas durante Tier 1b

- ~~**Formato do manifest**~~: **resolvido — TS tipado com `defineWorkflow(...)`.**
- ~~**Issue-triage input**~~: **resolvido — `{ url: string }`, agente fetcha via `gh issue view`.**
- ~~**Output entre fases**~~: **resolvido — context object (`WorkflowContext.updatePlan(mutator)`).**
- ~~**Loop predicate**~~: **resolvido — closure inline (TS).**

### Resolvidas no Tier 1b cleanup (pós-review A1+A2+A3)

Boundary review identificou 3 categorias de leak entre core e workflows; corrigidas em refactor manual de 13 steps:

- **A1 (closed unions abertos)**: `PhaseName`, `PlanTaskHistoryEntry`, `AuditEntry` agora são open shapes. Workflows declaram seus tipos history/audit localmente.
- **A2 (workflow-specific movido pro workflow)**: verdict schemas, prompts, defaults, phase wrappers, helpers de plan — tudo que era feature-dev migrado pra `workflows/featureDev/{verdicts,defaults,plan,phases/*}.ts`. Tudo que era issue-triage inlined em `workflows/issueTriage.ts`. `verdict.ts` virou `jsonSchema.ts` (só `toJsonSchema()`).
- **A3 (capabilities desacopladas)**: `Workflow.phaseDefaults` + `ResolvedHarnessConfig.phases` map. `loadHarnessConfig(cwd, workflow)` workflow-aware. `ctx.runPhase` auto-resolve via `config.phases[phase]`. `Plan.planner_session_id` → `Plan.metadata`. `buildGuardHooks` parametrizado por `PhaseGuards` em vez de literal de phase.

Resultado: workflow novo (bug-fix, docs) é só uma pasta `workflows/<name>/`, zero edits em core.

---

## Evoluções pós-Tier-0 (decisões/fixes que não estavam no plano original)

Várias mudanças importantes saíram durante o dogfood que valem ser documentadas aqui pro contexto futuro:

### Defaults amplificados
- **Model**: `sonnet` em todas as phases (default). Opus 4× mais caro e ~3-4× mais lento; Sonnet provou suficiente pra self-build. Per-projeto pode override no `harness.json`.
- **maxTurns**: planner 50, dev 200, validator 200. Os antigos 10/30/20 eram insuficientes pra trabalho não-trivial (planner sob exploração, validator sob independência empírica).
- **permissionMode**: `bypassPermissions`. `auto` em headless cai em "ask user" silenciosamente, bloqueia writes em /tmp pros validators.

### Guard hooks evoluídos
- **Validator read-only com escape hatch**: Write/Edit em paths fora do phaseCwd permitido (pra setup de fixtures em /tmp).
- **Developer git-committer com escape hatch**: `cd /tmp/...` ou `git -C /tmp/...` permitidos (test repos descartáveis). Regex broadened pra pegar `git -C <path> commit` patterns.
- **Static `.harness/.gitignore`** committado: `*` + `!.gitignore`. Não escrever em runtime.
- **`assertCleanTree` mode-aware**: só roda em inline mode.

### Contratos de prompt (pra economia + rigor)
- **Validator independence**: empirical exercise é YOUR OWN invocation; dev artifacts são input, não substituto. Se infra impede, retorne `fail` com problem annotation, NÃO `pass` por inspeção.
- **Validator efficiency**: ONE comprehensive nested run per task; pra mudanças cosméticas (logger, doc), structural review + smoke run basta. Não rodar nested harness por AC.
- **Planner task granularity**: default smallest viable plan. 1 task pra refactor narrow; 2-3 pra surfaces múltiplas; 4+ só pra unidades shippable independentes. Cost framing explícita ("each task multiplies validator cost").
- **Developer "run twice"**: smoke tests que mexem em invocation surface DEVEM rodar harness 2× consecutive (pega state-leak bugs).

### Resilience
- **Transient API retry**: até 3 attempts com exponential backoff (2s/4s/8s, cap 30s) em `runPhase` pra erros tipo `overloaded_error`, `rate_limit_error`, HTTP 5xx.

### CLI ops
- **`harness clean <slug>`** subcommand: cleanup idempotente (worktree + branch + state dir). Cobre o caso "harness foi killed/crashou e deixou sujeira".
- **`--isolation worktree|inline`** flag.
- **`--compact|--verbose|--quiet`** flags.

---

## Backlog descoberto durante dogfood

Itens que apareceram como problem annotations ou observações durante runs reais. Não bloqueiam tiers seguintes mas valem priorizar:

1. **`HARNESS_ASSISTANTS_FILE` env var** — validator no worktree não acha `assistants.json` (gitignored). Workaround atual: symlink. Real fix: env var configurável.
2. **`node_modules` no worktree** — `npm` não funciona no worktree sem symlink hack. Real fix: env var ou wrapper que aponta pro primary.
3. **Mock/fixture mechanism pra ACs estruturais** — algumas ACs (ex: "problems printados como linhas X em compact") não são empiricamente verificáveis sem injetar verdict mockado. Sugestão: dry-run mode ou test-fixture stub.
4. **Plan.json não vai mais pro git history** — `.harness/.gitignore` com `*` excluiu plan.json do tracking. Audit.jsonl compensa parcialmente. Avaliar se vale untrack-but-snapshot ou se OK como está.
5. **Merge entre branches paralelos sempre conflita em `runner.ts`** — inevitável quando ambos mexem em CLI parsing. Backlog: rebase script ou linear-only branch policy ou modularizar parseArgs.
6. **Cleanup automático de worktrees órfãos** — quando harness é killed, worktree fica. `git worktree prune` resolve mas é manual. Já temos `harness clean <slug>` mas seria bom um `harness clean --all` ou cleanup-on-startup.
7. **Validator empirical cost amplifies** — independence + nested harness invocations = recursão custosa. Possíveis mitigações futuras: usar Haiku pra nested runs, contrato "1 run per task max", ou skip nested quando a mudança é structural-only.

---

## Como puxar um tier em sessão futura

1. Ler este doc.
2. Ler `CLAUDE.md` (invariantes) + `CHANGELOG.md` (o que shipou desde então).
3. Pegar **um** tier. Resolver dúvidas abertas dele antes de codar. Não pular à frente.
4. Ao shipar: atualizar `CHANGELOG.md` com o que entrou e este doc com os critérios de pronto marcados (ou remover a seção se o tier todo foi entregue).
