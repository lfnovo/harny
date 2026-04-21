import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, writeFile, rename, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarness, resumeHarness } from "./harness/orchestrator.js";
import { cleanRun } from "./harness/clean.js";
import { getWorkflow } from "./harness/workflows/index.js";
import { getRegistry } from "./harness/state/registry.js";
import {
  resolveAnswer,
  runAskUserQuestionTTY,
  type AskUserQuestionInput,
  type AskUserQuestionItem,
} from "./harness/askUser.js";
import type { IsolationMode, LogMode, RunMode } from "./harness/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const SESSIONS_DIR = join(ROOT_DIR, "sessions");
// User-global config: list of named workspaces. Lives in ~/.harness/ so it's
// independent of which harness clone you're using and survives worktree creation.
const ASSISTANTS_FILE = join(homedir(), ".harness", "assistants.json");

type Assistant = {
  name: string;
  cwd: string;
  additionalDirectories?: string[];
};

type AssistantsFile = {
  assistants: Assistant[];
};

type SessionRecord = {
  session_id: string | null;
  assistant: string | null;
  cwd: string | null;
  additional_directories: string[];
  prompt: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "completed" | "error";
  error: string | null;
  events: SDKMessage[];
};

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, path);
}

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
  | { kind: "show"; runId: string }
  | {
      kind: "answer";
      runId: string;
      /** Raw text answer (string mode), or null when --json provided or interactive fallback. */
      text: string | null;
      /** Parsed JSON answer map (object mode). */
      json?: Record<string, string>;
    };

