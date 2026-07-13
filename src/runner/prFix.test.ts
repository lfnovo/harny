import { expect, test } from "bun:test";
import { handlePrFix, type PrFixDependencies } from "./prFix.js";
import type { HarnessRequest } from "../harness/orchestrator.js";

test("review-fix preflight pins the PR head and delegates all mutations to the workflow", async () => {
  const requests: HarnessRequest[] = []; let released = false;
  const pr = { number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", title: "Feature", body: "Body", baseRefName: "main", headRefName: "feature/review", headRefOid: "abc123", isDraft: true, comments: [{ body: "please fix" }], reviews: [] };
  const deps: Partial<PrFixDependencies> = {
    async resolveCwd() { return "/repo"; },
    async git(_cwd, args) { if (args.join(" ") === "remote get-url origin") return "git@github.com:o/r.git\n"; if (args[0] === "fetch") return ""; if (args.join(" ") === "rev-parse FETCH_HEAD") return "abc123\n"; throw new Error(`unexpected git ${args.join(" ")}`); },
    async gh() { return JSON.stringify(pr); },
    async acquireLease() { return { key: "lease", ownerRunId: "owner", acquiredAt: new Date().toISOString(), async release() { released = true; } }; },
    async run(request) { requests.push(request); return { status: "done", branch: "harny/fix", state: null }; },
  };
  await handlePrFix({ kind: "pr-fix", number: 42 }, { assistantName: null, logMode: "quiet" }, deps);
  expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ workflowId: "review-fix", startPoint: "abc123", inputs: { expected_remote_sha: "abc123", pull_request: { head: "feature/review" } } }); expect((requests[0]?.inputs?.tasks as Array<{ description: string }>)[0]?.description).toContain("[FEEDBACK_DATA]"); expect(released).toBe(true);
});

test("review-fix refuses a head changed during preflight", async () => {
  const deps: Partial<PrFixDependencies> = { async resolveCwd() { return "/repo"; }, async git(_cwd, args) { if (args.join(" ") === "remote get-url origin") return "https://github.com/o/r.git"; if (args[0] === "fetch") return ""; return "changed"; }, async gh() { return JSON.stringify({ number: 1, url: "u", state: "OPEN", title: "t", body: "", baseRefName: "main", headRefName: "h", headRefOid: "expected", isDraft: true, comments: [], reviews: [] }); } };
  await expect(handlePrFix({ kind: "pr-fix", number: 1 }, { assistantName: null, logMode: "quiet" }, deps)).rejects.toThrow("PR head changed before checkout");
});
