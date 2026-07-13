import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { RunnerContext } from "./context.js";
import { resolveAssistant } from "./context.js";
import { acquireRunLease } from "../harness/state/lease.js";
import { FilesystemRunStoreV3 } from "../harness/state/v3/store.js";
import { writePointerV3, patchPointer } from "../harness/state/registry.js";
import { ClaudeProvider } from "../harness/providers/claude.js";
import { captureChangeSet, assertChangeSetUnchanged, commitChangeSet } from "../harness/git/changeSet.js";
import { DeveloperVerdictSchema } from "../harness/workflow/featureDevShared.js";
import { parseTrustedGitHubRemote } from "../harness/forge/gitHubRemote.js";
import { coldInstallWorktree } from "../harness/coldInstall.js";
import { realGitOps } from "../harness/gitOps.js";
import { listHistoricalRuns } from "../harness/state/v3/discovery.js";
import type { AgentProvider } from "../harness/providers/types.js";
import type { HistoricalRun } from "../harness/state/v3/reader.js";
import type { RunLease } from "../harness/state/lease.js";

const ValidatorSchema = z.object({ verdict: z.enum(["pass", "fail", "blocked"]), reasons: z.array(z.string()).default([]) });
const PrSchema = z.object({ number: z.number(), url: z.string(), state: z.string(), title: z.string(), body: z.string(), baseRefName: z.string(), headRefName: z.string(), headRefOid: z.string(), isDraft: z.boolean(), comments: z.array(z.unknown()).default([]), reviews: z.array(z.unknown()).default([]) });

export interface PrFixDependencies {
  resolveCwd(name: string | null): Promise<string>;
  git(cwd: string, args: string[]): Promise<string>;
  gh(args: string[]): Promise<string>;
  provider(meta: { workflowId: string; runId: string; taskSlug: string; primaryCwd: string; logMode: RunnerContext["logMode"] }): AgentProvider;
  coldInstall(args: { worktreePath: string; primaryCwd: string }): Promise<void>;
  removeWorktree(primaryCwd: string, worktree: string): Promise<void>;
  listRuns(): Promise<HistoricalRun[]>;
  acquireLease(root: string, key: string, ownerRunId: string): Promise<RunLease>;
  writePointer(run: Parameters<typeof writePointerV3>[0]): Promise<void>;
  patchPointer(runId: string, patch: Parameters<typeof patchPointer>[1]): Promise<void>;
}

const defaultDependencies: PrFixDependencies = {
  async resolveCwd(name) { return (await resolveAssistant(name)).cwd; }, git, gh,
  provider(meta) { return new ClaudeProvider({ ...meta, mode: "silent" }); },
  coldInstall: coldInstallWorktree,
  async removeWorktree(primaryCwd, worktree) { await realGitOps.removeWorktree(primaryCwd, worktree, { force: true }); },
  listRuns: listHistoricalRuns, acquireLease: acquireRunLease, writePointer: writePointerV3, patchPointer,
};

