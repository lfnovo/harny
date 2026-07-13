/**
 * Viewer server — read-only HTTP wrapper over v3 runs and historical v2 state.
 *
 * Spawned by `harny ui`. Lives only as long as the parent CLI process.
 * No writes, no auth, binds to 127.0.0.1 only.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { listRunsInCwd, statePathFor } from "../harness/state/filesystem.js";
import { listHistoricalRuns, listV3RunsInCwd } from "../harness/state/v3/discovery.js";
import type { HistoricalRun } from "../harness/state/v3/reader.js";
import { normalizeV2Run, normalizeV3Run } from "../harness/state/v3/reader.js";
import { planFilePath } from "../harness/state/plan.js";

function cwdHashOf(cwd: string): string {
  return Buffer.from(cwd).toString("base64url");
}
function cwdFromHash(hash: string): string {
  return Buffer.from(hash, "base64url").toString("utf8");
}

async function findOneRun(cwd: string, slug: string): Promise<HistoricalRun | null> {
  const indexed = (await listHistoricalRuns()).find((run) => run.cwd === cwd && (run.schema_version === 2 ? run.raw.origin.task_slug : run.raw.run.task_slug) === slug); if (indexed) return indexed;
  const v3 = (await listV3RunsInCwd(cwd)).find((run) => run.run.task_slug === slug); if (v3) return normalizeV3Run(v3);
  const v2 = (await listRunsInCwd(cwd)).find((run) => run.origin.task_slug === slug); return v2 ? normalizeV2Run(v2) : null;
}

function viewerState(run: HistoricalRun): any {
  if (run.schema_version === 2) return run.raw;
  const value = run.raw; const plan = value.artifacts.plan?.value;
  return { schema_version: 3, run_id: value.run.id, origin: { prompt: value.origin.prompt, workflow: value.run.workflow, task_slug: value.run.task_slug, started_at: value.run.started_at, host: value.origin.host, user: value.origin.user, features: null }, environment: { cwd: value.workspace.primary_cwd, branch: value.workspace.branch, isolation: value.workspace.isolation, worktree_path: value.workspace.worktree_path, mode: "async" }, lifecycle: { status: value.run.status === "paused" ? "waiting_human" : value.run.status, current_phase: Object.values(value.nodes).find((node) => node.status === "running")?.id ?? null, ended_at: value.run.ended_at, ended_reason: value.run.ended_reason, pid: value.run.pid }, phases: Object.values(value.nodes).map((node) => ({ name: node.id, attempt: node.attempts.at(-1)?.number ?? 1, started_at: node.attempts.at(-1)?.started_at ?? value.run.started_at, ended_at: node.attempts.at(-1)?.ended_at ?? null, status: node.status === "paused" ? "parked" : node.status === "skipped" ? "completed" : node.status, verdict: null, session_id: node.attempts.at(-1)?.session?.id ?? null })), history: [], pending_question: value.pending_human ? { id: value.pending_human.node_id, kind: "user_input", prompt: value.pending_human.question, options: value.pending_human.options, asked_at: value.pending_human.asked_at, phase_session_id: value.pending_human.session?.id ?? null, tool_use_id: null, phase_name: value.pending_human.node_id } : null, workflow_state: {}, workflow_chosen: { id: value.run.workflow, variant: "default" }, phoenix: value.artifacts.phoenix?.value, plan };
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

/**
 * Look up Phoenix's name → GraphQL global ID map. Phoenix URLs require the
 * encoded ID (e.g. "UHJvamVjdDoy"), not the project name. Browser fetches
 * are blocked by Phoenix's missing CORS, so we resolve server-side and
 * cache for 30s to avoid hammering Phoenix per detail page load.
 */
let phoenixProjectsCache: { at: number; map: Record<string, string> } | null = null;
const PHOENIX_CACHE_TTL_MS = 30_000;

