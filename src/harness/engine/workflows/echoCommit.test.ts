import { describe, test, expect, afterEach } from "bun:test";
import { createActor } from "xstate";
import echoCommitWorkflow from "./echoCommit.js";
import { tmpGitRepo } from "../../testing/index.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
});

async function repo() {
  const r = await tmpGitRepo({ seed: {} });
  cleanups.push(r.cleanup);
  return r;
}

async function spawn(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return (await new Response(proc.stdout!).text()).trim();
}

describe("echoCommit workflow", () => {
  test("end-to-end: running → committing → done, producing a valid sha and a new commit", async () => {
    const r = await repo();
    const snapshot = await new Promise<any>((resolve, reject) => {
      const actor = createActor(echoCommitWorkflow.machine, {
        input: { cwd: r.path },
      });
      actor.subscribe({
        next: (s) => {
          if (s.status === "done" && s.value === "done") resolve(s);
          if (s.status === "done" && s.value === "failed") {
            reject(new Error("machine reached failed state"));
          }
        },
        error: (err) =>
          reject(err instanceof Error ? err : new Error(String(err))),
      });
      actor.start();
    });

    expect(snapshot.context.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const log = await spawn(["log", "--oneline", "-n", "2"], r.path);
    expect(log).toContain("seed");
    expect(log).toContain("add note");
  });
});
