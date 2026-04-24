import { describe, test, expect } from "bun:test";
import { parseArgs } from "./runner.js";

describe("parseArgs: subcommand ls", () => {
  test("no flags", () => {
    expect(parseArgs(["ls"]).registryCmd?.kind).toBe("ls");
  });
  test("--status space form", () => {
    expect((parseArgs(["ls", "--status", "done"]).registryCmd as any).status).toBe("done");
  });
  test("--status= form", () => {
    expect((parseArgs(["ls", "--status=done"]).registryCmd as any).status).toBe("done");
  });
  test("--cwd space form", () => {
    expect((parseArgs(["ls", "--cwd", "/some/path"]).registryCmd as any).cwd).toBe("/some/path");
  });
  test("--cwd= form", () => {
    expect((parseArgs(["ls", "--cwd=/some/path"]).registryCmd as any).cwd).toBe("/some/path");
  });
});

describe("parseArgs: subcommand show", () => {
  test("runId positional", () => {
    const cmd = parseArgs(["show", "abc123"]).registryCmd as any;
    expect(cmd?.kind).toBe("show");
    expect(cmd.runId).toBe("abc123");
  });
  test("--tail flag", () => {
    expect((parseArgs(["show", "abc123", "--tail"]).registryCmd as any).tail).toBeTruthy();
  });
  test("--since space form", () => {
    expect((parseArgs(["show", "abc123", "--since", "10m"]).registryCmd as any).since).toBe("10m");
  });
  test("--since= form", () => {
    expect((parseArgs(["show", "abc123", "--since=10m"]).registryCmd as any).since).toBe("10m");
  });
});

describe("parseArgs: subcommand answer", () => {
  test("runId positional", () => {
    const cmd = parseArgs(["answer", "run-xyz"]).registryCmd as any;
    expect(cmd?.kind).toBe("answer");
    expect(cmd.runId).toBe("run-xyz");
  });
});

describe("parseArgs: subcommand ui", () => {
  test("no flags", () => {
    expect((parseArgs(["ui"]).registryCmd as any)?.kind).toBe("ui");
  });
  test("--no-open", () => {
    expect((parseArgs(["ui", "--no-open"]).registryCmd as any).noOpen).toBeTruthy();
  });
  test("--port space form", () => {
    expect((parseArgs(["ui", "--port", "3000"]).registryCmd as any).port).toBe(3000);
  });
  test("--port= form", () => {
    expect((parseArgs(["ui", "--port=3000"]).registryCmd as any).port).toBe(3000);
  });
});

describe("parseArgs: subcommand clean", () => {
  test("slug positional", () => {
    const cmd = parseArgs(["clean", "my-run"]).registryCmd as any;
    expect(cmd?.kind).toBe("clean");
    expect(cmd.slug).toBe("my-run");
  });
  test("--force", () => {
    expect((parseArgs(["clean", "my-run", "--force"]).registryCmd as any).force).toBeTruthy();
  });
  test("--kill", () => {
    expect((parseArgs(["clean", "my-run", "--kill"]).registryCmd as any).kill).toBeTruthy();
  });
  test("--force + --kill", () => {
    const cmd = parseArgs(["clean", "my-run", "--force", "--kill"]).registryCmd as any;
    expect(cmd.force).toBeTruthy();
    expect(cmd.kill).toBeTruthy();
  });
});

describe("parseArgs: global flags", () => {
  test("--verbose", () => {
    expect(parseArgs(["--verbose"]).logMode).toBe("verbose");
  });
  test("-v short flag (regression 3d2dabd)", () => {
    expect(parseArgs(["-v"]).logMode).toBe("verbose");
  });
  test("--quiet", () => {
    expect(parseArgs(["--quiet"]).logMode).toBe("quiet");
  });
  test("--workflow space form", () => {
    expect(parseArgs(["--workflow", "feature-dev"]).workflow).toBe("feature-dev");
  });
  test("--workflow= form", () => {
    expect(parseArgs(["--workflow=feature-dev"]).workflow).toBe("feature-dev");
  });
  test("--workflow= with colon variant (regression 3d2dabd)", () => {
    const r = parseArgs(["--workflow=feature-dev:just-bugs", "some prompt"]);
    expect(r.workflow).toBe("feature-dev:just-bugs");
  });
  test("--assistant space form", () => {
    expect(parseArgs(["--assistant", "myproject"]).assistant).toBe("myproject");
  });
  test("--assistant= form", () => {
    expect(parseArgs(["--assistant=myproject"]).assistant).toBe("myproject");
  });
  test("--task space form", () => {
    expect(parseArgs(["--task", "issue-42"]).task).toBe("issue-42");
  });
  test("--task= form", () => {
    expect(parseArgs(["--task=issue-42"]).task).toBe("issue-42");
  });
  test("--isolation space form", () => {
    expect(parseArgs(["--isolation", "worktree"]).isolation).toBe("worktree");
  });
  test("--isolation= form", () => {
    expect(parseArgs(["--isolation=worktree"]).isolation).toBe("worktree");
  });
  test("--mode space form", () => {
    expect(parseArgs(["--mode", "silent"]).mode).toBe("silent");
  });
  test("--mode= form", () => {
    expect(parseArgs(["--mode=silent"]).mode).toBe("silent");
  });
});

describe("parseArgs: invalid --isolation", () => {
  test("--isolation=bad throws", () => {
    expect(() => parseArgs(["--isolation=bad"])).toThrow();
  });
  test("--isolation bad (space form) throws", () => {
    expect(() => parseArgs(["--isolation", "bad"])).toThrow();
  });
});

describe("parseArgs: no subcommand preserves prompt", () => {
  test("multi-word prompt joined with spaces", () => {
    const r = parseArgs(["implement", "feature", "X"]);
    expect(r.registryCmd).toBeNull();
    expect(r.prompt).toBe("implement feature X");
  });
  test("empty argv → null cmd, empty prompt", () => {
    const r = parseArgs([]);
    expect(r.registryCmd).toBeNull();
    expect(r.prompt).toBe("");
  });
});
