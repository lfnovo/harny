import { describe, test, expect } from "bun:test";
import { runCommand } from "./command.js";

describe("runCommand: happy paths", () => {
  test("exit 0 resolves with stdout and exit_code=0", async () => {
    const controller = new AbortController();
    const result = await runCommand(
      { cmd: ["echo", "hello"] },
      controller.signal,
    );
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  test("non-zero exit resolves (not throws) with the exit code preserved", async () => {
    const controller = new AbortController();
    const result = await runCommand(
      { cmd: ["sh", "-c", "exit 42"] },
      controller.signal,
    );
    expect(result.exit_code).toBe(42);
  });
});

describe("runCommand: abort + timeout", () => {
  test("timeout_ms kills the process and rejects with 'timed out'", async () => {
    const controller = new AbortController();
    await expect(
      runCommand(
        { cmd: ["sleep", "10"], timeout_ms: 100 },
        controller.signal,
      ),
    ).rejects.toThrow(/timed out/);
  });

  test("AbortController signal fires mid-run → rejects with 'aborted'", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      runCommand({ cmd: ["sleep", "10"] }, controller.signal),
    ).rejects.toThrow(/aborted/);
  });
});
