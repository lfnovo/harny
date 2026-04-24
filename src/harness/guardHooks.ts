/**
 * Security model for this module
 * ================================
 * The FORBIDDEN_GIT_COMMAND regex (see below) is best-effort defense-in-depth,
 * NOT a security boundary. Do not rely on it to prevent a determined or
 * adversarial actor from landing unauthorized commits.
 *
 * Known bypass shapes the regex does NOT catch:
 *   1. git;commit               — no-whitespace form; semicolon is not \s
 *   2. cd /good && cd /tmp && git commit
 *                               — operatesOutsidePrimary only inspects the
 *                                 leading `cd` segment, not subsequent ones
 *   3. GIT_DIR=/tmp/foo git commit
 *                               — env-var prefix form; `git` still matches a
 *                                 word boundary but the dir target is ignored
 *   4. $(echo git) commit / "git" commit
 *                               — shell substitution or quoting breaks \bgit\b
 *   5. git -c user.name=x commit
 *                               — handled by the non-greedy repetition in the
 *                                 regex today, but the pattern is fragile
 *
 * Real enforcement of the "only validated commits land on the harny branch"
 * invariant lives in the orchestrator's reset-before-return logic: on any
 * terminal state (pass, fail, blocked) the orchestrator resets the working
 * tree to the last known-good commit before handing control back. This hook
 * is supplementary, not primary.
 *
 * Threat model: accidental misuse by the developer agent (e.g., the agent
 * misreads its instructions and runs `git commit` directly). Adversarial
 * scenarios — where a malicious payload in a tool result deliberately
 * constructs bypass shapes to slip a commit through — are out of scope for
 * this regex. Handling those would require Option C: regex + real parser +
 * sandbox. Re-open as a separate RFC when that threat model becomes relevant.
 */
import { resolve } from "node:path";
import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { planFilePath } from "./state/plan.js";

/**
 * Composable guard policy. A workflow declares which invariants apply per
 * phase; the orchestrator wires up the matching hooks. Each flag adds one
 * deny rule. Defaults (all flags false) install no hooks.
 */
export type PhaseGuards = {
  /** Deny Write/Edit/MultiEdit/NotebookEdit on paths INSIDE the phase cwd. */
  readOnly?: boolean;
  /** Deny writes to .harny/<slug>/plan.json (sole-writer invariant). */
  noPlanWrites?: boolean;
  /** Deny Bash commands that mutate git history inside the phase cwd. */
  noGitHistory?: boolean;
};

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

/**
 * readOnly guard: denies Write/Edit/MultiEdit/NotebookEdit inside phase cwd.
 *
 * KNOWN GAP — does NOT cover Bash. A validator still running Bash can do
 * `echo 'fix' > file.ts`, `sed -i ...`, `rm`, `mv`, etc. We accept this gap
 * because validators legitimately need Bash to run tests and exercise
 * commands, and robustly parsing an arbitrary Bash command for mutations
 * (redirects, piped tools, implicit writes via tools like tee/sed -i) is
 * brittle. Mitigation is prompt discipline + `allowedTools` curation —
 * don't include tools the validator shouldn't need. If this gap ever bites
 * in production, the fix is to add a Bash-inspecting matcher here; until
 * then, we stay honest about the limit.
 */
function validatorReadOnly(phaseCwd: string): HookCallback {
  const phase = resolve(phaseCwd);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    const filePath = readStringField(input.tool_input, "file_path");
    if (filePath) {
      const abs = resolve(phase, filePath);
      if (!isUnderPrimary(abs, phase)) return allowPreToolUse();
    }
    return denyPreToolUse(
      `Validator is read-only on the phase working dir (${phase}). Tool "${input.tool_name}" at ${filePath ?? "<unknown path>"} is not permitted inside the phase dir. Writes to paths outside (e.g., /tmp/harny-e2e-*) are allowed for empirical test setup. Report "fail" in your verdict instead of trying to fix code.`,
    );
  };
}

function developerPlanWriter(
  primaryCwd: string,
  phaseCwd: string,
  taskSlug: string,
): HookCallback {
  const forbidden = resolve(planFilePath(primaryCwd, taskSlug));
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    const filePath = readStringField(input.tool_input, "file_path");
    if (filePath == null) return allowPreToolUse();
    const abs = resolve(phaseCwd, filePath);
    if (abs !== forbidden) return allowPreToolUse();
    return denyPreToolUse(
      `The harness is the sole writer of plan.json. Do not edit ${forbidden}.`,
    );
  };
}

function developerGitCommitter(phaseCwd: string): HookCallback {
  const phase = resolve(phaseCwd);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return allowPreToolUse();
    if (input.tool_name !== "Bash") return allowPreToolUse();
    const command = readStringField(input.tool_input, "command");
    if (command == null) return allowPreToolUse();
    if (!FORBIDDEN_GIT_COMMAND.test(command)) return allowPreToolUse();
    if (operatesOutsidePrimary(command, phase)) return allowPreToolUse();
    return denyPreToolUse(
      `The harness is the sole committer of the working dir (${phase}). Do not run git history-modifying commands here (commit, push, reset, rebase, merge, revert, cherry-pick, tag, am, --amend). If you need to commit in a throwaway test repo, prefix with \`cd /tmp/<path>\` or use \`git -C /tmp/<path>\` — paths outside the working dir are permitted. Propose a commit_message in your structured output instead.`,
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
  guards: PhaseGuards;
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
}): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  const writeMatchers: HookCallback[] = [];
  if (args.guards.readOnly) writeMatchers.push(validatorReadOnly(args.phaseCwd));
  if (args.guards.noPlanWrites) {
    writeMatchers.push(
      developerPlanWriter(args.primaryCwd, args.phaseCwd, args.taskSlug),
    );
  }

  const preToolUse: HookCallbackMatcher[] = [];
  if (writeMatchers.length > 0) {
    preToolUse.push({ matcher: WRITE_TOOLS_MATCHER, hooks: writeMatchers });
  }
  if (args.guards.noGitHistory) {
    preToolUse.push({
      matcher: "Bash",
      hooks: [developerGitCommitter(args.phaseCwd)],
    });
  }

  return preToolUse.length > 0 ? { PreToolUse: preToolUse } : {};
}
