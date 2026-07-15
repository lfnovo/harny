/**
 * Viewer server — read-only HTTP wrapper over current runs.
 *
 * Spawned by `harny ui`. Lives only as long as the parent CLI process.
 * No writes, no auth, binds to 127.0.0.1 only.
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { listRuns, listRunsInCwd } from "../harness/state/runDiscovery.js";
import type { RunSnapshot } from "../harness/state/runSchema.js";
import { RunStore } from "../harness/state/runStore.js";
import { summarizeExecution, toRunView } from "../harness/state/runView.js";
import { TranscriptStore } from "../harness/transcripts/store.js";

function cwdHashOf(cwd: string): string {
  return Buffer.from(cwd).toString("base64url");
}
function cwdFromHash(hash: string): string {
  return Buffer.from(hash, "base64url").toString("utf8");
}

async function findOneRun(cwd: string, slug: string): Promise<RunSnapshot | null> {
  return (await listRuns()).find((run) => run.workspace.primary_cwd === cwd && run.run.task_slug === slug)
    ?? (await listRunsInCwd(cwd)).find((run) => run.run.task_slug === slug)
    ?? null;
}

const baseBranchCache = new Map<string, string>();

async function discoverBaseBranch(cwd: string): Promise<string> {
  const symref = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symref !== null && symref.startsWith("refs/remotes/origin/")) {
    return symref.slice("refs/remotes/origin/".length);
  }
  const configBranch = await runGit(["config", "--get", "init.defaultBranch"], cwd);
  if (configBranch !== null && configBranch.length > 0) return configBranch;
  return "main";
}

async function getBaseBranch(cwd: string): Promise<string> {
  const cached = baseBranchCache.get(cwd);
  if (cached !== undefined) return cached;
  const branch = await discoverBaseBranch(cwd);
  baseBranchCache.set(cwd, branch);
  return branch;
}

function gitLogRaw(
  cwd: string,
  rangeArg: string,
): Promise<{ commits: { sha: string; date: string; subject: string }[] } | { stderr: string }> {
  return new Promise((resolve) => {
    const args = ["log", rangeArg, "--pretty=format:%h%x09%aI%x09%s", "-n", "50"];
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => resolve({ stderr: err.message }));
    proc.on("close", (code) => {
      if (code !== 0) { resolve({ stderr }); return; }
      const commits = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, date, ...rest] = line.split("\t");
          return { sha: sha ?? "", date: date ?? "", subject: rest.join("\t") };
        });
      resolve({ commits });
    });
  });
}

export async function gitLog(
  cwd: string,
  branch: string,
): Promise<{ commits: { sha: string; date: string; subject: string }[]; error?: string }> {
  const baseBranch = await getBaseBranch(cwd);
  const aheadResult = await gitLogRaw(cwd, `${baseBranch}..${branch}`);
  if ("commits" in aheadResult) return aheadResult;
  const fallbackResult = await gitLogRaw(cwd, branch);
  if ("commits" in fallbackResult) return fallbackResult;
  return { commits: [], error: "git log failed: " + fallbackResult.stderr };
}

function runGit(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", () => {});
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 ? stdout.trim() : null));
  });
}

export async function findSiblingBranches(cwd: string, branch: string): Promise<Array<{ branch: string; files: string[] }>> {
  let filesOutput = await runGit(["diff", "--name-only", `${branch}~1`, branch], cwd);
  if (filesOutput === null) filesOutput = await runGit(["diff-tree", "--no-commit-id", "-r", "--name-only", branch], cwd);
  const modifiedFiles = (filesOutput ?? "").split("\n").map((file) => file.trim()).filter(Boolean);
  if (!modifiedFiles.length) return [];
  const branchesOutput = await runGit(["branch", "--no-merged", branch], cwd);
  const siblingNames = (branchesOutput ?? "").split("\n").map((value) => value.replace(/^\*?\s+/, "").trim()).filter((value) => /^(harny|harness)\//.test(value));
  const modifiedFilesSet = new Set(modifiedFiles); const siblings: Array<{ branch: string; files: string[] }> = [];
  for (const sibling of siblingNames) { const output = await runGit(["log", sibling, "--not", branch, "--name-only", "--format=", "--", ...modifiedFiles], cwd); if (!output) continue; const files = [...new Set(output.split("\n").map((file) => file.trim()).filter((file) => file.length > 0 && modifiedFilesSet.has(file)))]; if (files.length) siblings.push({ branch: sibling, files }); }
  return siblings;
}

async function loadHtml(): Promise<string> {
  // Bun resolves __dirname-equivalent at runtime; read sibling index.html.
  const here = new URL("./index.html", import.meta.url);
  return await readFile(here, "utf8");
}


function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function findTranscriptAttempt(snapshot: RunSnapshot, instanceId: string, attemptNumber: number) {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) return undefined;
  const nested = instanceId.match(/^([a-z][a-z0-9_-]*):(\d+):([a-z][a-z0-9_-]*)$/);
  const instance = nested
    ? snapshot.execution.nodes[nested[1]!]?.steps?.[`${nested[2]}.${nested[3]}`]
    : /^[a-z][a-z0-9_-]*$/.test(instanceId) ? snapshot.execution.nodes[instanceId] : undefined;
  return instance?.attemptHistory?.find((attempt) => attempt.number === attemptNumber);
}

export type ViewerOptions = {
  port?: number;
  host?: string;
};

export async function startViewer(opts: ViewerOptions = {}): Promise<{
  url: string;
  stop: () => void;
}> {
  const port = opts.port ?? (Number(process.env.HARNY_UI_PORT) || 4123);
  const host = opts.host ?? "127.0.0.1";
  const html = await loadHtml();
  const pkgPath = new URL("../../package.json", import.meta.url);
  const version = JSON.parse(await readFile(pkgPath, "utf8")).version as string;

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/" || path === "/index.html") {
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // The mascot ships as a file, not a data URI: inlining it cost ~68KB of base64
      // in a 92KB page. `files` in package.json already publishes all of src/.
      if (path === "/collie.png") {
        return new Response(Bun.file(new URL("./collie.png", import.meta.url)), {
          headers: { "cache-control": "public, max-age=86400" },
        });
      }

      if (path === "/api/meta") {
        return jsonRes({ version });
      }

      if (path === "/api/runs") {
        const runs = await listRuns();
        const summarized = runs.map((r) => ({
          run_id: r.run.id,
          short_id: r.run.id.slice(0, 8),
          cwd: r.workspace.primary_cwd,
          cwd_hash: cwdHashOf(r.workspace.primary_cwd),
          task_slug: r.run.task_slug,
          workflow: r.run.workflow,
          status: r.execution.status === "paused" ? "waiting_human" : r.execution.status,
          started_at: r.run.started_at,
          ended_at: r.run.ended_at,
          phases_total: Object.keys(r.execution.nodes).length,
          // Both were constants. current_phase: null made the list's pipeline fall
          // back to Planner for every running run, whatever it was actually doing.
          ...summarizeExecution(r),
        }));
        return jsonRes({ runs: summarized });
      }

      const detailMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)$/);
      if (detailMatch) {
        const cwd = cwdFromHash(detailMatch[1]!);
        const slug = detailMatch[2]!;
        const snapshot = await findOneRun(cwd, slug);
        if (!snapshot) return jsonRes({ error: "not found" }, 404);
        const store = new RunStore(cwd, slug);
        const run = toRunView(snapshot, await store.events());
        const transcripts = new TranscriptStore(cwd, slug);
        await Promise.all(run.phases.flatMap((phase) => phase.attempts_detail.map(async (attempt) => {
          attempt.transcript_available = await transcripts.exists({ instanceId: phase.instance_id, attempt: attempt.number });
        })));
        const plan = run.plan;

        return jsonRes({ state: run, plan, state_path: store.runPath });
      }

      const transcriptMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)\/transcripts$/);
      if (transcriptMatch) {
        const cwd = cwdFromHash(transcriptMatch[1]!);
        const slug = transcriptMatch[2]!;
        const snapshot = await findOneRun(cwd, slug);
        if (!snapshot) return jsonRes({ error: "not found" }, 404);
        const instanceId = url.searchParams.get("instance") ?? "";
        const attemptNumber = Number(url.searchParams.get("attempt"));
        const attempt = findTranscriptAttempt(snapshot, instanceId, attemptNumber);
        if (!attempt) return jsonRes({ error: "unknown transcript attempt" }, 404);
        const after = Number(url.searchParams.get("after") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 200);
        if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1) return jsonRes({ error: "invalid transcript cursor" }, 400);
        try {
          const page = await new TranscriptStore(cwd, slug).read({ instanceId, attempt: attemptNumber }, { after, limit });
          return jsonRes({ events: page.events, next_after: page.nextAfter, complete: attempt.status !== "running" });
        } catch (error) { return jsonRes({ error: String(error) }, 500); }
      }

      const siblingMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)\/sibling-branches$/);
      if (siblingMatch) {
        const cwd = cwdFromHash(siblingMatch[1]!);
        const slug = siblingMatch[2]!;
        const historical = await findOneRun(cwd, slug);
        if (!historical) return jsonRes({ error: "not found" }, 404);
        const branch = historical.workspace.branch;
        if (!branch) return jsonRes({ siblingBranches: [] });

        return jsonRes({ siblingBranches: await findSiblingBranches(cwd, branch) });
      }

      const logMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)\/git-log$/);
      if (logMatch) {
        const cwd = cwdFromHash(logMatch[1]!);
        const slug = logMatch[2]!;
        const run = await findOneRun(cwd, slug);
        if (!run) return jsonRes({ error: "not found" }, 404);
        const branch = run.workspace.branch;
        if (!branch) return jsonRes({ commits: [] });
        const log = await gitLog(cwd, branch);
        return jsonRes(log);
      }

      if (path === "/api/health") {
        return jsonRes({ ok: true });
      }

      if (path === "/api/config") {
        return jsonRes({});
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: `http://${host}:${server.port}`,
    stop: () => server.stop(),
  };
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
