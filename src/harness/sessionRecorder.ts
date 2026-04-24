import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { setupPhoenix, withPhaseContext } from "./observability/phoenix.js";
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
  AskUserQuestionInputSchema,
  type AskUserQuestionInput,
} from "./askUser.js";
import type { LogMode, PhaseName, ResolvedPhaseConfig, RunMode } from "./types.js";

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

/**
 * In-memory record of one phase's session. We don't persist this anymore —
 * the SDK already writes the full transcript to ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * (and Phoenix mirrors it via OpenInference instrumentation, when enabled).
 * Kept in-memory only to extract structured_output and bookkeeping for the
 * orchestrator's StateStore writes.
 */
type SessionRecord = {
  phase: PhaseName;
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

function formatAskUserInputError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "AskUserQuestion input invalid";
  const path = issue.path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    const s = String(seg);
    return acc ? `${acc}.${s}` : s;
  }, "");
  return `AskUserQuestion input invalid: ${path || "input"} — ${issue.message}`;
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
  workflowId: string;
  runId: string;
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
        `[harny:${args.phase}] transient API error on attempt ${attempt}/${MAX_TRANSIENT_RETRIES}; retrying in ${Math.round(delay / 1000)}s`,
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
  workflowId: string;
  runId: string;
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
    workflowId,
    runId,
  } = args;

  const phoenix = setupPhoenix({ workflowId, runId, taskSlug });
  const query = phoenix.query;

  const record: SessionRecord = {
    phase,
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

  let structuredRaw: unknown = null;
  let resultSubtype: string | null = null;
  let parkState: { askUserInput: AskUserQuestionInput; toolUseId: string | null } | null = null;

  const logBlock = (header: string, body: string) => {
    if (logMode === "quiet") return;
    console.log(`[harny:${phase}] ${header} >>>`);
    console.log(body);
    console.log(`[harny:${phase}] ${header} <<<`);
  };

  if (logMode !== "quiet") {
    console.log(`[harny:${phase}] starting`);
    if (harnessTaskId) console.log(`[harny:${phase}] task=${harnessTaskId}`);
    if (resumeSessionId)
      console.log(`[harny:${phase}] resuming session=${resumeSessionId}`);
  }
  logBlock("input", prompt);

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

  // Attach phase name to the OTel context so the rename processor relabels
  // the SDK's "ClaudeAgent.query" span to "harny.<phase>". No extra wrapping
  // span — keeps the trace tree flat: run → harny.<phase> → tool spans.
  await withPhaseContext(
    phoenix,
    phase,
    async () => {
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
            const parsed = AskUserQuestionInputSchema.safeParse(input);
            if (!parsed.success) {
              return {
                behavior: "deny",
                message: formatAskUserInputError(parsed.error),
              };
            }
            if (mode === "async") {
              // Park: stash the input, return deny+interrupt, the SDK's
              // for-await loop will throw with subtype=error_during_execution.
              // The outer catch converts parkState into PhaseRunResult with
              // status=paused_for_user_input.
              parkState = {
                askUserInput: parsed.data,
                toolUseId: ctx.toolUseID ?? null,
              };
              return {
                behavior: "deny",
                message: "Parked for async review; harness will exit waiting_human.",
                interrupt: true,
              };
            }
            // interactive
            return await runAskUserQuestionTTY(parsed.data);
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
        if (logMode !== "quiet") {
          console.log(`[harny:${phase}] session=${message.session_id}`);
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

      if (logMode === "verbose") {
        console.log(`[harny:${phase}] event: ${message.type}`);
        console.dir(message, { depth: null, colors: true });
      }
    }

        record.status = "completed";
      } catch (err) {
        if (parkState) {
          // Expected: SDK throws after canUseTool returns deny+interrupt:true.
          // Mark as completed — the park is intentional.
          record.status = "completed";
          record.error = null;
        } else {
          record.status = "error";
          record.error = err instanceof Error ? err.stack ?? err.message : String(err);
          console.error(`[harny:${phase}] error:`, err);
        }
      } finally {
        record.ended_at = new Date().toISOString();
      }
    },
  );

  if (parkState && record.session_id) {
    logBlock("output (paused)", "parked for async review");
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
    logBlock("output (error)", record.error ?? "unknown error");
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
    logBlock("output (error)", "no session_id received from SDK");
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
    const msg = `phase ended with subtype=${resultSubtype ?? "unknown"}`;
    logBlock("output (error)", msg);
    return {
      sessionId: record.session_id,
      status: "error",
      error: msg,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }
  if (structuredRaw == null) {
    logBlock("output (error)", "result message had no structured_output");
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
    const msg = `structured_output failed schema validation: ${parsed.error.message}`;
    logBlock("output (error)", msg);
    return {
      sessionId: record.session_id,
      status: "error",
      error: msg,
      structuredOutput: null,
      resultSubtype,
      events: record.events,
    };
  }

  logBlock("output", JSON.stringify(parsed.data, null, 2));

  return {
    sessionId: record.session_id,
    status: "completed",
    error: null,
    structuredOutput: parsed.data,
    resultSubtype,
    events: record.events,
  };
}
