import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { StateSchema, type State, type PhaseEntry } from "../state/schema.js";
import { formatEvent } from "./format.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function encodedCwd(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

export function transcriptPath(phaseDir: string, sessionId: string): string {
  return join(homedir(), ".claude", "projects", encodedCwd(phaseDir), sessionId + ".jsonl");
}

export function resolvePhase(state: State): PhaseEntry | null {
  if (state.lifecycle.current_phase) {
    const matching = state.phases.filter((p) => p.name === state.lifecycle.current_phase);
    if (matching.length > 0) {
      return matching.reduce((latest, p) => (p.attempt > latest.attempt ? p : latest));
    }
  }
  if (state.phases.length === 0) return null;
  return state.phases.reduce((latest, p) =>
    p.started_at > latest.started_at ? p : latest,
  );
}

export function phaseCwd(state: State): string {
  return state.environment.worktree_path ?? state.environment.cwd;
}

async function readState(stateFilePath: string): Promise<State> {
  const raw = await readFile(stateFilePath, "utf8");
  return StateSchema.parse(JSON.parse(raw));
}

async function readNewLines(
  filePath: string,
  byteOffset: number,
): Promise<{ byteOffset: number; lines: string[] }> {
  try {
    const buffer = await readFile(filePath);
    if (buffer.length <= byteOffset) return { byteOffset, lines: [] };
    const newBytes = buffer.subarray(byteOffset);
    const newContent = newBytes.toString("utf8");
    // Only process complete lines — if no trailing newline, keep last partial line for next poll
    const hasTrailingNewline = newContent.endsWith("\n");
    const parts = newContent.split("\n");
    const completeParts = hasTrailingNewline ? parts : parts.slice(0, -1);
    const lines = completeParts.filter((l) => l.trim());
    const consumed = hasTrailingNewline
      ? newBytes.length
      : newBytes.length - Buffer.byteLength(parts[parts.length - 1]!, "utf8");
    return { byteOffset: byteOffset + consumed, lines };
  } catch {
    return { byteOffset, lines: [] };
  }
}

function processLines(lines: string[]): void {
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as unknown;
      const formatted = formatEvent(event);
      if (formatted !== null) {
        console.log(formatted);
      }
    } catch {
      // skip malformed lines
    }
  }
}

export function parseSinceArg(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(\d+)(s|m|h)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === "s") return n;
    if (m[2] === "m") return n * 60;
    if (m[2] === "h") return n * 3600;
  }
  throw new Error(`--since: unrecognized duration "${s}"`);
}

export function backfillFilter(events: unknown[], sinceSeconds: number, now?: number): unknown[] {
  const cutoff = (now ?? Date.now()) - sinceSeconds * 1000;
  return events.filter((event) => {
    const e = event as Record<string, unknown>;
    if (typeof e.timestamp !== "string") return false;
    const ts = new Date(e.timestamp).getTime();
    if (isNaN(ts)) return false;
    return ts >= cutoff;
  });
}

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export async function tailRun(
  stateFilePath: string,
  sinceSeconds?: number,
  signal?: AbortSignal,
): Promise<void> {
  let interrupted = false;
  const sigintHandler = () => {
    interrupted = true;
    process.stdout.write("\n");
  };
  process.once("SIGINT", sigintHandler);

  const isInterrupted = () => interrupted || (signal?.aborted ?? false);

  try {
    let state = await readState(stateFilePath);
    let currentPhase = resolvePhase(state);

    if (!currentPhase) {
      console.log("── no active phase found ──");
      return;
    }

    let phaseKey = `${currentPhase.name}:${currentPhase.attempt}`;
    let tPath = currentPhase.session_id
      ? transcriptPath(phaseCwd(state), currentPhase.session_id)
      : null;

    console.log(`── phase: ${currentPhase.name} ──`);

    let byteOffset = 0;
    let lastStateCheck = Date.now();

    // Backfill: emit recent transcript events before starting live tail
    if (sinceSeconds && sinceSeconds > 0 && tPath) {
      try {
        const buffer = await readFile(tPath);
        byteOffset = buffer.length;
        const rawLines = buffer.toString("utf8").split("\n").filter((l) => l.trim());
        const events: unknown[] = [];
        for (const line of rawLines) {
          try {
            events.push(JSON.parse(line));
          } catch {
            // skip malformed
          }
        }
        const filtered = backfillFilter(events, sinceSeconds);
        console.log(`── backfill: last ${formatDuration(sinceSeconds)} ──`);
        for (const event of filtered) {
          const formatted = formatEvent(event);
          if (formatted !== null) console.log(formatted);
        }
        console.log("── live ──");
      } catch {
        console.log("── live ──");
      }
    }

    while (!isInterrupted()) {
      const now = Date.now();

      // Poll transcript for new content every 250ms
      if (tPath) {
        const result = await readNewLines(tPath, byteOffset);
        byteOffset = result.byteOffset;
        processLines(result.lines);
      }

      // Re-check state every 2s for phase transitions or completion
      if (now - lastStateCheck >= 2000) {
        state = await readState(stateFilePath);
        lastStateCheck = now;

        const newPhase = resolvePhase(state);
        const newKey = newPhase ? `${newPhase.name}:${newPhase.attempt}` : null;

        if (newKey !== phaseKey) {
          if (newPhase) {
            currentPhase = newPhase;
            phaseKey = newKey!;
            tPath = currentPhase.session_id
              ? transcriptPath(phaseCwd(state), currentPhase.session_id)
              : null;
            byteOffset = 0;
            console.log(`── phase: ${currentPhase.name} ──`);
          }
        } else if (!tPath && currentPhase.session_id) {
          // session_id became available after phase started
          tPath = transcriptPath(phaseCwd(state), currentPhase.session_id);
        }

        if (state.lifecycle.status !== "running") {
          // Drain any remaining transcript lines
          if (tPath) {
            const result = await readNewLines(tPath, byteOffset);
            processLines(result.lines);
          }
          console.log(`── done: ${state.lifecycle.status} ──`);
          return;
        }
      }

      await sleep(250);
    }
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}
