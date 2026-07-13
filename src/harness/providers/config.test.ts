import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConfiguredProviders, loadConnections } from "./config.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });
const metadata = (cwd: string) => ({ workflowId: "test", runId: "run", taskSlug: "task", primaryCwd: cwd, mode: "silent" as const, logMode: "quiet" as const });
async function config(value: unknown): Promise<string> { root ||= await mkdtemp(join(tmpdir(), "harny-providers-")); const path = join(root, "providers.json"); await writeFile(path, JSON.stringify(value)); return path; }

test("provider config is optional and keeps the built-in Claude and Codex connections", async () => {
  root = await mkdtemp(join(tmpdir(), "harny-providers-"));
  const providers = await createConfiguredProviders(metadata(root), { path: join(root, "missing.json"), env: {} });
  expect([...providers.keys()]).toEqual(["claude", "codex"]);
});

test("provider config creates logical connections without persisting secrets in fingerprints", async () => {
  const path = await config({ version: 1, providers: [
    { id: "claude_proxy", type: "claude", base_url: "https://claude.example.test", api_key_env: "CLAUDE_PROXY_KEY", model: "claude-test" },
    { id: "codex_proxy", type: "codex", base_url: "https://openai.example.test/v1", api_key_env: "CODEX_PROXY_KEY", model: "gpt-test" },
  ] });
  const first = await createConfiguredProviders(metadata(root), { path, env: { CLAUDE_PROXY_KEY: "secret-one", CODEX_PROXY_KEY: "secret-two" } });
  const second = await createConfiguredProviders(metadata(root), { path, env: { CLAUDE_PROXY_KEY: "rotated", CODEX_PROXY_KEY: "rotated" } });
  expect([...first.keys()]).toEqual(["claude", "codex", "claude_proxy", "codex_proxy"]);
  expect(first.get("claude_proxy")?.connectionFingerprint).toBe(second.get("claude_proxy")?.connectionFingerprint);
  expect(first.get("codex_proxy")?.connectionFingerprint).toBe(second.get("codex_proxy")?.connectionFingerprint);
  expect(first.get("claude_proxy")?.connectionFingerprint).not.toContain("secret");
});

test("provider config rejects duplicates, invalid URLs and missing key variables before execution", async () => {
  const duplicate = await config({ version: 1, providers: [{ id: "proxy", type: "codex" }, { id: "proxy", type: "claude" }] });
  await expect(loadConnections(duplicate)).rejects.toThrow("duplicate provider id");
  const invalid = await config({ version: 1, providers: [{ id: "proxy", type: "codex", base_url: "file:///tmp/socket" }] });
  await expect(loadConnections(invalid)).rejects.toThrow("base_url must use http or https");
  const missing = await config({ version: 1, providers: [{ id: "proxy", type: "codex", api_key_env: "PROXY_KEY" }] });
  await expect(createConfiguredProviders(metadata(root), { path: missing, env: {} })).rejects.toThrow("requires environment variable PROXY_KEY");
});
