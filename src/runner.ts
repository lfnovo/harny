import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute, basename } from "node:path";
import { runHarness, resumeHarness } from "./harness/orchestrator.js";
import { cleanRun } from "./harness/clean.js";
import { getWorkflow, isEngineWorkflow } from "./harness/workflows/index.js";
import { listAllRuns, findRun, statePathFor } from "./harness/state/filesystem.js";
import type { PendingQuestion } from "./harness/state/schema.js";
import {
  resolveAnswer,
  runAskUserQuestionTTY,
  type AskUserQuestionInput,
  type AskUserQuestionItem,
} from "./harness/askUser.js";
import type { IsolationMode, LogMode, RunMode } from "./harness/types.js";

// User-global config: list of named workspaces. Lives in ~/.harny/ so it's
// independent of which harny clone you're using and survives worktree creation.
const ASSISTANTS_FILE = join(homedir(), ".harny", "assistants.json");

type Assistant = {
  name: string;
  cwd: string;
  additionalDirectories?: string[];
};

type AssistantsFile = {
  assistants: Assistant[];
};

function parseIsolation(value: string): IsolationMode {
  if (value === "worktree" || value === "inline") return value;
  throw new Error(
    `--isolation must be one of: worktree, inline (got "${value}")`,
  );
}

function parseMode(value: string): RunMode {
  if (value === "interactive" || value === "silent" || value === "async")
    return value;
  throw new Error(
    `--mode must be one of: interactive, silent, async (got "${value}")`,
  );
}

type RegistryCmd =
  | { kind: "ls"; status?: string; cwd?: string; workflow?: string }
  | { kind: "show"; runId: string; tail?: boolean; since?: string }
  | {
      kind: "answer";
      runId: string;
      /** Raw text answer (string mode), or null when --json provided or interactive fallback. */
      text: string | null;
      /** Parsed JSON answer map (object mode). */
      json?: Record<string, string>;
    }
  | { kind: "ui"; port?: number; noOpen?: boolean };

