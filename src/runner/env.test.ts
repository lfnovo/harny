import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureEnv } from "./env.js";

const SCRUBBED_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of [...SCRUBBED_KEYS, "HARNY_INHERIT_ENV", "HARNY_TEST_FOO"]) {
    snap[key] = process.env[key];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("configureEnv", () => {
  let tmpCwd: string;
  let tmpHome: string;
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "harny-env-cwd-"));
    tmpHome = mkdtempSync(join(tmpdir(), "harny-env-home-"));
    envSnap = snapshotEnv();
    for (const key of SCRUBBED_KEYS) delete process.env[key];
    delete process.env.HARNY_INHERIT_ENV;
  });

  afterEach(() => {
    restoreEnv(envSnap);
    rmSync(tmpCwd, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("HARNY_INHERIT_ENV=1 short-circuits all scrubbing and overlay", () => {
    process.env.HARNY_INHERIT_ENV = "1";
    process.env.ANTHROPIC_API_KEY = "shell-key";
    writeFileSync(join(tmpCwd, ".env"), "ANTHROPIC_API_KEY=dotenv-key\n");
    mkdirSync(join(tmpHome, ".harny"), { recursive: true });
    writeFileSync(join(tmpHome, ".harny", ".env"), "ANTHROPIC_API_KEY=global-key\n");

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.inherited).toBe(true);
    expect(result.scrubbed).toEqual([]);
    expect(process.env.ANTHROPIC_API_KEY).toBe("shell-key");
  });

  test("project .env mentions ANTHROPIC_API_KEY → scrubbed from process.env", () => {
    process.env.ANTHROPIC_API_KEY = "leaked-by-bun";
    writeFileSync(join(tmpCwd, ".env"), "ANTHROPIC_API_KEY=leaked-by-bun\n");

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.inherited).toBe(false);
    expect(result.scrubbed).toContain("ANTHROPIC_API_KEY");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("scrub is narrowed to keys actually present in project .env", () => {
    // Shell exports BASE_URL; project .env only leaks API_KEY. Only API_KEY
    // should be scrubbed; BASE_URL (shell-set) must survive.
    process.env.ANTHROPIC_API_KEY = "leaked";
    process.env.ANTHROPIC_BASE_URL = "https://shell.example";
    writeFileSync(join(tmpCwd, ".env"), "ANTHROPIC_API_KEY=leaked\n");

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.scrubbed).toEqual(["ANTHROPIC_API_KEY"]);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_BASE_URL).toBe("https://shell.example");
  });

  test("no project .env mentions Anthropic keys → process.env untouched", () => {
    process.env.ANTHROPIC_API_KEY = "shell-only";
    writeFileSync(join(tmpCwd, ".env"), "UNRELATED_VAR=foo\n");

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.scrubbed).toEqual([]);
    expect(process.env.ANTHROPIC_API_KEY).toBe("shell-only");
  });

  test("~/.harny/.env populates missing keys", () => {
    mkdirSync(join(tmpHome, ".harny"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".harny", ".env"),
      "ANTHROPIC_API_KEY=from-global\nANTHROPIC_BASE_URL=https://global.example\n",
    );

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.appliedFrom.global).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-global");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("https://global.example");
  });

  test("./harny.env overrides ~/.harny/.env", () => {
    mkdirSync(join(tmpHome, ".harny"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".harny", ".env"),
      "ANTHROPIC_API_KEY=from-global\nANTHROPIC_MODEL=global-model\n",
    );
    writeFileSync(
      join(tmpCwd, "harny.env"),
      "ANTHROPIC_API_KEY=from-project\n",
    );

    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(result.appliedFrom.global).toBe(true);
    expect(result.appliedFrom.project).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-project");
    // global-only key still applied
    expect(process.env.ANTHROPIC_MODEL).toBe("global-model");
  });

  test("project .env scrubs + harny.env replaces value", () => {
    process.env.ANTHROPIC_API_KEY = "leaked-by-bun";
    writeFileSync(join(tmpCwd, ".env"), "ANTHROPIC_API_KEY=leaked-by-bun\n");
    writeFileSync(join(tmpCwd, "harny.env"), "ANTHROPIC_API_KEY=harness-key\n");

    configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(process.env.ANTHROPIC_API_KEY).toBe("harness-key");
  });

  test("dotenv parsing handles quoted values and comments", () => {
    writeFileSync(
      join(tmpCwd, "harny.env"),
      [
        "# comment line",
        "ANTHROPIC_API_KEY=\"quoted-value\"",
        "ANTHROPIC_BASE_URL='single-quoted'",
        "ANTHROPIC_MODEL=plain # trailing",
        "",
      ].join("\n"),
    );

    configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(process.env.ANTHROPIC_API_KEY).toBe("quoted-value");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("single-quoted");
    expect(process.env.ANTHROPIC_MODEL).toBe("plain");
  });

  test("malformed lines are skipped", () => {
    writeFileSync(
      join(tmpCwd, "harny.env"),
      "no-equals-line\n=missing-key\nANTHROPIC_API_KEY=ok\n",
    );

    configureEnv({ cwd: tmpCwd, home: tmpHome });

    expect(process.env.ANTHROPIC_API_KEY).toBe("ok");
  });

  test("missing harny.env and ~/.harny/.env are silent no-ops", () => {
    const result = configureEnv({ cwd: tmpCwd, home: tmpHome });
    expect(result.appliedFrom.global).toBe(false);
    expect(result.appliedFrom.project).toBe(false);
    expect(result.scrubbed).toEqual([]);
  });
});
