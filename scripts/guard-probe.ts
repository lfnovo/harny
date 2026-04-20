import { buildGuardHooks } from "../src/harness/guardHooks.js";
import type {
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

type TestCase = {
  name: string;
  phase: "developer" | "validator";
  tool_name: string;
  tool_input: Record<string, unknown>;
  expectDeny: boolean;
};

const CWD = "/tmp/harness-test-repo";
const TASK = "probe-task";

const cases: TestCase[] = [
  {
    name: "validator denies Write",
    phase: "validator",
    tool_name: "Write",
    tool_input: { file_path: `${CWD}/src/foo.ts`, content: "x" },
    expectDeny: true,
  },
  {
    name: "validator denies Edit",
    phase: "validator",
    tool_name: "Edit",
    tool_input: { file_path: `${CWD}/src/foo.ts`, old_string: "a", new_string: "b" },
    expectDeny: true,
  },
  {
    name: "validator allows Bash",
    phase: "validator",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    expectDeny: false,
  },
  {
    name: "developer denies Edit on plan.json",
    phase: "developer",
    tool_name: "Edit",
    tool_input: {
      file_path: `${CWD}/.harness/${TASK}/plan.json`,
      old_string: "a",
      new_string: "b",
    },
    expectDeny: true,
  },
  {
    name: "developer denies Write on plan.json (relative path)",
    phase: "developer",
    tool_name: "Write",
    tool_input: { file_path: `.harness/${TASK}/plan.json`, content: "x" },
    expectDeny: true,
  },
  {
    name: "developer allows Write on normal source file",
    phase: "developer",
    tool_name: "Write",
    tool_input: { file_path: `${CWD}/src/bar.ts`, content: "x" },
    expectDeny: false,
  },
  {
    name: "developer denies Bash git commit",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git commit -m 'fix'" },
    expectDeny: true,
  },
  {
    name: "developer denies Bash git push",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git push origin main" },
    expectDeny: true,
  },
  {
    name: "developer denies Bash git reset --hard",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git reset --hard HEAD~1" },
    expectDeny: true,
  },
  {
    name: "developer denies Bash git commit --amend",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git commit --amend --no-edit" },
    expectDeny: true,
  },
  {
    name: "developer allows Bash git status",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git status" },
    expectDeny: false,
  },
  {
    name: "developer allows Bash git diff",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "git diff HEAD" },
    expectDeny: false,
  },
  {
    name: "developer allows Bash npm test",
    phase: "developer",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    expectDeny: false,
  },
  {
    name: "developer allows git commit after cd to /tmp (throwaway)",
    phase: "developer",
    tool_name: "Bash",
    tool_input: {
      command: "cd /tmp/harness-e2e-abc && git commit -m seed",
    },
    expectDeny: false,
  },
  {
    name: "developer allows git commit after cd to /private/tmp",
    phase: "developer",
    tool_name: "Bash",
    tool_input: {
      command: "cd /private/tmp/throwaway && git init && git commit -m seed",
    },
    expectDeny: false,
  },
  {
    name: "developer allows git -C /tmp/... commit",
    phase: "developer",
    tool_name: "Bash",
    tool_input: {
      command: "git -C /tmp/harness-e2e-xyz commit -m seed",
    },
    expectDeny: false,
  },
  {
    name: "developer still denies cd into primary subdir then git commit",
    phase: "developer",
    tool_name: "Bash",
    tool_input: {
      command: `cd ${CWD}/src && git commit -m sneaky`,
    },
    expectDeny: true,
  },
  {
    name: "developer denies git -C pointing at primary",
    phase: "developer",
    tool_name: "Bash",
    tool_input: {
      command: `git -C ${CWD} commit -m sneaky`,
    },
    expectDeny: true,
  },
];

async function runCase(c: TestCase): Promise<{ pass: boolean; msg: string }> {
  const hooks = buildGuardHooks({
    phase: c.phase,
    cwd: CWD,
    taskSlug: TASK,
  });
  const matchers = hooks.PreToolUse ?? [];
  const input: PreToolUseHookInput = {
    hook_event_name: "PreToolUse",
    session_id: "test-session",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: CWD,
    permission_mode: "default",
    tool_name: c.tool_name,
    tool_input: c.tool_input,
    tool_use_id: "test-tool-use",
  };
  const signal = new AbortController().signal;

  let deniedBy: string | null = null;
  for (const m of matchers) {
    if (!matchesToolName(m.matcher, c.tool_name)) continue;
    for (const hook of m.hooks as HookCallback[]) {
      const out = await hook(input, "test-tool-use", { signal });
      const decision = extractDecision(out);
      if (decision === "deny") {
        deniedBy = m.matcher ?? "(no matcher)";
        break;
      }
    }
    if (deniedBy) break;
  }

  const denied = deniedBy != null;
  const pass = denied === c.expectDeny;
  return {
    pass,
    msg: `${pass ? "PASS" : "FAIL"}: ${c.name} — expected ${c.expectDeny ? "deny" : "allow"}, got ${denied ? `deny (${deniedBy})` : "allow"}`,
  };
}

function matchesToolName(matcher: string | undefined, toolName: string): boolean {
  if (!matcher) return true;
  const parts = matcher.split("|");
  return parts.includes(toolName);
}

function extractDecision(out: unknown): "allow" | "deny" | "other" {
  if (out == null || typeof out !== "object") return "other";
  const hso = (out as { hookSpecificOutput?: unknown }).hookSpecificOutput;
  if (
    hso != null &&
    typeof hso === "object" &&
    "permissionDecision" in hso &&
    typeof (hso as { permissionDecision?: unknown }).permissionDecision ===
      "string"
  ) {
    const d = (hso as { permissionDecision: string }).permissionDecision;
    if (d === "deny") return "deny";
    if (d === "allow") return "allow";
  }
  return "allow";
}

async function main() {
  let failed = 0;
  for (const c of cases) {
    const { pass, msg } = await runCase(c);
    console.log(msg);
    if (!pass) failed++;
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