export function parseArgs(argv: string[]): {
  logMode: LogMode;
  assistant: string | null;
  workflow: string | null;
  cleanSlug: string | null;
  cleanForce: boolean;
  cleanKill: boolean;
  registryCmd: RegistryCmd | null;
  task: string | null;
  isolation: IsolationMode | null;
  mode: RunMode | null;
  inputPath: string | null;
  prompt: string;
} {
  let verbose = false;
  let quiet = false;
  let assistant: string | null = null;
  let workflow: string | null = null;
  let task: string | null = null;
  let isolation: IsolationMode | null = null;
  let mode: RunMode | null = null;
  let inputPath: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--quiet") {
      quiet = true;
    } else if (a === "--workflow") {
      const next = argv[i + 1];
      if (!next) throw new Error("--workflow requires a name");
      workflow = next;
      i++;
    } else if (a.startsWith("--workflow=")) {
      workflow = a.slice("--workflow=".length);
    } else if (a === "--input") {
      const next = argv[i + 1];
      if (!next) throw new Error("--input requires a file path");
      inputPath = next;
      i++;
    } else if (a.startsWith("--input=")) {
      inputPath = a.slice("--input=".length);
    } else if (a === "--assistant") {
      const next = argv[i + 1];
      if (!next) throw new Error("--assistant requires a name");
      assistant = next;
      i++;
    } else if (a.startsWith("--assistant=")) {
      assistant = a.slice("--assistant=".length);
    } else if (a === "--task") {
      const next = argv[i + 1];
      if (!next) throw new Error("--task requires a slug");
      task = next;
      i++;
    } else if (a.startsWith("--task=")) {
      task = a.slice("--task=".length);
    } else if (a === "--isolation") {
      const next = argv[i + 1];
      if (!next) throw new Error("--isolation requires a value (worktree|inline)");
      isolation = parseIsolation(next);
      i++;
    } else if (a.startsWith("--isolation=")) {
      isolation = parseIsolation(a.slice("--isolation=".length));
    } else if (a === "--mode") {
      const next = argv[i + 1];
      if (!next) throw new Error("--mode requires a value (interactive|silent|async)");
      mode = parseMode(next);
      i++;
    } else if (a.startsWith("--mode=")) {
      mode = parseMode(a.slice("--mode=".length));
    } else {
      rest.push(a);
    }
  }

  let cleanSlug: string | null = null;
  let cleanForce = false;
  let cleanKill = false;
  let registryCmd: RegistryCmd | null = null;

  // Subcommands are recognized by the first positional arg matching a known
  // keyword. A prompt starting with one of these words would conflict — by
  // convention prompts shouldn't start with these reserved words.
  const sub = rest[0];
  if (sub === "clean" && rest[1]) {
    cleanSlug = rest[1]!;
    for (let i = 2; i < rest.length; i++) {
      if (rest[i] === "--force") cleanForce = true;
      else if (rest[i] === "--kill") cleanKill = true;
    }
  } else if (sub === "ls") {
    let status: string | undefined;
    let cwd: string | undefined;
    let wf: string | undefined;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--status" && rest[i + 1]) { status = rest[++i]; }
      else if (rest[i]?.startsWith("--status=")) { status = rest[i]!.slice("--status=".length); }
      else if (rest[i] === "--cwd" && rest[i + 1]) { cwd = rest[++i]; }
      else if (rest[i]?.startsWith("--cwd=")) { cwd = rest[i]!.slice("--cwd=".length); }
      else if (rest[i] === "--workflow" && rest[i + 1]) { wf = rest[++i]; }
      else if (rest[i]?.startsWith("--workflow=")) { wf = rest[i]!.slice("--workflow=".length); }
    }
    registryCmd = { kind: "ls", status, cwd, workflow: wf };
  } else if (sub === "show" && rest[1]) {
    let tail = false;
    let since: string | undefined;
    for (let i = 2; i < rest.length; i++) {
      if (rest[i] === "--tail") tail = true;
      else if (rest[i] === "--since" && rest[i + 1]) { since = rest[++i]; }
      else if (rest[i]?.startsWith("--since=")) { since = rest[i]!.slice("--since=".length); }
    }
    registryCmd = { kind: "show", runId: rest[1]!, ...(tail ? { tail: true } : {}), ...(since !== undefined ? { since } : {}) };
  } else if (sub === "ui") {
    let port: number | undefined;
    let noOpen = false;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--port" && rest[i + 1]) {
        port = Number(rest[++i]);
      } else if (rest[i]?.startsWith("--port=")) {
        port = Number(rest[i]!.slice("--port=".length));
      } else if (rest[i] === "--no-open") {
        noOpen = true;
      }
    }
    registryCmd = { kind: "ui", ...(port ? { port } : {}), ...(noOpen ? { noOpen } : {}) };
  } else if (sub === "answer" && rest[1]) {
    // Forms:
    //   harny answer <runId>                   → interactive (walk parked questions)
    //   harny answer <runId> <text>            → single string
    //   harny answer <runId> --json '{"q":"a"}' → multi-answer batch
    let json: Record<string, string> | undefined;
    const tail: string[] = [];
    for (let i = 2; i < rest.length; i++) {
      if (rest[i] === "--json" && rest[i + 1]) {
        try {
          json = JSON.parse(rest[++i]!) as Record<string, string>;
        } catch (err) {
          throw new Error(`--json requires valid JSON object: ${(err as Error).message}`);
        }
      } else if (rest[i]?.startsWith("--json=")) {
        try {
          json = JSON.parse(rest[i]!.slice("--json=".length)) as Record<string, string>;
        } catch (err) {
          throw new Error(`--json= requires valid JSON object: ${(err as Error).message}`);
        }
      } else {
        tail.push(rest[i]!);
      }
    }
    const text = tail.join(" ").trim();
    registryCmd = {
      kind: "answer",
      runId: rest[1]!,
      text: text || null,
      ...(json ? { json } : {}),
    };
  }

  const logMode: LogMode = quiet ? "quiet" : verbose ? "verbose" : "compact";
  return {
    logMode,
    assistant,
    workflow,
    cleanSlug,
    cleanForce,
    cleanKill,
    registryCmd,
    task,
    isolation,
    mode,
    inputPath,
    prompt: rest.join(" ").trim(),
  };
}

