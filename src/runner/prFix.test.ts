import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentProvider } from "../harness/providers/types.js";
import { handlePrFix, type PrFixDependencies } from "./prFix.js";
import type { RunV3 } from "../harness/state/v3/schema.js";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
}

test("review-fix safely updates the existing PR head and persists a linked v3 run", async () => {
  const root = await mkdtemp(join(tmpdir(), "harny-pr-fix-"));
  const primary = join(root, "repo"); const remote = join(root, "remote.git");
  await mkdir(primary); await mkdir(remote);
  try {
    await runGit(remote, ["init", "--bare", "-q"]); await runGit(primary, ["init", "-q"]);
    await runGit(primary, ["config", "user.email", "test@example.com"]); await runGit(primary, ["config", "user.name", "Test"]);
    await writeFile(join(primary, "README.md"), "base\n"); await runGit(primary, ["add", "."]); await runGit(primary, ["commit", "-qm", "base"]);
    await runGit(primary, ["branch", "-M", "main"]); await runGit(primary, ["remote", "add", "origin", remote]); await runGit(primary, ["push", "-u", "origin", "main"]);
    await runGit(primary, ["checkout", "-qb", "feature/review"]); await writeFile(join(primary, "feature.txt"), "before\n"); await runGit(primary, ["add", "."]); await runGit(primary, ["commit", "-qm", "feat: review"]); await runGit(primary, ["push", "-u", "origin", "feature/review"]); await runGit(primary, ["checkout", "main"]);
    const initialHead = (await runGit(primary, ["rev-parse", "origin/feature/review"])).trim();
    const provider: AgentProvider = {
      id: "claude", capabilities: { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true },
      async run(request) {
        if (request.phase === "developer") {
          await writeFile(join(request.cwd, "feature.txt"), "after review\n");
          return { output: request.schema.parse({ task_id: "pr-42", status: "done", summary: "fixed", commit_message: "fix: address review" }), session: { id: "dev", provider: "claude" } };
        }
        return { output: request.schema.parse({ verdict: "pass", reasons: ["feedback addressed"] }), session: { id: "validator", provider: "claude" } };
      },
    };
    const prJson = async () => JSON.stringify({ number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", title: "Feature", body: "", baseRefName: "main", headRefName: "feature/review", headRefOid: (await runGit(primary, ["ls-remote", "origin", "refs/heads/feature/review"])).trim().split(/\s+/)[0], isDraft: true, comments: [{ body: "please fix" }], reviews: [] });
    const parentRaw: RunV3 = { schema_version: 3, run: { id: "parent-run", task_slug: "feature-pr", workflow: "feature-pr", status: "done", started_at: new Date().toISOString(), ended_at: new Date().toISOString(), ended_reason: "done", pid: 1, parent_run_id: null }, origin: { prompt: "feature", workflow_source: "feature-pr", cwd: primary, host: "host", user: "user" }, workspace: { isolation: "worktree", primary_cwd: primary, cwd: primary, branch: "feature/review", worktree_path: null, reserved: false }, nodes: {}, artifacts: { pull_request: { id: "pull_request", type: "pull_request", created_at: new Date().toISOString(), producer: "github", value: { repository: "o/r", number: 42 } } }, changesets: {}, deliverables: ["pull_request"], pending_human: null };
    const deps: Partial<PrFixDependencies> = {
      async resolveCwd() { return primary; },
      async git(cwd, args) { if (args.join(" ") === "remote get-url origin") return "git@github.com:o/r.git\n"; return runGit(cwd, args); },
      async gh() { return prJson(); }, provider() { return provider; }, async coldInstall() {},
      async writePointer() {}, async patchPointer() {}, async listRuns() { return [{ schema_version: 3, id: "parent-run", workflow: "feature-pr", status: "done", started_at: parentRaw.run.started_at, ended_at: parentRaw.run.ended_at, cwd: primary, branch: "feature/review", resumable: true, raw: parentRaw }]; },
    };
    await handlePrFix({ kind: "pr-fix", number: 42 }, { assistantName: null, logMode: "quiet" }, deps);
    const finalHead = (await runGit(primary, ["ls-remote", "origin", "refs/heads/feature/review"])).trim().split(/\s+/)[0]!;
    expect(finalHead).not.toBe(initialHead);
    const entries = await readdir(join(primary, ".harny")); const slug = entries.find((entry) => entry.startsWith("pr-42-fix-"))!;
    const run = JSON.parse(await readFile(join(primary, ".harny", slug, "run.json"), "utf8"));
    expect(run.run.status).toBe("done"); expect(run.run.workflow).toBe("review-fix"); expect(run.run.parent_run_id).toBe("parent-run"); expect(run.workspace.reserved).toBe(false);
    expect(Object.values(run.changesets)[0]).toMatchObject({ validated_by: "validator", committed_sha: finalHead });
    expect(run.artifacts.pull_request.value.headRefOid).toBe(finalHead);
  } finally { await rm(root, { recursive: true, force: true }); }
});
