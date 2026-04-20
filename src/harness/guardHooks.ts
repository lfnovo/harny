import { resolve } from "node:path";
import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { planFilePath } from "./plan.js";
import type { PhaseName } from "./types.js";

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
const WRITE_TOOLS_MATCHER = WRITE_TOOLS.join("|");

const FORBIDDEN_GIT_COMMAND =
  /\bgit\s+(commit|push|reset|rebase|merge|revert|cherry-pick|tag|am)\b|--amend\b/;

function denyPreToolUse(reason: string): HookJSONOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function allowPreToolUse(): HookJSONOutput {
  return { continue: true };
}

function validatorReadOnly(): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    return denyPreToolUse(
      `Validator is read-only on code. Tool "${input.tool_name}" is not permitted. Report "fail" in your verdict instead of trying to fix the code.`,
    );
  };
}

function developerPlanWriter(cwd: string, taskSlug: string): HookCallback {
  const forbidden = resolve(planFilePath(cwd, taskSlug));
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    const filePath = readStringField(input.tool_input, "file_path");
    if (filePath == null) return allowPreToolUse();
    const abs = resolve(cwd, filePath);
    if (abs !== forbidden) return allowPreToolUse();
    return denyPreToolUse(
      `The harness is the sole writer of plan.json. Do not edit ${forbidden}.`,
    );
  };
}

function developerGitCommitter(): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    if (input.tool_name !== "Bash") return allowPreToolUse();
    const command = readStringField(input.tool_input, "command");
    if (command == null) return allowPreToolUse();
    if (!FORBIDDEN_GIT_COMMAND.test(command)) return allowPreToolUse();
    return denyPreToolUse(
      "The harness is the sole committer. Do not run git commands that change history (commit, push, reset, rebase, merge, revert, cherry-pick, tag, am, or --amend). Propose a commit_message in your structured output instead.",
    );
  };
}

function readStringField(toolInput: unknown, key: string): string | null {
  if (toolInput == null || typeof toolInput !== "object") return null;
  const value = (toolInput as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function buildGuardHooks(args: {
  phase: PhaseName;
  cwd: string;
  taskSlug: string;
}): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  if (args.phase === "validator") {
    return {
      PreToolUse: [
        { matcher: WRITE_TOOLS_MATCHER, hooks: [validatorReadOnly()] },
      ],
    };
  }
  if (args.phase === "developer") {
    return {
      PreToolUse: [
        {
          matcher: WRITE_TOOLS_MATCHER,
          hooks: [developerPlanWriter(args.cwd, args.taskSlug)],
        },
        { matcher: "Bash", hooks: [developerGitCommitter()] },
      ],
    };
  }
  return {};
}
