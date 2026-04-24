import { describe, test, expect } from "bun:test";
import { buildGuardHooks, type PhaseGuards } from "./guardHooks.js";

const PHASE_CWD = "/tmp/harny-probe-phase";
const PRIMARY_CWD = PHASE_CWD;
const TASK_SLUG = "probe-task";

type Expected = "allow" | "deny";

function baseInput(toolName: string, toolInput: Record<string, unknown>) {
  return {
    session_id: "probe-session",
    transcript_path: "/tmp/probe-transcript",
    cwd: PHASE_CWD,
    hook_event_name: "PreToolUse" as const,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "probe-tool-use",
  };
}

// Mimics the SDK's matcher dispatch: pick only the hook groups whose matcher
// regex matches toolName, run their callbacks in order. First deny wins.
async function evaluate(
  guards: PhaseGuards,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<Expected> {
  const built = buildGuardHooks({
    guards,
    primaryCwd: PRIMARY_CWD,
    phaseCwd: PHASE_CWD,
    taskSlug: TASK_SLUG,
  });
  const groups = built.PreToolUse ?? [];
  const input = baseInput(toolName, toolInput);
  for (const g of groups) {
    if (!g.matcher) continue;
    if (!new RegExp(`^(?:${g.matcher})$`).test(toolName)) continue;
    for (const cb of g.hooks) {
      const out: any = await cb(input as any, "probe-tool-use-id", {
        signal: new AbortController().signal,
      });
      const decision = out?.hookSpecificOutput?.permissionDecision;
      if (decision === "deny") return "deny";
    }
  }
  return "allow";
}

describe("guardHooks: readOnly (validator)", () => {
  test("Edit inside phaseCwd is denied", async () => {
    expect(
      await evaluate({ readOnly: true }, "Edit", {
        file_path: `${PHASE_CWD}/src/foo.ts`,
      }),
    ).toBe("deny");
  });

  test("Edit outside phaseCwd (throwaway) is allowed", async () => {
    expect(
      await evaluate({ readOnly: true }, "Edit", {
        file_path: "/tmp/harny-e2e-abc/foo.ts",
      }),
    ).toBe("allow");
  });

  test("Write inside phaseCwd is denied", async () => {
    expect(
      await evaluate({ readOnly: true }, "Write", {
        file_path: `${PHASE_CWD}/src/bar.ts`,
      }),
    ).toBe("deny");
  });

  test("MultiEdit inside phaseCwd is denied", async () => {
    expect(
      await evaluate({ readOnly: true }, "MultiEdit", {
        file_path: `${PHASE_CWD}/src/baz.ts`,
      }),
    ).toBe("deny");
  });

  test("Read is not matched (matcher only covers write tools)", async () => {
    expect(
      await evaluate({ readOnly: true }, "Read", {
        file_path: `${PHASE_CWD}/src/foo.ts`,
      }),
    ).toBe("allow");
  });

  test("Bash is not covered (documented gap)", async () => {
    expect(
      await evaluate({ readOnly: true }, "Bash", {
        command: `echo "fix" > ${PHASE_CWD}/src/foo.ts`,
      }),
    ).toBe("allow");
  });
});

describe("guardHooks: noPlanWrites (developer)", () => {
  test("Write to plan.json is denied", async () => {
    expect(
      await evaluate({ noPlanWrites: true }, "Write", {
        file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/plan.json`,
      }),
    ).toBe("deny");
  });

  test("Edit to plan.json (relative path) is denied", async () => {
    expect(
      await evaluate({ noPlanWrites: true }, "Edit", {
        file_path: `.harny/${TASK_SLUG}/plan.json`,
      }),
    ).toBe("deny");
  });

  test("Write to other file in same run dir is allowed", async () => {
    expect(
      await evaluate({ noPlanWrites: true }, "Write", {
        file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/other.json`,
      }),
    ).toBe("allow");
  });

  test("Write to src/ is allowed", async () => {
    expect(
      await evaluate({ noPlanWrites: true }, "Write", {
        file_path: `${PHASE_CWD}/src/foo.ts`,
      }),
    ).toBe("allow");
  });
});

describe("guardHooks: noGitHistory (developer)", () => {
  test("git commit is denied", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: 'git commit -am "wip"',
      }),
    ).toBe("deny");
  });

  test("git reset --hard is denied", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: "git reset --hard HEAD~1",
      }),
    ).toBe("deny");
  });

  test("git push is denied", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: "git push origin main",
      }),
    ).toBe("deny");
  });

  test("git rebase is denied", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: "git rebase main",
      }),
    ).toBe("deny");
  });

  test("--amend anywhere is denied", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: 'git commit --amend -m "oops"',
      }),
    ).toBe("deny");
  });

  test("cd /tmp/foo && git commit is allowed (escape hatch)", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: 'cd /tmp/foo && git commit -am "test repo"',
      }),
    ).toBe("allow");
  });

  test("git -C /tmp/foo commit is allowed (escape hatch)", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: 'git -C /tmp/foo commit -am "test repo"',
      }),
    ).toBe("allow");
  });

  test("git status is allowed (not a forbidden verb)", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", { command: "git status" }),
    ).toBe("allow");
  });

  test("git log is allowed", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", {
        command: "git log --oneline -5",
      }),
    ).toBe("allow");
  });

  test("non-git Bash is allowed", async () => {
    expect(
      await evaluate({ noGitHistory: true }, "Bash", { command: "echo hello" }),
    ).toBe("allow");
  });
});

describe("guardHooks: combos (multiple flags compose additively)", () => {
  test("noPlanWrites + noGitHistory — plan.json denied", async () => {
    expect(
      await evaluate(
        { noPlanWrites: true, noGitHistory: true },
        "Write",
        { file_path: `.harny/${TASK_SLUG}/plan.json` },
      ),
    ).toBe("deny");
  });

  test("noPlanWrites + noGitHistory — git commit denied", async () => {
    expect(
      await evaluate(
        { noPlanWrites: true, noGitHistory: true },
        "Bash",
        { command: 'git commit -am "wip"' },
      ),
    ).toBe("deny");
  });

  test("noPlanWrites + noGitHistory — src/ write is allowed", async () => {
    expect(
      await evaluate(
        { noPlanWrites: true, noGitHistory: true },
        "Write",
        { file_path: `${PHASE_CWD}/src/foo.ts` },
      ),
    ).toBe("allow");
  });
});

describe("guardHooks: empty guards (no hooks installed)", () => {
  test("Edit plan.json is allowed", async () => {
    expect(
      await evaluate({}, "Edit", {
        file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/plan.json`,
      }),
    ).toBe("allow");
  });

  test("git reset is allowed", async () => {
    expect(
      await evaluate({}, "Bash", { command: "git reset --hard" }),
    ).toBe("allow");
  });

  test("buildGuardHooks returns no PreToolUse when all flags are false", () => {
    const built = buildGuardHooks({
      guards: {},
      primaryCwd: PRIMARY_CWD,
      phaseCwd: PHASE_CWD,
      taskSlug: TASK_SLUG,
    });
    expect(built.PreToolUse).toBeUndefined();
  });
});
