import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LogMode } from "../harness/types.js";

// Non-blocking "update available" notice, modelled on gh/gcloud: check the
// npm registry for the latest published version at most once per interval,
// cache the result under ~/.harny/, and print a discreet notice at the end
// of a command when the installed version is behind. Any failure (offline,
// slow registry, unreadable cache) degrades silently to no notice.

const HARNY_DIR = join(homedir(), ".harny");
const CACHE_FILE = join(HARNY_DIR, "update-check.json");
const REGISTRY_URL = "https://registry.npmjs.org/@lfnovo/harny/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 2000;

type CheckCache = { lastCheck: number; latest: string };

export type UpdateInfo = { current: string; latest: string } | null;

// Returns true when `b` is a strictly newer release than `a`. Compares the
// numeric major.minor.patch triple only; a prerelease suffix on either side
// is ignored (harny ships plain versions), so `0.4.0` is never "newer" than
// `0.4.0-rc.1` and vice versa — the release core wins.
export function isNewer(a: string, b: string): boolean {
  const core = (v: string) => v.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

// Skip the check entirely when it would be noise or risk: opt-out env var,
// quiet mode, non-TTY stdout (piped/redirected output), or CI. gh and gcloud
// gate their notices the same way.
export function shouldCheck(logMode: LogMode): boolean {
  if (process.env.HARNY_NO_UPDATE_CHECK) return false;
  if (process.env.CI) return false;
  if (logMode === "quiet") return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

function readCache(): CheckCache | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CheckCache;
    if (typeof parsed.lastCheck === "number" && typeof parsed.latest === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCache(cache: CheckCache): void {
  try {
    mkdirSync(HARNY_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // best-effort; a missing cache just means we re-check next time
  }
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

// Kick off the check without blocking. Resolves to update info when a newer
// version exists, otherwise null. The returned promise never rejects, so the
// caller can await it in a `finally` without guarding.
export function startUpdateCheck(current: string, logMode: LogMode): Promise<UpdateInfo> {
  if (!shouldCheck(logMode)) return Promise.resolve(null);
  return (async () => {
    const cache = readCache();
    let latest = cache?.latest ?? null;
    const stale = !cache || Date.now() - cache.lastCheck > CHECK_INTERVAL_MS;
    if (stale) {
      const fetched = await fetchLatest();
      if (fetched) {
        latest = fetched;
        writeCache({ lastCheck: Date.now(), latest });
      }
    }
    return latest && isNewer(current, latest) ? { current, latest } : null;
  })();
}

export function printUpdateNotice(info: UpdateInfo): void {
  if (!info) return;
  // stderr, so it never corrupts piped stdout even if a caller ignores the
  // isTTY gate.
  console.error(
    `\nUpdate available: harny ${info.current} -> ${info.latest}\n` +
      `  bun add -g @lfnovo/harny@latest   (or: npm i -g @lfnovo/harny@latest)\n`,
  );
}
