import { z } from "zod";
import type { RunnerContext } from "./context.js";
import { resolveAssistant } from "./context.js";
import { acquireRunLease, type RunLease } from "../harness/state/lease.js";
import { listRuns } from "../harness/state/runDiscovery.js";
import { parseTrustedGitHubRemote } from "../harness/forge/gitHubRemote.js";
import { runHarness, type HarnessRequest, type HarnessResult } from "../harness/orchestrator.js";

const PrSchema = z.object({ number: z.number(), url: z.string(), state: z.string(), title: z.string(), body: z.string(), baseRefName: z.string(), headRefName: z.string(), headRefOid: z.string(), isDraft: z.boolean(), comments: z.array(z.unknown()).default([]), reviews: z.array(z.unknown()).default([]) });

export interface PrFixDependencies {
  resolveCwd(name: string | null): Promise<string>;
  git(cwd: string, args: string[]): Promise<string>;
  gh(args: string[]): Promise<string>;
  acquireLease(root: string, key: string, ownerRunId: string): Promise<RunLease>;
  run(request: HarnessRequest): Promise<HarnessResult>;
}
const defaults: PrFixDependencies = { async resolveCwd(name) { return (await resolveAssistant(name)).cwd; }, git, gh, acquireLease: acquireRunLease, run: runHarness };

/** PR fix is only a preflight; all code-changing work runs through review-fix.yaml. */
export async function handlePrFix(cmd: { kind: "pr-fix"; number: number }, ctx: RunnerContext, overrides: Partial<PrFixDependencies> = {}): Promise<void> {
  const deps = { ...defaults, ...overrides };
  const primaryCwd = await deps.resolveCwd(ctx.assistantName);
  const repository = parseTrustedGitHubRemote((await deps.git(primaryCwd, ["remote", "get-url", "origin"])).trim());
  const pr = PrSchema.parse(JSON.parse(await deps.gh(["pr", "view", String(cmd.number), "--repo", repository, "--json", "number,url,state,title,body,baseRefName,headRefName,headRefOid,isDraft,comments,reviews"])));
  if (pr.state !== "OPEN") throw new Error(`PR #${cmd.number} is not open (state=${pr.state})`);
  await deps.git(primaryCwd, ["fetch", "origin", pr.headRefName]);
  const fetched = (await deps.git(primaryCwd, ["rev-parse", "FETCH_HEAD"])).trim();
  if (fetched !== pr.headRefOid) throw new Error(`PR head changed before checkout: expected ${pr.headRefOid}, got ${fetched}`);
  const parent = (await listRuns()).find((candidate) => Object.values(candidate.execution.nodes).some((node) => { const output = node.output as { number?: number; repository?: string } | undefined; return output?.number === cmd.number && output.repository === repository; }));
  const taskSlug = `pr-${cmd.number}-fix-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const lease = await deps.acquireLease(primaryCwd, `github:${repository}#${cmd.number}`, taskSlug);
  try {
    const feedback = { comments: pr.comments, reviews: pr.reviews };
    const result = await deps.run({ cwd: primaryCwd, userPrompt: `Fix review feedback on PR #${cmd.number}`, taskSlug, workflowId: "review-fix", mode: "silent", logMode: ctx.logMode, startPoint: fetched, parentRunId: parent?.run.id, inputs: { expected_remote_sha: pr.headRefOid, pull_request: { repository, number: pr.number, url: pr.url, title: pr.title, body: pr.body, base: pr.baseRefName, head: pr.headRefName, headSha: pr.headRefOid }, tasks: [{ id: `pr-${cmd.number}`, title: `Address review feedback on PR #${cmd.number}`, description: JSON.stringify(feedback, null, 2), acceptance: ["All actionable review comments are addressed", "Validation passes"] }] } });
    if (result.status !== "done") throw new Error(`review-fix ended with ${result.status}`);
    console.log(`[harny] updated PR #${cmd.number}: ${pr.url}`);
  } finally { await lease.release(); }
}

async function git(cwd: string, args: string[]) { const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`git ${args[0]} failed (exit ${code}): ${stderr.trim()}`); return stdout; }
async function gh(args: string[]) { const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`gh ${args[0]} failed (exit ${code}): ${stderr.trim()}`); return stdout; }
