export interface PullRequestArtifact { repository: string; number: number; url: string; base: string; head: string; headSha: string; draft: boolean; }
export interface PullRequestSpec { repository: string; base: string; head: string; title: string; body: string; draft: boolean; expectedHeadSha: string; }
export interface ForgeProvider {
  id: string;
  findPullRequest(spec: Pick<PullRequestSpec, "repository" | "head">): Promise<PullRequestArtifact | null>;
  createPullRequest(spec: PullRequestSpec): Promise<PullRequestArtifact>;
  updatePullRequest(pr: PullRequestArtifact, spec: PullRequestSpec): Promise<PullRequestArtifact>;
}
