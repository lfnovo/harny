import type { State } from "../harness/state/schema.js";

export function parseGitHubCompareUrl(
  originUrl: string | null | undefined,
  branch: string,
): string | null {
  if (!originUrl || !originUrl.includes("github.com")) return null;

  let ownerRepo: string | null = null;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = originUrl.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    ownerRepo = sshMatch[1] ?? null;
  } else {
    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = originUrl.match(/https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      ownerRepo = httpsMatch[1] ?? null;
    }
  }

  if (!ownerRepo) return null;
  return `https://github.com/${ownerRepo}/compare/${branch}`;
}

function humanDuration(startIso: string, endIso: string | null | undefined): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

async function resolveOriginUrl(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "-C", cwd, "remote", "get-url", "origin"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    const text = await new Response(proc.stdout).text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

const SEP = "─".repeat(60);

export async function printRunSummary(
  result: { status: string; branch: string; state: State | null },
  cwd: string,
): Promise<void> {
  const { status, branch, state } = result;

  if (!state) {
    console.log(SEP);
    console.log(`status: ${status}`);
    console.log(`branch: ${branch}`);
    console.log(SEP);
    return;
  }

  const originUrl = await resolveOriginUrl(cwd);
  const compareUrl = parseGitHubCompareUrl(originUrl, branch);
  const duration = humanDuration(state.origin.started_at, state.lifecycle.ended_at);

  console.log(SEP);
  console.log(`status:    ${status}`);
  console.log(`workflow:  ${state.origin.workflow}`);
  console.log(`slug:      ${state.origin.task_slug}`);
  console.log(`branch:    ${branch}`);
  console.log(`duration:  ${duration}`);

  if (state.phases.length > 0) {
    console.log("");
    console.log("phases:");
    for (const phase of state.phases) {
      const mark = phase.status === "completed" ? "done" : phase.status;
      console.log(`  ${phase.name} (attempt ${phase.attempt}): ${mark}`);
    }
  }

  if (status === "done") {
    console.log("");
    console.log(`review:    harny show ${state.origin.task_slug}`);
    console.log(`checkout:  git checkout ${branch}`);
    if (compareUrl) {
      console.log(`compare:   ${compareUrl}`);
    }
  } else {
    if (state.lifecycle.ended_reason) {
      console.log("");
      console.log(`reason:    ${state.lifecycle.ended_reason}`);
    }
    console.log("");
    console.log(`diagnose:  harny show ${state.origin.task_slug}`);
  }

  console.log(SEP);
}