async function loadAssistant(name: string): Promise<Assistant> {
  let raw: string;
  try {
    raw = await readFile(ASSISTANTS_FILE, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read ${ASSISTANTS_FILE}: ${(err as Error).message}`,
    );
  }

  let parsed: AssistantsFile;
  try {
    parsed = JSON.parse(raw) as AssistantsFile;
  } catch (err) {
    throw new Error(
      `Invalid JSON in ${ASSISTANTS_FILE}: ${(err as Error).message}`,
    );
  }

  const match = parsed.assistants?.find((a) => a.name === name);
  if (!match) {
    const known = (parsed.assistants ?? []).map((a) => a.name).join(", ");
    throw new Error(
      `Assistant "${name}" not found in assistants.json. Known: ${known || "(none)"}`,
    );
  }

  // assistants.json lives at ~/.harny/ (user-global). Paths must be absolute —
  // relative paths against the config dir aren't meaningful in this location.
  if (!isAbsolute(match.cwd)) {
    throw new Error(
      `Assistant "${name}" cwd must be an absolute path (got "${match.cwd}"). User-global assistants.json at ${ASSISTANTS_FILE} requires absolute paths.`,
    );
  }
  const resolvedCwd = match.cwd;
  const resolvedExtras = (match.additionalDirectories ?? []).map((p) => {
    if (!isAbsolute(p)) {
      throw new Error(
        `Assistant "${name}" additionalDirectories entry "${p}" must be an absolute path.`,
      );
    }
    return p;
  });

  // Fail fast if the working directory doesn't exist.
  try {
    const s = await stat(resolvedCwd);
    if (!s.isDirectory()) {
      throw new Error(`cwd "${resolvedCwd}" is not a directory`);
    }
  } catch (err) {
    throw new Error(
      `Assistant "${name}" cwd unreachable (${resolvedCwd}): ${(err as Error).message}`,
    );
  }

  return {
    name: match.name,
    cwd: resolvedCwd,
    additionalDirectories: resolvedExtras,
  };
}

/**
 * Resolve an assistant entry from a name OR fall back to process.cwd() when
 * name is null. The fallback synthesizes an Assistant whose name is the
 * basename of the current working directory — used by `bunx harny "..."`
 * invocations from arbitrary project directories with no prior registration.
 */
async function resolveAssistant(name: string | null): Promise<Assistant> {
  if (name) return loadAssistant(name);
  const cwd = process.cwd();
  return {
    name: basename(cwd) || "harny",
    cwd,
    additionalDirectories: [],
  };
}

/**
 * Read every cwd registered in ~/.harny/assistants.json (primary + extras),
 * plus process.cwd() as a fallback so unregistered local runs are still
 * discoverable by ls/show/answer/ui. Used by registry-replacement subcommands
 * and resumeHarness to find where a run lives without an indexed DB.
 */
async function loadSearchCwds(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(ASSISTANTS_FILE, "utf8");
  } catch {
    return [];
  }
  let parsed: AssistantsFile;
  try {
    parsed = JSON.parse(raw) as AssistantsFile;
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const a of parsed.assistants ?? []) {
    if (a.cwd && isAbsolute(a.cwd)) out.add(a.cwd);
    for (const d of a.additionalDirectories ?? []) {
      if (isAbsolute(d)) out.add(d);
    }
  }
  // Always include process.cwd() so a fresh project directory with local runs
  // is discoverable even if it isn't in assistants.json.
  out.add(process.cwd());
  return Array.from(out);
}

export async function main() {
  const {
    logMode,
    assistant: assistantName,
    workflow: workflowArg,
    cleanSlug,
    cleanForce,
    cleanKill,
    registryCmd,
    task,
    isolation,
    mode,
    inputPath,
    prompt: promptArg,
  } = parseArgs(process.argv.slice(2));

  if (registryCmd !== null) {
    if (registryCmd.kind === "ui") {
      const { startViewer, openBrowser } = await import("./viewer/server.js");
      const { url, stop } = await startViewer({ port: registryCmd.port });
      console.log(`[harny ui] serving at ${url}`);
      console.log(`[harny ui] press Ctrl-C to stop`);
      if (!registryCmd.noOpen) openBrowser(url);
      const shutdown = () => {
        console.log("\n[harny ui] stopping…");
        stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      // Keep the event loop alive.
      await new Promise<void>(() => {});
      return;
    }

    const searchCwds = await loadSearchCwds();

    if (registryCmd.kind === "ls") {
      let runs = await listAllRuns(searchCwds);
      if (registryCmd.status) {
        runs = runs.filter((r) => r.lifecycle.status === registryCmd.status);
      }
      if (registryCmd.cwd) {
        runs = runs.filter((r) => r.environment.cwd === registryCmd.cwd);
      }
      if (registryCmd.workflow) {
        runs = runs.filter((r) => r.origin.workflow === registryCmd.workflow);
      }
      if (runs.length === 0) {
        console.log("No runs found.");
        return;
      }
      const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(14), "started_at".padEnd(25), "branch"].join(" | ");
      console.log(header);
      console.log("-".repeat(header.length));
      for (const r of runs) {
        console.log([
          r.run_id.slice(0, 8).padEnd(10),
          r.origin.workflow.padEnd(14),
          r.lifecycle.status.padEnd(14),
          r.origin.started_at.padEnd(25),
          r.environment.branch,
        ].join(" | "));
      }
      return;
    }

    if (registryCmd.kind === "show") {
      const run = await findRun(searchCwds, registryCmd.runId);
      if (!run) {
        console.error(`Run not found: ${registryCmd.runId}`);
        process.exit(1);
      }

      if (registryCmd.tail) {
        const sfp = statePathFor(run.environment.cwd, run.origin.task_slug);
        const { tailRun, parseSinceArg } = await import("./harness/transcripts/tail.js");
        const sinceSeconds = registryCmd.since !== undefined ? parseSinceArg(registryCmd.since) : undefined;
        await tailRun(sfp, sinceSeconds);
        return;
      }

      console.log(`Run:       ${run.run_id}`);
      console.log(`Workflow:  ${run.origin.workflow}`);
      console.log(`Status:    ${run.lifecycle.status}`);
      console.log(`CWD:       ${run.environment.cwd}`);
      console.log(`Branch:    ${run.environment.branch}`);
      console.log(`TaskSlug:  ${run.origin.task_slug}`);
      console.log(`Started:   ${run.origin.started_at}`);
      if (run.lifecycle.ended_at)
        console.log(`Ended:     ${run.lifecycle.ended_at} (${run.lifecycle.ended_reason})`);
      if (run.environment.worktree_path) console.log(`Worktree:  ${run.environment.worktree_path}`);

      const pq = run.pending_question;
      if (pq) {
        if (pq.kind === "ask_user_question_batch" && pq.options) {
          const questions = pq.options as AskUserQuestionItem[];
          console.log(
            `\nPending AskUserQuestion batch (${pq.id.slice(0, 8)}, ${questions.length} question${questions.length === 1 ? "" : "s"}):`,
          );
          questions.forEach((qq, qi) => {
            const head = qq.header ? `[${qq.header}] ` : "";
            console.log(`  Q${qi + 1}: ${head}${qq.question}`);
            qq.options.forEach((o, oi) => {
              const desc = o.description ? ` — ${o.description}` : "";
              console.log(`      ${oi + 1}. ${o.label}${desc}`);
            });
            if (qq.multiSelect) console.log(`      (multiSelect)`);
          });
          const sample: Record<string, string> = {};
          questions.forEach((qq) => {
            sample[qq.question] = qq.options[0]?.label ?? "";
          });
          console.log(
            `\nTo resume: harny answer ${run.run_id} --json '${JSON.stringify(sample)}'`,
          );
          console.log(`           (or interactive: harny answer ${run.run_id})`);
        } else {
          console.log(`\nPending question (${pq.id.slice(0, 8)}):`);
          console.log(`  ${pq.prompt}`);
          if (pq.options) {
            const opts = pq.options as string[];
            opts.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
          }
          console.log(`\nTo resume: harny answer ${run.run_id} "<your answer>"`);
        }
      }

      const recent = run.history.slice(-20);
      if (recent.length > 0) {
        console.log(`\nLast ${recent.length} events:`);
        for (const e of recent) {
          if ('kind' in e && (e as Record<string, unknown>)['kind'] === 'human_review') {
            const hr = e as { at: string; kind: string; state_path: string };
            console.log(`  [${hr.at}] human_review / ${hr.state_path}`);
          } else {
            const le = e as { at: string; phase: string; event: string };
            console.log(`  [${le.at}] ${le.phase} / ${le.event}`);
          }
        }
      }
      return;
    }

    if (registryCmd.kind === "answer") {
      const run = await findRun(searchCwds, registryCmd.runId);
      if (!run) {
        console.error(`Run not found: ${registryCmd.runId}`);
        process.exit(1);
      }
      const pq: PendingQuestion | null = run.pending_question;

      // Dispatch: SDK batch park vs legacy single-question park.
      if (pq && pq.kind === "ask_user_question_batch") {
        const questions = (pq.options ?? []) as AskUserQuestionItem[];
        let answersMap: Record<string, string>;

        if (registryCmd.json) {
          const validated: Record<string, string> = {};
          for (const question of questions) {
            const raw = registryCmd.json[question.question];
            if (raw === undefined) {
              console.error(`Missing answer for question: "${question.question}"`);
              process.exit(1);
            }
            const labels = question.options.map((o) => o.label);
            const r = resolveAnswer(labels, raw);
            if (!r.ok) {
              console.error(`For "${question.question}": ${r.error}`);
              process.exit(1);
            }
            validated[question.question] = r.value;
          }
          answersMap = validated;
        } else if (registryCmd.text) {
          console.error(
            "This run has a multi-question batch. Use --json '{...}' or run `harny answer <runId>` without args for interactive mode.",
          );
          process.exit(1);
        } else {
          const input: AskUserQuestionInput = { questions };
          const result = await runAskUserQuestionTTY(input);
          if (result.behavior !== "allow") {
            console.error("Interactive answer cancelled.");
            process.exit(1);
          }
          answersMap = result.updatedInput.answers;
        }

        console.log(`[harny] resuming run ${registryCmd.runId}...`);
        const result = await resumeHarness(registryCmd.runId, answersMap, {
          searchCwds,
        });
        console.log(`[harny] finished status=${result.status}`);
        return;
      }

      // Legacy path: single-question code-side park (ctx.askUser).
      if (!registryCmd.text) {
        console.error(
          "harny answer <runId> <text> — text is required for this run.",
        );
        process.exit(1);
      }
      let answerText: string = registryCmd.text;
      if (pq) {
        const opts = (pq.options ?? null) as string[] | null;
        const resolved = resolveAnswer(opts, registryCmd.text);
        if (!resolved.ok) {
          console.error(resolved.error);
          process.exit(1);
        }
        answerText = resolved.value;
        if (opts && opts.length > 0) {
          console.log(`[harny] selected: ${answerText}`);
        }
      }
      console.log(`[harny] resuming run ${registryCmd.runId}...`);
      const result = await resumeHarness(registryCmd.runId, answerText, {
        searchCwds,
      });
      console.log(`[harny] finished status=${result.status}`);
      return;
    }
  }

  if (cleanSlug !== null) {
    const assistant = await resolveAssistant(assistantName);
    await cleanRun(assistant.cwd, cleanSlug, logMode === "verbose", { force: cleanForce, kill: cleanKill });
    return;
  }

  // If no subcommand matched and no prompt was given, print a short usage hint
  // so users invoking `harny` with no args see something useful instead of a
  // raw thrown error.
  if (!promptArg && !registryCmd && !cleanSlug) {
    console.log(
      [
        "Usage: harny [--workflow <id>] [--task <slug>] [--assistant <name>] \"<prompt>\"",
        "       harny ls | show <runId> | answer <runId> [...] | clean <slug> | ui",
        "",
        "Default workflow: feature-dev. cwd defaults to process.cwd() when --assistant is omitted.",
      ].join("\n"),
    );
    return;
  }

  // Workflow mode is the only mode. Default to feature-dev when --workflow
  // not specified. --workflow accepts `<id>` or `<id>:<variant>` syntax
  // (engine-design.md §4.5); split here so the orchestrator receives a clean
  // registry id + variant separately.
  const workflowArgRaw = workflowArg ?? "feature-dev";
  const [workflowId = "feature-dev", variant] = workflowArgRaw.split(":");

  // Validate the workflow exists early so we get a useful error message.
  try {
    getWorkflow(workflowId);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  if (!promptArg) {
    throw new Error("a prompt is required (describe the work in quotes)");
  }

  let input: unknown = undefined;
  if (inputPath) {
    let raw: string;
    try {
      raw = await readFile(inputPath, "utf8");
    } catch (err) {
      throw new Error(`Could not read --input file "${inputPath}": ${(err as Error).message}`);
    }
    try {
      input = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in --input file "${inputPath}": ${(err as Error).message}`);
    }
    // Validate against workflow's inputSchema if present (legacy workflows only).
    const wf = getWorkflow(workflowId);
    if (!isEngineWorkflow(wf) && wf.inputSchema) {
      const result = wf.inputSchema.safeParse(input);
      if (!result.success) {
        throw new Error(`--input validation failed for workflow "${workflowId}": ${result.error.message}`);
      }
      input = result.data;
    }
  }

  const assistant = await resolveAssistant(assistantName);
  const result = await runHarness({
    cwd: assistant.cwd,
    userPrompt: promptArg,
    taskSlug: task ?? undefined,
    workflowId,
    variant,
    isolation: isolation ?? undefined,
    mode: mode ?? undefined,
    logMode,
    input,
  });
  if (logMode === "quiet") {
    console.log(`[harny] status=${result.status} branch=${result.branch}`);
  } else {
    console.log(
      `[harny] finished status=${result.status} plan=${result.planPath}`,
    );
  }
}

if (import.meta.main) main();
