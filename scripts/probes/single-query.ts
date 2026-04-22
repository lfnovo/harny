/**
 * single-query probe — direct SDK query() call without orchestration.
 *
 * Removed from the public CLI when harny became orchestration-only. Kept here
 * as a personal probe: invoke the Claude Agent SDK against a known assistant
 * cwd (or process.cwd() if --assistant absent), stream SDK messages to stdout,
 * and persist the full transcript to ../../sessions/<sessionId>.json.
 *
 * Usage:
 *   bun scripts/probes/single-query.ts "list skills"
 *   bun scripts/probes/single-query.ts --assistant my-app -v "explore X"
 *
 * Phoenix instrumentation kicks in automatically when HARNY_PHOENIX_URL is set.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { setupPhoenix, withRunSpan } from "../../src/harness/observability/phoenix.js";
import { mkdir, writeFile, rename, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Probe lives at scripts/probes/, repo root is two up.
const ROOT_DIR = join(__dirname, "..", "..");
const SESSIONS_DIR = join(ROOT_DIR, "sessions");
const ASSISTANTS_FILE = join(homedir(), ".harness", "assistants.json");

type Assistant = {
  name: string;
  cwd: string;
  additionalDirectories?: string[];
};

type AssistantsFile = { assistants: Assistant[] };

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

async function loadAssistant(name: string): Promise<Assistant> {
  const raw = await readFile(ASSISTANTS_FILE, "utf8");
  const parsed = JSON.parse(raw) as AssistantsFile;
  const match = parsed.assistants?.find((a) => a.name === name);
  if (!match) {
    const known = (parsed.assistants ?? []).map((a) => a.name).join(", ");
    throw new Error(
      `Assistant "${name}" not found. Known: ${known || "(none)"}`,
    );
  }
  if (!isAbsolute(match.cwd)) {
    throw new Error(`Assistant "${name}" cwd must be absolute (got "${match.cwd}").`);
  }
  const s = await stat(match.cwd);
  if (!s.isDirectory()) throw new Error(`cwd "${match.cwd}" is not a directory`);
  return {
    name: match.name,
    cwd: match.cwd,
    additionalDirectories: match.additionalDirectories ?? [],
  };
}

function parseArgs(argv: string[]): {
  assistant: string | null;
  verbose: boolean;
  prompt: string;
} {
  let assistant: string | null = null;
  let verbose = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "--assistant") {
      const next = argv[i + 1];
      if (!next) throw new Error("--assistant requires a name");
      assistant = next;
      i++;
    } else if (a.startsWith("--assistant=")) {
      assistant = a.slice("--assistant=".length);
    } else {
      rest.push(a);
    }
  }
  return { assistant, verbose, prompt: rest.join(" ").trim() };
}

async function main() {
  const { assistant: assistantName, verbose, prompt: promptArg } = parseArgs(
    process.argv.slice(2),
  );

  const prompt =
    promptArg || "List the skills you have available and briefly describe each one.";

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

  if (verbose) {
    console.log(`[probe] prompt: ${prompt}`);
    if (assistant) {
      console.log(`[probe] assistant: ${assistant.name}`);
      console.log(`[probe] cwd: ${assistant.cwd}`);
    } else {
      console.log(`[probe] assistant: (none, using process.cwd)`);
    }
  }

  const phoenix = setupPhoenix({
    workflowId: "single-query",
    cwd: assistant?.cwd,
  });
  const query = phoenix.query;

  try {
    await withRunSpan(
      phoenix,
      "single-query",
      { "harness.workflow": "single-query" },
      async () => {
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
            if (verbose) {
              console.log(`[probe] session_id: ${record.session_id}`);
              console.log(`[probe] file: ${currentPath}`);
            }
          }

          if (currentPath) await writeJsonAtomic(currentPath, record);
          if (verbose) {
            console.log(`[probe] event: ${message.type}`);
            console.dir(message, { depth: null, colors: true });
          }
        }
      },
    );

    record.status = "completed";
  } catch (err) {
    record.status = "error";
    record.error = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[probe] error:`, err);
  } finally {
    record.ended_at = new Date().toISOString();
    const finalPath =
      currentPath ?? join(SESSIONS_DIR, `no-session-${Date.now()}.json`);
    await writeJsonAtomic(finalPath, record);
    console.log(`[probe] done. status=${record.status} file=${finalPath}`);
  }
}

main();
