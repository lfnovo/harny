import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sessionsDir } from "./state/plan.js";
// The bundled `claude-code` binary silently ignores schemas with a top-level
// `$schema` key (which Zod emits by default). Strip it before passing in.
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void $schema;
  return rest;
}
import { buildGuardHooks, type PhaseGuards } from "./guardHooks.js";
import {
  runAskUserQuestionTTY,
  denyAskUserQuestionHeadless,
  type AskUserQuestionInput,
} from "./askUser.js";
import type { LogMode, PhaseName, ResolvedPhaseConfig, RunMode } from "./types.js";

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
  status: "completed" | "error" | "paused_for_user_input";
  error: string | null;
  structuredOutput: T | null;
  resultSubtype: string | null;
  events: SDKMessage[];
  /** Set when status === "paused_for_user_input". The SDK input is the
   *  AskUserQuestion batch (questions array); tool_use_id is the SDK's id. */
  parked?: {
    askUserInput: AskUserQuestionInput;
    toolUseId: string | null;
  };
};

type SessionRecord = {
  phase: PhaseName;
  ordinal: string;
  task_slug: string;
  harness_task_id: string | null;
  session_id: string | null;
  primary_cwd: string;
  phase_cwd: string;
  prompt: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "completed" | "error";
  error: string | null;
  events: SDKMessage[];
};

const MAX_TRANSIENT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_MAX_DELAY_MS = 30000;

function isTransientApiError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /overloaded_error|rate_limit_error|\b5(?:29|02|03|04)\b|\boverloaded\b/i.test(
    msg,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runPhase<T>(args: {
  phase: PhaseName;
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  additionalDirectories?: string[];
  taskSlug: string;
  harnessTaskId: string | null;
  prompt: string;
  outputSchema: z.ZodType<T>;
  resumeSessionId?: string | null;
  logMode?: LogMode;
  guards?: PhaseGuards;
  mode?: RunMode;
}): Promise<PhaseRunResult<T>> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const result = await runPhaseAttempt(args);
    // Only retry on transient SDK errors. paused_for_user_input is intentional
    // and must not be retried.
    if (
      result.status !== "error" ||
      !isTransientApiError(result.error) ||
      attempt >= MAX_TRANSIENT_RETRIES
    ) {
      return result;
    }
    const delay = Math.min(
      RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
      RETRY_MAX_DELAY_MS,
    );
    if (args.logMode !== "quiet") {
      console.log(
        `[harness:${args.phase}] transient API error on attempt ${attempt}/${MAX_TRANSIENT_RETRIES}; retrying in ${Math.round(delay / 1000)}s`,
      );
    }
    await sleep(delay);
  }
  throw new Error("unreachable: retry loop exited without returning");
}

async function runPhaseAttempt<T>(args: {
  phase: PhaseName;
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  additionalDirectories?: string[];
  taskSlug: string;
  harnessTaskId: string | null;
  prompt: string;
  outputSchema: z.ZodType<T>;
  resumeSessionId?: string | null;
  logMode?: LogMode;
  guards?: PhaseGuards;
  mode?: RunMode;
}): Promise<PhaseRunResult<T>> {
  const {
    phase,
    phaseConfig,
    primaryCwd,
    phaseCwd,
    additionalDirectories = [],
    taskSlug,
    harnessTaskId,
    prompt,
    outputSchema,
    resumeSessionId,
    logMode,
    guards = {},
    mode = "interactive",
  } = args;

  const dir = sessionsDir(primaryCwd, taskSlug);
  await mkdir(dir, { recursive: true });
  const ordinal = await nextOrdinalPrefix(dir);

  const record: SessionRecord = {
    phase,
    ordinal,
    task_slug: taskSlug,
    harness_task_id: harnessTaskId,
    session_id: null,
    primary_cwd: primaryCwd,
    phase_cwd: phaseCwd,
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
  let parkState: { askUserInput: AskUserQuestionInput; toolUseId: string | null } | null = null;

  if (logMode !== "quiet") {
    console.log(`[harness:${phase}] starting ordinal=${ordinal}`);
    if (harnessTaskId) console.log(`[harness:${phase}] task=${harnessTaskId}`);
    if (resumeSessionId)
      console.log(`[harness:${phase}] resuming session=${resumeSessionId}`);
  }

  const guardHooks = buildGuardHooks({
    guards,
    primaryCwd,
    phaseCwd,
    taskSlug,
  });

  // In silent mode, the agent never sees AskUserQuestion at all — strip it
  // before the SDK is told what tools are available. This is cleaner than
  // exposing the tool and denying every call (which burns tokens).
  const effectiveAllowedTools =
    mode === "silent"
      ? phaseConfig.allowedTools.filter((t) => t !== "AskUserQuestion")
      : phaseConfig.allowedTools;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: phaseCwd,
        ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
        allowedTools: effectiveAllowedTools,
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
        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>,
          ctx: { signal: AbortSignal; toolUseID?: string },
        ) => {
          if (toolName === "AskUserQuestion") {
            if (mode === "silent") {
              // Belt-and-suspenders: the tool is stripped from allowedTools
              // already; this deny only fires if the SDK routes anyway.
              return {
                behavior: "deny",
                message:
                  "AskUserQuestion is disabled in silent mode. Pick a defensible default and document the assumption.",
              };
            }
            if (mode === "async") {
              // Park: stash the input, return deny+interrupt, the SDK's
              // for-await loop will throw with subtype=error_during_execution.
              // The outer catch converts parkState into PhaseRunResult with
              // status=paused_for_user_input.
              parkState = {
                askUserInput: input as unknown as AskUserQuestionInput,
                toolUseId: ctx.toolUseID ?? null,
              };
              return {
                behavior: "deny",
                message: "Parked for async review; harness will exit waiting_human.",
                interrupt: true,
              };
            }
            // interactive
            return await runAskUserQuestionTTY(
              input as unknown as AskUserQuestionInput,
            );
          }
          return { behavior: "allow", updatedInput: input };
        },
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
        if (logMode !== "quiet") {
          console.log(`[harness:${phase}] session=${message.session_id}`);
        }
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
      if (logMode === "verbose") {
        console.log(`[harness:${phase}] event: ${message.type}`);
        console.dir(message, { depth: null, colors: true });
      }
    }

    record.status = "completed";
  } catch (err) {
    if (parkState) {
      // Expected: SDK throws after canUseTool returns deny+interrupt:true.
      // Mark the session record as completed (not an error — the park is intentional).
      record.status = "completed";
      record.error = null;
    } else {
      record.status = "error";
      record.error = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[harness:${phase}] error:`, err);
    }
  } finally {
    record.ended_at = new Date().toISOString();
    const finalPath =
      currentPath ?? join(dir, `${ordinal}_no-session-${Date.now()}.json`);
    await writeJsonAtomic(finalPath, record);
  }

  if (parkState && record.session_id) {
    return {
      sessionId: record.session_id,
      status: "paused_for_user_input",
      error: null,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
      parked: parkState,
    };
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