function parseArgs(argv: string[]): {
  logMode: LogMode;
  assistant: string | null;
  harness: boolean;
  workflow: string | null;
  cleanSlug: string | null;
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
  let harness = false;
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
    } else if (a === "--harness") {
      harness = true;
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
  let registryCmd: RegistryCmd | null = null;

  if (rest[0] === "harness") {
    const sub = rest[1];
    if (sub === "clean" && rest[2]) {
      cleanSlug = rest[2];
    } else if (sub === "ls") {
      let status: string | undefined;
      let cwd: string | undefined;
      let wf: string | undefined;
      for (let i = 2; i < rest.length; i++) {
        if (rest[i] === "--status" && rest[i + 1]) { status = rest[++i]; }
        else if (rest[i]?.startsWith("--status=")) { status = rest[i]!.slice("--status=".length); }
        else if (rest[i] === "--cwd" && rest[i + 1]) { cwd = rest[++i]; }
        else if (rest[i]?.startsWith("--cwd=")) { cwd = rest[i]!.slice("--cwd=".length); }
        else if (rest[i] === "--workflow" && rest[i + 1]) { wf = rest[++i]; }
        else if (rest[i]?.startsWith("--workflow=")) { wf = rest[i]!.slice("--workflow=".length); }
      }
      registryCmd = { kind: "ls", status, cwd, workflow: wf };
    } else if (sub === "show" && rest[2]) {
      registryCmd = { kind: "show", runId: rest[2] };
    } else if (sub === "answer" && rest[2]) {
      // Forms:
      //   harness answer <runId>                   → interactive (walk parked questions)
      //   harness answer <runId> <text>            → single string
      //   harness answer <runId> --json '{"q":"a"}' → multi-answer batch
      let json: Record<string, string> | undefined;
      const tail: string[] = [];
      for (let i = 3; i < rest.length; i++) {
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
        runId: rest[2],
        text: text || null,
        ...(json ? { json } : {}),
      };
    }
  }

  const logMode: LogMode = quiet ? "quiet" : verbose ? "verbose" : "compact";
  return {
    logMode,
    assistant,
    harness,
    workflow,
    cleanSlug,
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

  // assistants.json lives at ~/.harness/ (user-global). Paths must be absolute —
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

async function main() {
  const {
    logMode,
    assistant: assistantName,
    harness,
    workflow: workflowArg,
    cleanSlug,
    registryCmd,
    task,
    isolation,
    mode,
    inputPath,
    prompt: promptArg,
  } = parseArgs(process.argv.slice(2));

  if (registryCmd !== null) {
    const registry = getRegistry();
    if (registryCmd.kind === "ls") {
      const runs = registry.listRuns({
        status: registryCmd.status,
        cwd: registryCmd.cwd,
        workflow_id: registryCmd.workflow,
      });
      if (runs.length === 0) {
        console.log("No runs found.");
        return;
      }
      const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(14), "started_at".padEnd(25), "branch"].join(" | ");
      console.log(header);
      console.log("-".repeat(header.length));
      for (const r of runs) {
        console.log([
          r.id.slice(0, 8).padEnd(10),
          (r.workflow_id ?? "").padEnd(14),
          (r.status ?? "").padEnd(14),
          (r.started_at ?? "").padEnd(25),
          r.branch ?? "",
        ].join(" | "));
      }
      return;
    }

    if (registryCmd.kind === "show") {
      const run = registry.getRun(registryCmd.runId);
      if (!run) {
        console.error(`Run not found: ${registryCmd.runId}`);
        process.exit(1);
      }
      console.log(`Run:       ${run.id}`);
      console.log(`Workflow:  ${run.workflow_id}`);
      console.log(`Status:    ${run.status}`);
      console.log(`CWD:       ${run.cwd}`);
      console.log(`Branch:    ${run.branch}`);
      console.log(`TaskSlug:  ${run.task_slug}`);
      console.log(`Started:   ${run.started_at}`);
      if (run.ended_at) console.log(`Ended:     ${run.ended_at} (${run.ended_reason})`);
      if (run.worktree_path) console.log(`Worktree:  ${run.worktree_path}`);

      if (run.pending_question_id) {
        const q = registry.getQuestion(run.pending_question_id);
        if (q) {
          if (q.kind === "ask_user_question_batch" && q.options_json) {
            const questions = JSON.parse(q.options_json) as AskUserQuestionItem[];
            console.log(
              `\nPending AskUserQuestion batch (${q.id.slice(0, 8)}, ${questions.length} question${questions.length === 1 ? "" : "s"}):`,
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
              `\nTo resume: harness answer ${run.id} --json '${JSON.stringify(sample)}'`,
            );
            console.log(`           (or interactive: harness answer ${run.id})`);
          } else {
            console.log(`\nPending question (${q.id.slice(0, 8)}):`);
            console.log(`  ${q.prompt}`);
            if (q.options_json) {
              const opts = JSON.parse(q.options_json) as string[];
              opts.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
            }
            console.log(`\nTo resume: harness answer ${run.id} "<your answer>"`);
          }
        }
      }

      const events = registry.getEvents(run.id, 20);
      if (events.length > 0) {
        console.log(`\nLast ${events.length} events (newest first):`);
        for (const e of events) {
          console.log(`  [${e.at}] ${e.phase} / ${e.event_type}`);
        }
      }
      return;
    }

    if (registryCmd.kind === "answer") {
      const run = registry.getRun(registryCmd.runId);
      if (!run) {
        console.error(`Run not found: ${registryCmd.runId}`);
        process.exit(1);
      }
      const q = run.pending_question_id
        ? registry.getQuestion(run.pending_question_id)
        : null;

      // Dispatch: SDK batch park vs legacy single-question park.
      if (q && q.kind === "ask_user_question_batch") {
        const questions = JSON.parse(q.options_json ?? "[]") as AskUserQuestionItem[];
        let answersMap: Record<string, string>;

        if (registryCmd.json) {
          // Validate each provided answer against its question's options.
          const validated: Record<string, string> = {};
          for (const question of questions) {
            const raw = registryCmd.json[question.question];
            if (raw === undefined) {
              console.error(
                `Missing answer for question: "${question.question}"`,
              );
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
            "This run has a multi-question batch. Use --json '{...}' or run `harness answer <runId>` without args for interactive mode.",
          );
          process.exit(1);
        } else {
          // Interactive: walk each question via the existing TTY helper.
          const input: AskUserQuestionInput = { questions };
          const result = await runAskUserQuestionTTY(input);
          if (result.behavior !== "allow") {
            console.error("Interactive answer cancelled.");
            process.exit(1);
          }
          answersMap = result.updatedInput.answers;
        }

        console.log(`[harness] resuming run ${registryCmd.runId}...`);
        const result = await resumeHarness(registryCmd.runId, answersMap);
        console.log(`[harness] finished status=${result.status}`);
        return;
      }

      // Legacy path: single-question code-side park (ctx.askUser).
      if (!registryCmd.text) {
        console.error(
          "harness answer <runId> <text> — text is required for this run.",
        );
        process.exit(1);
      }
      let answerText: string = registryCmd.text;
      if (q) {
        const opts = q.options_json
          ? (JSON.parse(q.options_json) as string[])
          : null;
        const resolved = resolveAnswer(opts, registryCmd.text);
        if (!resolved.ok) {
          console.error(resolved.error);
          process.exit(1);
        }
        answerText = resolved.value;
        if (opts && opts.length > 0) {
          console.log(`[harness] selected: ${answerText}`);
        }
      }
      console.log(`[harness] resuming run ${registryCmd.runId}...`);
      const result = await resumeHarness(registryCmd.runId, answerText);
      console.log(`[harness] finished status=${result.status}`);
      return;
    }
  }

  if (cleanSlug !== null) {
    if (!assistantName) {
      console.error("harness clean requires --assistant <name>");
      process.exit(1);
    }
    const assistant = await loadAssistant(assistantName);
    await cleanRun(assistant.cwd, cleanSlug, logMode === "verbose");
    return;
  }

  const workflowId = harness ? "feature-dev" : workflowArg;

  if (workflowId !== null) {
    // Validate the workflow exists early so we get a useful error message.
    try {
      getWorkflow(workflowId!);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    if (!assistantName) {
      throw new Error("--workflow (or --harness) requires --assistant <name>");
    }
    if (!promptArg) {
      throw new Error("--workflow (or --harness) requires a prompt describing the work");
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
      // Validate against workflow's inputSchema if present.
      const wf = getWorkflow(workflowId!);
      if (wf.inputSchema) {
        const result = wf.inputSchema.safeParse(input);
        if (!result.success) {
          throw new Error(`--input validation failed for workflow "${workflowId}": ${result.error.message}`);
        }
        input = result.data;
      }
    }

    const assistant = await loadAssistant(assistantName);
    const result = await runHarness({
      cwd: assistant.cwd,
      userPrompt: promptArg,
      taskSlug: task ?? undefined,
      workflowId: workflowId!,
      isolation: isolation ?? undefined,
      mode: mode ?? undefined,
      logMode,
      input,
    });
    if (logMode === "quiet") {
      console.log(`[harness] status=${result.status} branch=${result.branch}`);
    } else {
      console.log(
        `[harness] finished status=${result.status} plan=${result.planPath}`,
      );
    }
    return;
  }

  const prompt =
    promptArg ||
    "List the skills you have available and briefly describe each one.";

  const assistant = assistantName ? await loadAssistant(assistantName) : null;

  await mkdir(SESSIONS_DIR, { recursive: true });

  const record: SessionRecord = {
    session_id: null,
    assistant: assistant?.name ?? null,
    cwd: assistant?.cwd ?? null,
    additional_directories: assistant?.additionalDirectories ?? [],
    prompt,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "running",
    error: null,
    events: [],
  };

  let currentPath: string | null = null;

  if (logMode === "verbose") {
    console.log(`[harness] prompt: ${prompt}`);
    if (assistant) {
      console.log(`[harness] assistant: ${assistant.name}`);
      console.log(`[harness] cwd: ${assistant.cwd}`);
      if (assistant.additionalDirectories?.length) {
        console.log(
          `[harness] additionalDirectories: ${assistant.additionalDirectories.join(", ")}`,
        );
      }
    } else {
      console.log(`[harness] assistant: (none, using process.cwd)`);
    }
  }

  try {
    for await (const message of query({
      prompt,
      options: {
        allowedTools: [
          "Skill",
          "Read",
          "Edit",
          "Glob",
          "Bash",
          "Grep",
          "WebSearch",
          "WebFetch",
          "ToolSearch",
        ],
        permissionMode: "auto",
        maxTurns: 30,
        effort: "high",
        settingSources: ["project", "user"],
        ...(assistant ? { cwd: assistant.cwd } : {}),
        ...(assistant?.additionalDirectories?.length
          ? { additionalDirectories: assistant.additionalDirectories }
          : {}),
      },
    })) {
      record.events.push(message);

      if (
        record.session_id == null &&
        message.type === "system" &&
        message.subtype === "init"
      ) {
        record.session_id = message.session_id;
        currentPath = join(SESSIONS_DIR, `${record.session_id}.json`);
        if (logMode === "verbose") {
          console.log(`[harness] session_id: ${record.session_id}`);
          console.log(`[harness] file: ${currentPath}`);
        }
      }

      if (currentPath) await writeJsonAtomic(currentPath, record);
      if (logMode === "verbose") {
        console.log(`[harness] event: ${message.type}`);
        console.dir(message, { depth: null, colors: true });
      }
    }

    record.status = "completed";
  } catch (err) {
    record.status = "error";
    record.error = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[harness] error:`, err);
  } finally {
    record.ended_at = new Date().toISOString();
    const finalPath =
      currentPath ?? join(SESSIONS_DIR, `no-session-${Date.now()}.json`);
    await writeJsonAtomic(finalPath, record);
    console.log(`[harness] done. status=${record.status} file=${finalPath}`);
  }
}

main();
