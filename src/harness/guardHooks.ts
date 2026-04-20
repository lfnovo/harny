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
  /\bgit\s+(?:[^;|&\s]+\s+)*?(commit|push|reset|rebase|merge|revert|cherry-pick|tag|am)(?:\s|;|\||&|$)|--amend\b/;

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

function validatorReadOnly(primaryCwd: string): HookCallback {
  const primary = resolve(primaryCwd);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    const filePath = readStringField(input.tool_input, "file_path");
    if (filePath) {
      const abs = resolve(primary, filePath);
      if (!isUnderPrimary(abs, primary)) return allowPreToolUse();
    }
    return denyPreToolUse(
      `Validator is read-only on the primary repo (${primary}). Tool "${input.tool_name}" at ${filePath ?? "<unknown path>"} is not permitted inside the primary. Writes to paths outside the primary (e.g., /tmp/harness-e2e-*) are allowed for empirical test setup. Report "fail" in your verdict instead of trying to fix primary code.`,
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

function developerGitCommitter(primaryCwd: string): HookCallback {
  const primary = resolve(primaryCwd);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    if (input.tool_name !== "Bash") return allowPreToolUse();
    const command = readStringField(input.tool_input, "command");
    if (command == null) return allowPreToolUse();
    if (!FORBIDDEN_GIT_COMMAND.test(command)) return allowPreToolUse();
    if (operatesOutsidePrimary(command, primary)) return allowPreToolUse();
    return denyPreToolUse(
      `The harness is the sole committer of the primary repo (${primary}). Do not run git history-modifying commands here (commit, push, reset, rebase, merge, revert, cherry-pick, tag, am, --amend). If you need to commit in a throwaway test repo, prefix with \`cd /tmp/<path>\` or use \`git -C /tmp/<path>\` — paths outside the primary repo are permitted. Propose a commit_message in your structured output instead for primary-repo commits.`,
    );
  };
}

function operatesOutsidePrimary(command: string, primaryResolved: string): boolean {
  const cdMatch = command.match(/^\s*cd\s+(['"]?)([^'"&;|\s]+)\1/);
  if (cdMatch) {
    const target = resolve(primaryResolved, cdMatch[2]!);
    if (!isUnderPrimary(target, primaryResolved)) return true;
  }
  const gitCMatches = [
    ...command.matchAll(/\bgit\s+-C\s+(['"]?)([^'"&;|\s]+)\1/g),
  ];
  if (gitCMatches.length > 0) {
    const allOutside = gitCMatches.every((m) => {
      const target = resolve(primaryResolved, m[2]!);
      return !isUnderPrimary(target, primaryResolved);
    });
    if (allOutside) return true;
  }
  return false;
}

function isUnderPrimary(target: string, primaryResolved: string): boolean {
  if (target === primaryResolved) return true;
  return target.startsWith(primaryResolved + "/");
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
        {
          matcher: WRITE_TOOLS_MATCHER,
          hooks: [validatorReadOnly(args.cwd)],
        },
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
        { matcher: "Bash", hooks: [developerGitCommitter(args.cwd)] },
      ],
    };
  }
  return {};
}
