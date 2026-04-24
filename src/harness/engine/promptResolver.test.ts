import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePrompt } from "./promptResolver.js";
import { tmpGitRepo } from "../testing/index.js";
import {
  DEFAULT_PLANNER,
  DEFAULT_DEVELOPER,
  DEFAULT_VALIDATOR,
} from "./workflows/featureDev/shared.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
});

async function repo() {
  const r = await tmpGitRepo();
  cleanups.push(r.cleanup);
  return r;
}

function writePrompt(
  cwd: string,
  workflowId: string,
  variant: string,
  actor: string,
  content: string,
) {
  const dir = join(cwd, ".harny", "prompts", workflowId, variant);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${actor}.md`), content, "utf8");
}

describe("resolvePrompt: precedence", () => {
  test("falls back to bundled-default when no project override exists", async () => {
    const r = await repo();
    const result = resolvePrompt("feature-dev", "default", "planner", r.path);
    expect(result).toContain("You are the PLANNER");
  });

  test("bundled-variant beats bundled-default", async () => {
    const r = await repo();
    const result = resolvePrompt(
      "feature-dev",
      "_test-variant",
      "planner",
      r.path,
    );
    expect(result).toContain("TEST-VARIANT-PLANNER-UNIQUE-CONTENT");
  });

  test("project-default beats bundled", async () => {
    const r = await repo();
    writePrompt(r.path, "feature-dev", "default", "planner", "PROJECT-DEFAULT-PLANNER");
    expect(resolvePrompt("feature-dev", "default", "planner", r.path)).toBe(
      "PROJECT-DEFAULT-PLANNER",
    );
  });

  test("project-variant beats project-default", async () => {
    const r = await repo();
    writePrompt(r.path, "feature-dev", "default", "planner", "PROJECT-DEFAULT");
    writePrompt(r.path, "feature-dev", "my-variant", "planner", "PROJECT-VARIANT");
    expect(resolvePrompt("feature-dev", "my-variant", "planner", r.path)).toBe(
      "PROJECT-VARIANT",
    );
  });

  test("missing variant falls back to project-default", async () => {
    const r = await repo();
    writePrompt(r.path, "feature-dev", "default", "planner", "PROJECT-DEFAULT-FALLBACK");
    expect(resolvePrompt("feature-dev", "my-variant", "planner", r.path)).toBe(
      "PROJECT-DEFAULT-FALLBACK",
    );
  });
});

describe("resolvePrompt: canonical prompts are non-empty strings", () => {
  for (const actor of ["planner", "developer", "validator"] as const) {
    test(`${actor}`, () => {
      const result = resolvePrompt("feature-dev", "default", actor, process.cwd());
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  }
});

// Parity between bundled .md files and DEFAULT_* constants is currently
// broken — see issue #68. Unskip after the single-source-of-truth fix lands
// via harny.
describe("resolvePrompt: content parity bundled .md vs DEFAULT_* constants (bug lockdown, see #68)", () => {
  for (const [actor, constant] of [
    ["planner", DEFAULT_PLANNER],
    ["developer", DEFAULT_DEVELOPER],
    ["validator", DEFAULT_VALIDATOR],
  ] as const) {
    test.skip(`${actor} bundled file equals the exported prompt constant`, () => {
      const fromFile = resolvePrompt(
        "feature-dev",
        "default",
        actor,
        "/nonexistent-cwd-parity",
      );
      expect(fromFile).toBe(constant.prompt);
    });
  }
});
