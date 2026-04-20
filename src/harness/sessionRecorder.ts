import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sessionsDir } from "./plan.js";
import { toJsonSchema } from "./verdict.js";
import { buildGuardHooks } from "./guardHooks.js";
import type { PhaseName, ResolvedPhaseConfig } from "./types.js";

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, path);
}

/**
 * Returns the next 4-digit ordinal prefix for a fresh session file by looking
 * at the highest prefix already present in the sessions directory.
 */
async function nextOrdinalPrefix(dir: string): Promise<string> {
  let max = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      const m = name.match(/^(\d{4})_/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > max) max = n;
      }
    }
  } catch {
    // Directory may not exist yet; caller mkdir's before writing.
  }
  return String(max + 1).padStart(4, "0");
}

export type PhaseRunResult<T> = {
  sessionId: string;
  status: "completed" | "error";
  error: string | null;
  structuredOutput: T | null;
  resultSubtype: string | null;
  events: SDKMessage[];
};

type SessionRecord = {
  phase: PhaseName;
  ordinal: string;
  task_slug: string;
  harness_task_id: string | null;
  session_id: string | null;
  cwd: string;
  prompt: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "completed" | "error";
  error: string | null;
  events: SDKMessage[];
};

export async function runPhase<T>(args: {
  phase: PhaseName;
  phaseConfig: ResolvedPhaseConfig;
  cwd: string;
  additionalDirectories?: string[];
  taskSlug: string;
  harnessTaskId: string | null;
  prompt: string;
  outputSchema: z.ZodType<T>;
  resumeSessionId?: string | null;
  verbose?: boolean;
}): Promise<PhaseRunResult<T>> {
  const {
    phase,
    phaseConfig,
    cwd,
    additionalDirectories = [],
    taskSlug,
    harnessTaskId,
    prompt,
    outputSchema,
    resumeSessionId,
    verbose,
  } = args;

  const dir = sessionsDir(cwd, taskSlug);
  await mkdir(dir, { recursive: true });
  const ordinal = await nextOrdinalPrefix(dir);

  const record: SessionRecord = {
    phase,
    ordinal,
    task_slug: taskSlug,
    harness_task_id: harnessTaskId,
    session_id: null,
    cwd,
    prompt,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "running",
    error: null,
    events: [],
  };

  let currentPath: string | null = null;
  let structuredRaw: unknown = null;
  let resultSubtype: string | null = null;

  console.log(`[harness:${phase}] starting ordinal=${ordinal}`);
  if (harnessTaskId) console.log(`[harness:${phase}] task=${harnessTaskId}`);
  if (resumeSessionId)
    console.log(`[harness:${phase}] resuming session=${resumeSessionId}`);

  const guardHooks = buildGuardHooks({ phase, cwd, taskSlug });

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
        allowedTools: phaseConfig.allowedTools,
        permissionMode: phaseConfig.permissionMode,
        maxTurns: phaseConfig.maxTurns,
        effort: phaseConfig.effort,
        settingSources: ["project", "user"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: phaseConfig.prompt,
        },
        outputFormat: {
          type: "json_schema",
          schema: toJsonSchema(outputSchema),
        },
        ...(Object.keys(guardHooks).length > 0 ? { hooks: guardHooks } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(phaseConfig.model ? { model: phaseConfig.model } : {}),
        ...(Object.keys(phaseConfig.mcpServers).length > 0
          ? { mcpServers: phaseConfig.mcpServers }
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
        currentPath = join(dir, `${ordinal}_${message.session_id}.json`);
        console.log(`[harness:${phase}] session=${message.session_id}`);
      }

      if (message.type === "result") {
        resultSubtype = message.subtype;
        if (
          message.subtype === "success" &&
          "structured_output" in message &&
          message.structured_output !== undefined
        ) {
          structuredRaw = message.structured_output;
        }
      }

      if (currentPath) await writeJsonAtomic(currentPath, record);
      if (verbose) {
        console.log(`[harness:${phase}] event: ${message.type}`);
        console.dir(message, { depth: null, colors: true });
      } else {
        console.log(`[harness:${phase}] event: ${message.type}`);
      }
    }

    record.status = "completed";
  } catch (err) {
    record.status = "error";
    record.error = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[harness:${phase}] error:`, err);
  } finally {
    record.ended_at = new Date().toISOString();
    const finalPath =
      currentPath ?? join(dir, `${ordinal}_no-session-${Date.now()}.json`);
    await writeJsonAtomic(finalPath, record);
  }

  if (record.status === "error") {
    return {
      sessionId: record.session_id ?? "",
      status: "error",
      error: record.error,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }
  if (!record.session_id) {
    return {
      sessionId: "",
      status: "error",
      error: "no session_id received from SDK",
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }
  if (resultSubtype !== "success") {
    return {
      sessionId: record.session_id,
      status: "error",
      error: `phase ended with subtype=${resultSubtype ?? "unknown"}`,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }
  if (structuredRaw == null) {
    return {
      sessionId: record.session_id,
      status: "error",
      error: "result message had no structured_output",
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }

  const parsed = outputSchema.safeParse(structuredRaw);
  if (!parsed.success) {
    return {
      sessionId: record.session_id,
      status: "error",
      error: `structured_output failed schema validation: ${parsed.error.message}`,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }

  return {
    sessionId: record.session_id,
    status: "completed",
    error: null,
    structuredOutput: parsed.data,
    resultSubtype,
    events: record.events,
  };
}
