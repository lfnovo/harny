import { expect, test } from "bun:test";
import { GitHubForgeProvider } from "./github.js";
import { parseTrustedGitHubRemote } from "./gitHubRemote.js";
import { createPullRequestExecutor } from "./pullRequestExecutor.js";
import type { ForgeProvider, PullRequestArtifact, PullRequestSpec } from "./types.js";
import { WorkflowDefinitionSchema } from "../workflow/schema.js";

test("trusted GitHub remote parser accepts SSH/HTTPS and rejects other forges", () => {
  expect(parseTrustedGitHubRemote("git@github.com:owner/repo.git")).toBe("owner/repo"); expect(parseTrustedGitHubRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
  expect(() => parseTrustedGitHubRemote("https://gitlab.com/owner/repo.git")).toThrow("not a trusted GitHub remote");
});

test("GitHub provider creates then reads back, and updates idempotently", async () => {
  const calls: string[][] = []; let exists = false;
  const provider = new GitHubForgeProvider(async (args) => { calls.push(args); if (args[1] === "create") { exists = true; return { code: 0, stdout: "url", stderr: "" }; } if (args[1] === "edit") return { code: 0, stdout: "", stderr: "" }; return { code: 0, stderr: "", stdout: exists ? JSON.stringify([{ number: 7, url: "https://github.com/o/r/pull/7", baseRefName: "main", headRefName: "feature", headRefOid: "abc", isDraft: true }]) : "[]" }; });
  const spec: PullRequestSpec = { repository: "o/r", base: "main", head: "feature", title: "Feature", body: "Body", draft: true, expectedHeadSha: "abc" };
  const created = await provider.createPullRequest(spec); expect(created.number).toBe(7); await provider.updatePullRequest(created, { ...spec, title: "Updated" });
  expect(calls.filter((call) => call[1] === "create")).toHaveLength(1); expect(calls.filter((call) => call[1] === "edit")).toHaveLength(1);
});
test("GitHub provider surfaces missing authentication before creating", async () => {
  const provider = new GitHubForgeProvider(async () => ({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, run: gh auth login" }));
  await expect(provider.createPullRequest({ repository: "o/r", base: "main", head: "feature", title: "x", body: "", draft: true, expectedHeadSha: "abc" })).rejects.toThrow("gh auth login");
});

class FakeForge implements ForgeProvider {
  id = "github"; existing: PullRequestArtifact | null = null; creates = 0; updates = 0;
  async findPullRequest() { return this.existing; }
  async createPullRequest(spec: PullRequestSpec) { this.creates++; return this.existing = { repository: spec.repository, number: 1, url: "url", base: spec.base, head: spec.head, headSha: spec.expectedHeadSha, draft: spec.draft }; }
  async updatePullRequest(_pr: PullRequestArtifact, spec: PullRequestSpec) { this.updates++; return { ...this.existing!, headSha: spec.expectedHeadSha }; }
}
const prNode = () => WorkflowDefinitionSchema.parse({ version: 1, name: "pr", defaults: { provider: "claude" }, workspace: { isolation: "worktree" }, outcome: { type: "pull_request" }, nodes: [{ id: "pr", type: "pull_request", title: "Feature", body: "", base: "main", head: "feature", draft: true, existing: "allow" }] }).nodes[0]!;

test("pull_request executor pushes without force, verifies remote SHA and is idempotent", async () => {
  const forge = new FakeForge(); const gitCalls: string[][] = []; const sha = "a".repeat(40);
  const executor = createPullRequestExecutor({ cwd: "/repo", forge, expectedSha: async () => sha, git: async (args) => { gitCalls.push(args); if (args[0] === "remote") return "git@github.com:o/r.git\n"; if (args[0] === "ls-remote") return `${sha}\trefs/heads/feature\n`; return ""; } });
  const context = { snapshot: { workflow: "pr", status: "running" as const, nodes: {} }, signal: new AbortController().signal };
  await executor(prNode(), context); await executor(prNode(), context);
  expect(forge.creates).toBe(1); expect(forge.updates).toBe(1); expect(gitCalls.filter((call) => call[0] === "push").every((call) => !call.includes("--force"))).toBe(true);
});

test("pull_request executor refuses a divergent remote head before publishing", async () => {
  const forge = new FakeForge(); const executor = createPullRequestExecutor({ cwd: "/repo", forge, expectedSha: async () => "a".repeat(40), git: async (args) => args[0] === "remote" ? "https://github.com/o/r.git" : args[0] === "ls-remote" ? `${"b".repeat(40)}\trefs/heads/feature` : "" });
  expect(executor(prNode(), { snapshot: { workflow: "pr", status: "running", nodes: {} }, signal: new AbortController().signal })).rejects.toThrow("remote head diverged"); expect(forge.creates).toBe(0);
});
