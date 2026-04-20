import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, writeFile, rename, readFile, stat } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarness } from "./harness/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const SESSIONS_DIR = join(ROOT_DIR, "sessions");
const ASSISTANTS_FILE = join(ROOT_DIR, "assistants.json");

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

function parseArgs(argv: string[]): {
  verbose: boolean;
  assistant: string | null;
  harness: boolean;
  task: string | null;
  prompt: string;
} {
  let verbose = false;
  let assistant: string | null = null;
  let harness = false;
  let task: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--harness") {
      harness = true;
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
    } else {
      rest.push(a);
    }
  }

  return { verbose, assistant, harness, task, prompt: rest.join(" ").trim() };
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

  // Resolve paths relative to the assistants.json location.
  const configDir = dirname(ASSISTANTS_FILE);
  const resolvedCwd = isAbsolute(match.cwd)
    ? match.cwd
    : resolve(configDir, match.cwd);
  const resolvedExtras = (match.additionalDirectories ?? []).map((p) =>
    isAbsolute(p) ? p : resolve(configDir, p),
  );

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
    verbose,
    assistant: assistantName,
    harness,
    task,
    prompt: promptArg,
  } = parseArgs(process.argv.slice(2));

  if (harness) {
    if (!assistantName) {
      throw new Error("--harness requires --assistant <name>");
    }
    if (!promptArg) {
      throw new Error("--harness requires a prompt describing the work");
    }
    const assistant = await loadAssistant(assistantName);
    const result = await runHarness({
      cwd: assistant.cwd,
      userPrompt: promptArg,
      taskSlug: task ?? undefined,
      verbose,
    });
    console.log(
      `[harness] finished status=${result.status} plan=${result.planPath}`,
    );
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
        console.log(`[harness] session_id: ${record.session_id}`);
        console.log(`[harness] file: ${currentPath}`);
      }

      if (currentPath) await writeJsonAtomic(currentPath, record);
      if (verbose) {
        console.log(`[harness] event: ${message.type}`);
        console.dir(message, { depth: null, colors: true });
      } else {
        console.log(`[harness] event: ${message.type}`);
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