export async function handlePrFix(cmd: { kind: "pr-fix"; number: number }, ctx: RunnerContext, overrides: Partial<PrFixDependencies> = {}): Promise<void> {
  const deps = { ...defaultDependencies, ...overrides }; const primaryCwd = await deps.resolveCwd(ctx.assistantName); const origin = (await deps.git(primaryCwd, ["remote", "get-url", "origin"])).trim(); const repository = parseTrustedGitHubRemote(origin);
  const pr = PrSchema.parse(JSON.parse(await deps.gh(["pr", "view", String(cmd.number), "--repo", repository, "--json", "number,url,state,title,body,baseRefName,headRefName,headRefOid,isDraft,comments,reviews"])));
  if (pr.state !== "OPEN") throw new Error(`PR #${cmd.number} is not open (state=${pr.state})`);
  const parent = (await deps.listRuns()).find((candidate) => candidate.schema_version === 3 && candidate.raw.artifacts.pull_request && (candidate.raw.artifacts.pull_request.value as { number?: number; repository?: string }).number === cmd.number && (candidate.raw.artifacts.pull_request.value as { repository?: string }).repository === repository);
  const runId = randomUUID(); const taskSlug = `pr-${cmd.number}-fix-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`; const lease = await deps.acquireLease(primaryCwd, `github:${repository}#${cmd.number}`, runId);
  const branch = `harny/${taskSlug}`; const worktree = join(primaryCwd, ".harny", "worktrees", taskSlug); const store = new FilesystemRunStoreV3(primaryCwd, taskSlug); const now = new Date().toISOString();
  const initial = { schema_version: 3 as const, run: { id: runId, task_slug: taskSlug, workflow: "review-fix", status: "running" as const, started_at: now, ended_at: null, ended_reason: null, pid: process.pid, parent_run_id: parent?.id ?? null }, origin: { prompt: `Fix review feedback on PR #${cmd.number}`, workflow_source: "bundled/review-fix.yaml", cwd: primaryCwd, host: hostname(), user: userInfo().username }, workspace: { isolation: "worktree" as const, primary_cwd: primaryCwd, cwd: worktree, branch, worktree_path: worktree, reserved: true }, nodes: {}, artifacts: { pull_request: { id: "pull_request", type: "pull_request", created_at: now, producer: "input", value: { repository, ...pr } }, feedback: { id: "feedback", type: "review_feedback", created_at: now, producer: "gh", value: { comments: pr.comments, reviews: pr.reviews } } }, changesets: {}, deliverables: ["pull_request"], pending_human: null };
  try {
    await store.create(initial); await deps.writePointer(initial); await deps.git(primaryCwd, ["fetch", "origin", pr.headRefName]);
    const fetched = (await deps.git(primaryCwd, ["rev-parse", "FETCH_HEAD"])).trim(); if (fetched !== pr.headRefOid) throw new Error(`PR head changed before checkout: expected ${pr.headRefOid}, got ${fetched}`);
    await deps.git(primaryCwd, ["worktree", "add", "-b", branch, worktree, fetched]); await deps.coldInstall({ worktreePath: worktree, primaryCwd });
    const provider = deps.provider({ workflowId: "review-fix", runId, taskSlug, primaryCwd, logMode: ctx.logMode }); let devSession: { id: string; provider: string } | undefined;
    let committed: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const devRequest = { phase: "developer", taskId: `pr-${cmd.number}`, cwd: worktree, prompt: `Address the review feedback on PR #${cmd.number}.\n\n${JSON.stringify({ comments: pr.comments, reviews: pr.reviews }, null, 2)}`, schema: DeveloperVerdictSchema, guards: ["no_git_history"], allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] };
      const dev = devSession && provider.resume ? await provider.resume(devSession, devRequest) : await provider.run(devRequest); devSession = dev.session;
      if (dev.output.status === "blocked") throw new Error(`developer blocked: ${dev.output.blocked_reason ?? "unknown"}`);
      const changeSet = await captureChangeSet(worktree); await store.mutate((run) => { run.changesets[changeSet.id] = { ...changeSet, validated_by: null, committed_sha: null }; }, { type: "changeset.captured" });
      const validator = await provider.run({ phase: "validator", taskId: `pr-${cmd.number}`, cwd: worktree, prompt: `Validate the current changes against all feedback on PR #${cmd.number}.`, schema: ValidatorSchema, guards: ["read_only"], allowedTools: ["Read", "Glob", "Grep", "Bash"] });
      await assertChangeSetUnchanged(worktree, changeSet);
      if (validator.output.verdict === "blocked") throw new Error(`validator blocked: ${validator.output.reasons.join("; ")}`);
      if (validator.output.verdict === "fail") { if (attempt === 3) throw new Error(`validation exhausted: ${validator.output.reasons.join("; ")}`); continue; }
      committed = await commitChangeSet(worktree, dev.output.commit_message || `fix: address review feedback on #${cmd.number}`, changeSet);
      await store.mutate((run) => { const saved = run.changesets[changeSet.id]!; saved.validated_by = validator.session?.id ?? "validator"; saved.committed_sha = committed; }, { type: "changeset.committed" }); break;
    }
    if (!committed) throw new Error("review fix produced no commit");
    const beforePush = await remoteHead(deps.git, primaryCwd, pr.headRefName); if (beforePush !== pr.headRefOid) throw new Error(`PR head changed during run: expected ${pr.headRefOid}, got ${beforePush}`);
    await deps.git(worktree, ["push", "origin", `HEAD:refs/heads/${pr.headRefName}`]); const afterPush = await remoteHead(deps.git, primaryCwd, pr.headRefName); if (afterPush !== committed) throw new Error(`remote did not reach expected commit ${committed}`);
    const confirmed = PrSchema.parse(JSON.parse(await deps.gh(["pr", "view", String(cmd.number), "--repo", repository, "--json", "number,url,state,title,body,baseRefName,headRefName,headRefOid,isDraft,comments,reviews"]))); if (confirmed.headRefOid !== committed) throw new Error(`PR head confirmation failed: ${confirmed.headRefOid}`);
    const ended = new Date().toISOString(); await store.mutate((run) => { run.run.status = "done"; run.run.ended_at = ended; run.run.ended_reason = "pull_request_updated"; run.workspace.reserved = false; run.artifacts.pull_request = { id: "pull_request", type: "pull_request", created_at: ended, producer: "github", value: { repository, ...confirmed } }; }, { type: "pull_request.updated" }); await deps.patchPointer(runId, { status: "done", ended_at: ended });
    await deps.removeWorktree(primaryCwd, worktree); console.log(`[harny] updated PR #${cmd.number}: ${pr.url}`);
  } catch (error) {
    const ended = new Date().toISOString(); if (await store.load()) { await store.mutate((run) => { run.run.status = "failed"; run.run.ended_at = ended; run.run.ended_reason = String(error); }, { type: "run.failed" }); await deps.patchPointer(runId, { status: "failed", ended_at: ended }); }
    throw error;
  } finally { await lease.release(); }
}

async function remoteHead(runGit: PrFixDependencies["git"], cwd: string, branch: string) { const line = (await runGit(cwd, ["ls-remote", "origin", `refs/heads/${branch}`])).trim(); return line.split(/\s+/)[0] ?? ""; }
async function git(cwd: string, args: string[]) { const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`git ${args[0]} failed (exit ${code}): ${stderr.trim()}`); return stdout; }
async function gh(args: string[]) { const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`gh ${args[0]} failed (exit ${code}): ${stderr.trim()}`); return stdout; }
