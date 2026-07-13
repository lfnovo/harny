import type { ForgeProvider, PullRequestArtifact, PullRequestSpec } from "./types.js";
import { z } from "zod";

export type GhRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export class GitHubForgeProvider implements ForgeProvider {
  readonly id = "github";
  constructor(private readonly run: GhRunner = runGh) {}
  async findPullRequest(spec: Pick<PullRequestSpec, "repository" | "base" | "head">): Promise<PullRequestArtifact | null> {
    const result = await this.run(["pr", "list", "--repo", spec.repository, "--base", spec.base, "--head", spec.head, "--state", "open", "--json", "number,url,baseRefName,headRefName,headRefOid,isDraft", "--limit", "1"]);
    assertGh(result, "find pull request"); const row = PullRequestRowsSchema.parse(JSON.parse(result.stdout))[0];
    return row ? { repository: spec.repository, number: row.number, url: row.url, base: row.baseRefName, head: row.headRefName, headSha: row.headRefOid, draft: row.isDraft } : null;
  }
  async createPullRequest(spec: PullRequestSpec): Promise<PullRequestArtifact> {
    const args = ["pr", "create", "--repo", spec.repository, "--base", spec.base, "--head", spec.head, "--title", spec.title, "--body", spec.body]; if (spec.draft) args.push("--draft");
    const result = await this.run(args); assertGh(result, "create pull request");
    const created = await this.findPullRequest(spec); if (!created) throw new Error("GitHub reported PR creation but it could not be read back"); return created;
  }
  async updatePullRequest(pr: PullRequestArtifact, spec: PullRequestSpec): Promise<PullRequestArtifact> {
    const result = await this.run(["pr", "edit", String(pr.number), "--repo", spec.repository, "--base", spec.base, "--title", spec.title, "--body", spec.body]); assertGh(result, "update pull request");
    const updated = await this.findPullRequest(spec); if (!updated) throw new Error(`PR #${pr.number} disappeared after update`); return updated;
  }
}

async function runGh(args: string[]) { const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); return { code, stdout, stderr }; }
function assertGh(result: { code: number; stderr: string }, action: string) { if (result.code !== 0) throw new Error(`GitHub ${action} failed (exit ${result.code}): ${result.stderr.trim()}`); }
const PullRequestRowsSchema = z.array(z.object({ number: z.number(), url: z.string(), baseRefName: z.string(), headRefName: z.string(), headRefOid: z.string(), isDraft: z.boolean() }));
