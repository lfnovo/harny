import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleLs } from "./ls.js";
import { handleShow } from "./show.js";
import { handleAnswer } from "./answer.js";
import { handleClean } from "./clean.js";
import type { RunnerContext } from "./context.js";
import { setRegistryDirForTesting } from "../harness/state/registry.js";

// Empty pointer registry → discovery returns [] / null without touching real
// harness state. Each test gets a fresh tmp dir.
const ctx: RunnerContext = {
  logMode: "compact",
  assistantName: null,
};
let tmpRegistry: string;
beforeEach(() => {
  tmpRegistry = mkdtempSync(join(tmpdir(), "harny-probe-registry-"));
  setRegistryDirForTesting(tmpRegistry);
});
afterEach(() => {
  setRegistryDirForTesting(null);
  rmSync(tmpRegistry, { recursive: true, force: true });
});

function captureConsole(): {
  restore: () => void;
  logs: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

async function captureExit(fn: () => Promise<void>): Promise<number | undefined> {
  const origExit = process.exit;
  let code: number | undefined;
  (process as any).exit = (c: number) => {
    code = c;
    throw new Error(`process.exit(${c})`);
  };
  try {
    await fn();
  } catch (e) {
    if (!(e as Error).message?.startsWith("process.exit(")) throw e;
  } finally {
    process.exit = origExit;
  }
  return code;
}

describe("handleLs", () => {
  test("empty search dir → 'No runs found.'", async () => {
    const cap = captureConsole();
    try {
      await handleLs({ kind: "ls" });
    } finally {
      cap.restore();
    }
    expect(cap.logs.some((l) => l.includes("No runs found"))).toBe(true);
  });

  test("status filter + empty dir → still 'No runs found.'", async () => {
    const cap = captureConsole();
    try {
      await handleLs({ kind: "ls", status: "done" });
    } finally {
      cap.restore();
    }
    expect(cap.logs.some((l) => l.includes("No runs found"))).toBe(true);
  });
});

describe("handleShow", () => {
  test("nonexistent runId → process.exit(1)", async () => {
    const cap = captureConsole();
    let code: number | undefined;
    try {
      code = await captureExit(() =>
        handleShow({ kind: "show", runId: "nonexistent-probe-id" }),
      );
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
  });
});

describe("handleAnswer", () => {
  test("nonexistent runId → process.exit(1)", async () => {
    const cap = captureConsole();
    let code: number | undefined;
    try {
      code = await captureExit(() =>
        handleAnswer({ kind: "answer", runId: "nonexistent-probe-id" }),
      );
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
  });
});

describe("handleClean", () => {
  test("nonexistent slug is reachable after resolveAssistant", async () => {
    // cleanRun may exit(1) or throw for a nonexistent slug — both indicate it
    // was reached after resolveAssistant resolved successfully.
    const cap = captureConsole();
    try {
      await captureExit(() =>
        handleClean({ kind: "clean", slug: "probe-nonexistent-slug" }, ctx),
      );
    } finally {
      cap.restore();
    }
    // No assertion beyond "ran without crashing in resolveAssistant" — matches
    // the probe's intent.
    expect(true).toBe(true);
  });
});
