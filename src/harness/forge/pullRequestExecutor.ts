import type { ForgeProvider, PullRequestSpec } from "./types.js";
import { parseTrustedGitHubRemote } from "./gitHubRemote.js";
import type { NodeExecutor } from "../workflow/runtime.js";

export type PullRequestGitRunner = (command: string[]) => Promise<string>;
export function createPullRequestExecutor(args: { cwd: string; forge: ForgeProvider; expectedSha: () => Promise<string>; expectedRemoteSha?: string; git?: PullRequestGitRunner }): NodeExecutor {
  return async (node) => {
    if (node.type !== "pull_request") throw new Error("pull_request executor received another node type");
    const runGit = args.git ?? ((command) => git(args.cwd, command));
    const expectedHeadSha = await args.expectedSha(); const remoteUrl = await runGit(["remote", "get-url", "origin"]); const repository = parseTrustedGitHubRemote(remoteUrl.trim());
    const pushUrl = await runGit(["remote", "get-url", "--push", "origin"]); const pushRepository = parseTrustedGitHubRemote(pushUrl.trim());
    if (pushRepository !== repository) throw new Error(`origin push URL targets ${pushRepository}, expected ${repository}`);
    const beforeLine = (await runGit(["ls-remote", "origin", `refs/heads/${node.head}`])).trim();
    const beforeSha = beforeLine.split(/\s+/)[0] || "";
    if (args.expectedRemoteSha !== undefined && beforeSha !== args.expectedRemoteSha) throw new Error(`remote head changed during run: expected ${args.expectedRemoteSha}, got ${beforeSha || "missing"}`);
    await runGit(["push", "-u", "origin", `${expectedHeadSha}:refs/heads/${node.head}`]);
    const remoteLine = (await runGit(["ls-remote", "origin", `refs/heads/${node.head}`])).trim(); const remoteSha = remoteLine.split(/\s+/)[0];
    if (remoteSha !== expectedHeadSha) throw new Error(`remote head diverged: expected ${expectedHeadSha}, got ${remoteSha || "missing"}`);
    const spec: PullRequestSpec = { repository, base: node.base, head: node.head, title: node.title, body: node.body, draft: node.draft, expectedHeadSha };
    const existing = await args.forge.findPullRequest(spec);
    if (node.existing === "require" && !existing) throw new Error(`existing PR required for ${node.head}`);
    if (node.existing === "forbid" && existing) throw new Error(`PR already exists for ${node.head}`);
    const result = existing ? await args.forge.updatePullRequest(existing, spec) : await args.forge.createPullRequest(spec);
    if (result.headSha !== expectedHeadSha) throw new Error(`PR head diverged: expected ${expectedHeadSha}, got ${result.headSha}`);
    return result;
  };
}
async function git(cwd: string, command: string[]): Promise<string> { const proc = Bun.spawn(["git", ...command], { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code !== 0) throw new Error(`git ${command[0]} failed (exit ${code}): ${stderr.trim()}`); return stdout; }
