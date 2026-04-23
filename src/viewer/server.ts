/**
 * Viewer server — read-only HTTP wrapper over the per-run state.json files.
 *
 * Spawned by `harny ui`. Lives only as long as the parent CLI process.
 * No writes, no auth, binds to 127.0.0.1 only.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { listAllRuns, listRunsInCwd, statePathFor } from "../harness/state/filesystem.js";
import { planFilePath } from "../harness/state/plan.js";
import type { State } from "../harness/state/schema.js";

const ASSISTANTS_FILE = join(homedir(), ".harny", "assistants.json");

type Assistant = {
  name: string;
  cwd: string;
  additionalDirectories?: string[];
};
type AssistantsFile = { assistants: Assistant[] };

async function loadAssistants(): Promise<Assistant[]> {
  if (!existsSync(ASSISTANTS_FILE)) return [];
  try {
    const raw = await readFile(ASSISTANTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as AssistantsFile;
    return parsed.assistants ?? [];
  } catch {
    return [];
  }
}

async function loadAllCwds(): Promise<string[]> {
  const set = new Set<string>();
  for (const a of await loadAssistants()) {
    if (a.cwd) set.add(a.cwd);
    for (const d of a.additionalDirectories ?? []) set.add(d);
  }
  // Always include the dir the viewer was launched from so unregistered
  // local runs are visible.
  set.add(process.cwd());
  return Array.from(set);
}

function cwdHashOf(cwd: string): string {
  return Buffer.from(cwd).toString("base64url");
}
function cwdFromHash(hash: string): string {
  return Buffer.from(hash, "base64url").toString("utf8");
}

async function findOneRun(cwd: string, slug: string): Promise<State | null> {
  const states = await listRunsInCwd(cwd);
  return states.find((s) => s.origin.task_slug === slug) ?? null;
}

function gitLog(cwd: string, branch: string): Promise<{ commits: { sha: string; date: string; subject: string }[]; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      "log",
      branch,
      "--pretty=format:%h%x09%aI%x09%s",
      "-n",
      "50",
    ];
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => resolve({ commits: [], error: err.message }));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ commits: [], error: stderr.trim() || `git exited ${code}` });
        return;
      }
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
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/projects`);
    if (!res.ok) return phoenixProjectsCache?.map ?? {};
    const json = (await res.json()) as { data?: Array<{ id: string; name: string }> };
    const map: Record<string, string> = {};
    for (const p of json.data ?? []) map[p.name] = p.id;
    phoenixProjectsCache = { at: now, map };
    return map;
  } catch {
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

      if (path === "/api/assistants") {
        return jsonRes(await loadAssistants());
      }

      if (path === "/api/runs") {
        const cwds = await loadAllCwds();
        const runs = await listAllRuns(cwds);
        const summarized = runs.map((r) => ({
          run_id: r.run_id,
          short_id: r.run_id.slice(0, 8),
          cwd: r.environment.cwd,
          cwd_hash: cwdHashOf(r.environment.cwd),
          task_slug: r.origin.task_slug,
          workflow: r.origin.workflow,
          status: r.lifecycle.status,
          current_phase: r.lifecycle.current_phase,
          started_at: r.origin.started_at,
          ended_at: r.lifecycle.ended_at,
          phases_total: r.phases.length,
          retries: r.phases.length - new Set(r.phases.map((p) => p.name)).size,
        }));
        return jsonRes({ runs: summarized });
      }

      const detailMatch = path.match(/^\/api\/runs\/([^/]+)\/([^/]+)$/);
      if (detailMatch) {
        const cwd = cwdFromHash(detailMatch[1]!);
        const slug = detailMatch[2]!;
        const run = await findOneRun(cwd, slug);
        if (!run) return jsonRes({ error: "not found" }, 404);
        let plan: unknown = null;
        const planPath = planFilePath(cwd, slug);
        if (existsSync(planPath)) {
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
        const run = await findOneRun(cwd, slug);
        if (!run) return jsonRes({ error: "not found" }, 404);
        const branch = run.environment.branch;
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
        const branch = run.environment.branch;
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
