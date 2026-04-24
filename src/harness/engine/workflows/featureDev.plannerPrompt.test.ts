import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createActor } from "xstate";
import { buildFeatureDevActors } from "./featureDevActors.js";
import { tmpGitRepo } from "../../testing/index.js";
import type { SessionRunPhase } from "../runtime/runPhaseAdapter.js";

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

// Runs the plannerActor with a capturing SessionRunPhase that throws after
// recording its inputs. The throw is intentional — we only need the inputs,
// not a successful Plan output. Returns { phaseConfigPrompt, runPhasePrompt }.
async function capturePlannerInputs(
  userPrompt: string,
  variant: string,
  cwd: string,
): Promise<{ phaseConfigPrompt?: string; runPhasePrompt?: string }> {
  let phaseConfigPrompt: string | undefined;
  let runPhasePrompt: string | undefined;
  const capturing: SessionRunPhase = async (args) => {
    phaseConfigPrompt = args.phaseConfig.prompt;
    runPhasePrompt = args.prompt;
    throw new Error("capture-abort");
  };
  const actors = buildFeatureDevActors({
    cwd,
    variant,
    taskSlug: "probe",
    runId: "probe",
    sessionRunPhase: capturing,
  });
  await new Promise<void>((resolve) => {
    const actor = createActor(actors.plannerActor, {
      input: { prompt: userPrompt, cwd },
    });
    actor.subscribe({
      next: (s) => {
        if (s.status !== "active") resolve();
      },
      error: () => resolve(),
    });
    actor.start();
  });
  return { phaseConfigPrompt, runPhasePrompt };
}

describe("feature-dev planner: variant routing reaches resolvePrompt", () => {
  const SENTINEL = "JUST-BUGS-PLANNER-SENTINEL-PROBE";

  test("variant='just-bugs' + project override → planner phaseConfig.prompt is the sentinel", async () => {
    const r = await repo();
    const dir = join(r.path, ".harny", "prompts", "feature-dev", "just-bugs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "planner.md"), SENTINEL);
    writeFileSync(join(dir, "developer.md"), "DEV");
    writeFileSync(join(dir, "validator.md"), "VAL");
    const { phaseConfigPrompt } = await capturePlannerInputs(
      "x",
      "just-bugs",
      r.path,
    );
    expect(phaseConfigPrompt).toBe(SENTINEL);
  });

  test("variant='default' (no project override) → phaseConfig.prompt is the bundled planner, non-empty and not the sentinel", async () => {
    const r = await repo();
    const { phaseConfigPrompt } = await capturePlannerInputs("x", "default", r.path);
    expect(phaseConfigPrompt).toBeTruthy();
    expect(phaseConfigPrompt).not.toBe(SENTINEL);
  });
});

describe("feature-dev planner: checklist-count constraint", () => {
  const cases: { name: string; userPrompt: string; expect: string | null }[] = [
    {
      name: "three unchecked items",
      userPrompt: [
        "Do the following:",
        "- [ ] First task",
        "- [ ] Second task",
        "- [ ] Third task",
      ].join("\n"),
      expect: "3 checklist item",
    },
    {
      name: "no checklist items",
      userPrompt: "Build a simple hello world program.",
      expect: null, // absence of 'checklist item'
    },
    {
      name: "mixed checked + unchecked",
      userPrompt: [
        "Complete these items:",
        "- [x] Already done task",
        "- [ ] Pending task one",
        "- [x] Another done task",
        "- [ ] Pending task two",
      ].join("\n"),
      expect: "4 checklist item",
    },
    { name: "indented bullet", userPrompt: "  - [ ] indented task", expect: "1 checklist item" },
    { name: "capital X marker", userPrompt: "- [X] Done", expect: "1 checklist item" },
    { name: "asterisk bullet", userPrompt: "* [ ] Star task", expect: "1 checklist item" },
    { name: "plus bullet", userPrompt: "+ [ ] Plus task", expect: "1 checklist item" },
    {
      name: "fenced code block ignored",
      userPrompt: ["- [ ] real task", "```", "- [ ] inside fence", "```"].join("\n"),
      expect: "1 checklist item",
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const r = await repo();
      const { runPhasePrompt } = await capturePlannerInputs(
        c.userPrompt,
        "default",
        r.path,
      );
      expect(runPhasePrompt).toBeDefined();
      if (c.expect === null) {
        expect(runPhasePrompt).not.toContain("checklist item");
      } else {
        expect(runPhasePrompt).toContain(c.expect);
      }
    });
  }
});