async function phoenixProjectMap(baseUrl: string): Promise<Record<string, string>> {
  const now = Date.now();
  if (phoenixProjectsCache && now - phoenixProjectsCache.at < PHOENIX_CACHE_TTL_MS) {
    return phoenixProjectsCache.map;
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/projects`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[harny viewer] phoenix projects fetch failed:", res.status, url);
      if (phoenixProjectsCache) {
        console.warn(`[harny viewer] serving stale phoenix project map (age=${now - phoenixProjectsCache.at}ms)`);
      } else {
        console.warn("[harny viewer] check HARNY_PHOENIX_URL and phoenix container");
      }
      return phoenixProjectsCache?.map ?? {};
    }
    const json = (await res.json()) as { data?: Array<{ id: string; name: string }> };
    const map: Record<string, string> = {};
    for (const p of json.data ?? []) map[p.name] = p.id;
    phoenixProjectsCache = { at: now, map };
    return map;
  } catch (err) {
    console.warn("[harny viewer] phoenix projects fetch error", err);
    if (phoenixProjectsCache) {
      console.warn(`[harny viewer] serving stale phoenix project map (age=${now - phoenixProjectsCache.at}ms)`);
    } else {
      console.warn("[harny viewer] check HARNY_PHOENIX_URL and phoenix container");
    }
    return phoenixProjectsCache?.map ?? {};
  }
}

function buildPhoenixUrl(
  baseUrl: string,
  projectMap: Record<string, string>,
  projectName: string,
  traceId: string,
): string | null {
  const id = projectMap[projectName];
  if (!id) return null;
  return `${baseUrl.replace(/\/+$/, "")}/projects/${id}/traces/${traceId}`;
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

      if (path === "/api/meta") {
        return jsonRes({ version });
      }

      if (path === "/api/runs") {
        const runs = await listHistoricalRuns();
        const summarized = runs.map((r) => ({
          run_id: r.id,
          short_id: r.id.slice(0, 8),
          cwd: r.cwd,
          cwd_hash: cwdHashOf(r.cwd),
          task_slug: r.schema_version === 2 ? r.raw.origin.task_slug : r.raw.run.task_slug,
          workflow: r.workflow,
          status: r.status === "paused" ? "waiting_human" : r.status,
          current_phase: null,
          started_at: r.started_at,
          ended_at: r.ended_at,
          phases_total: r.schema_version === 2 ? r.raw.phases.length : Object.keys(r.raw.nodes).length,
          retries: 0,
        }));
        return jsonRes({ runs: summarized });
      }

      const detailMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)$/);
      if (detailMatch) {
        const cwd = cwdFromHash(detailMatch[1]!);
        const slug = detailMatch[2]!;
        const historical = await findOneRun(cwd, slug);
        if (!historical) return jsonRes({ error: "not found" }, 404);
        const run = viewerState(historical);
        let plan: unknown = null;
        const planPath = planFilePath(cwd, slug);
        if (historical.schema_version === 3) plan = historical.raw.artifacts.plan?.value ?? null;
        else if (existsSync(planPath)) {
          try {
            plan = JSON.parse(await readFile(planPath, "utf8"));
          } catch {
            plan = null;
          }
        }

        // Pre-bake the Phoenix deep-link server-side (Phoenix doesn't expose
        // CORS so the browser can't do the name → ID lookup itself). One link
        // per run — all phases inherit the run's trace_id and live as child
        // spans inside it.
        const phoenixBase = process.env.HARNY_PHOENIX_URL;
        let phoenixUrl: string | undefined;
        if (phoenixBase && run.phoenix) {
          const projectMap = await phoenixProjectMap(phoenixBase);
          const url = buildPhoenixUrl(
            phoenixBase,
            projectMap,
            run.phoenix.project,
            run.phoenix.trace_id,
          );
          if (url) phoenixUrl = url;
        }
        const enrichedRun = phoenixUrl
          ? { ...run, phoenix: { ...run.phoenix!, url: phoenixUrl } }
          : run;

        return jsonRes({ state: enrichedRun, plan, state_path: statePathFor(cwd, slug) });
      }

      const siblingMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)\/sibling-branches$/);
      if (siblingMatch) {
        const cwd = cwdFromHash(siblingMatch[1]!);
        const slug = siblingMatch[2]!;
        const historical = await findOneRun(cwd, slug);
        if (!historical) return jsonRes({ error: "not found" }, 404);
        const branch = historical.branch;
        if (!branch) return jsonRes({ siblingBranches: [] });

        // Get files modified by the run's latest commit.
        let filesOutput = await runGit(["diff", "--name-only", `${branch}~1`, branch], cwd);
        if (filesOutput === null) {
          // Fallback: branch may be the very first commit with no parent.
          filesOutput = await runGit(["diff-tree", "--no-commit-id", "-r", "--name-only", branch], cwd);
        }
        const modifiedFiles = (filesOutput ?? "").split("\n").map((f) => f.trim()).filter(Boolean);
        if (modifiedFiles.length === 0) return jsonRes({ siblingBranches: [] });

        // Unmerged local branches filtered to harny/harness managed only.
        const branchesOutput = await runGit(["branch", "--no-merged", branch], cwd);
        const siblingNames = (branchesOutput ?? "")
          .split("\n")
          .map((b) => b.replace(/^\*?\s+/, "").trim())
          .filter(Boolean)
          .filter((b) => /^(harny|harness)\//.test(b));

        // One git log per sibling returns all touched files at once (O(S) not O(S×F)).
        const modifiedFilesSet = new Set(modifiedFiles);
        const siblingBranches: Array<{ branch: string; files: string[] }> = [];
        for (const sibling of siblingNames) {
          const output = await runGit(
            ["log", sibling, "--not", branch, "--name-only", "--format=", "--", ...modifiedFiles],
            cwd,
          );
          if (output) {
            const files = [
              ...new Set(
                output
                  .split("\n")
                  .map((f) => f.trim())
                  .filter((f) => f.length > 0 && modifiedFilesSet.has(f)),
              ),
            ];
            if (files.length > 0) siblingBranches.push({ branch: sibling, files });
          }
        }

        return jsonRes({ siblingBranches });
      }

      const logMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)\/git-log$/);
      if (logMatch) {
        const cwd = cwdFromHash(logMatch[1]!);
        const slug = logMatch[2]!;
        const run = await findOneRun(cwd, slug);
        if (!run) return jsonRes({ error: "not found" }, 404);
        const branch = run.branch;
        if (!branch) return jsonRes({ commits: [] });
        const log = await gitLog(cwd, branch);
        return jsonRes(log);
      }

      if (path === "/api/health") {
        return jsonRes({ ok: true });
      }

      if (path === "/api/config") {
        // Surface env-derived config the SPA needs (Phoenix base URL for
        // deep-links). null when not configured — the SPA hides the link.
        return jsonRes({
          phoenix_url: process.env.HARNY_PHOENIX_URL ?? null,
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: `http://${host}:${port}`,
    stop: () => server.stop(),
  };
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
