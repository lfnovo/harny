import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute, basename } from "node:path";
import type { LogMode } from "../harness/types.js";

export type RunnerContext = {
  logMode: LogMode;
  assistantName: string | null;
  searchCwds: string[];
};

export type Assistant = {
  name: string;
  cwd: string;
  additionalDirectories?: string[];
};

type AssistantsFile = { assistants: Assistant[] };

const ASSISTANTS_FILE = join(homedir(), ".harny", "assistants.json");

async function loadAssistant(name: string): Promise<Assistant> {
  let parsed: AssistantsFile;
  try {
    parsed = JSON.parse(await readFile(ASSISTANTS_FILE, "utf8")) as AssistantsFile;
  } catch (err) {
    throw new Error(`Could not load ${ASSISTANTS_FILE}: ${(err as Error).message}`);
  }
  const match = parsed.assistants?.find((a) => a.name === name);
  if (!match) {
    const known = (parsed.assistants ?? []).map((a) => a.name).join(", ");
    throw new Error(`Assistant "${name}" not found in assistants.json. Known: ${known || "(none)"}`);
  }
  if (!isAbsolute(match.cwd)) {
    throw new Error(`Assistant "${name}" cwd must be an absolute path (got "${match.cwd}")`);
  }
  try {
    const s = await stat(match.cwd);
    if (!s.isDirectory()) throw new Error(`cwd "${match.cwd}" is not a directory`);
  } catch (err) {
    throw new Error(`Assistant "${name}" cwd unreachable (${match.cwd}): ${(err as Error).message}`);
  }
  const extras = (match.additionalDirectories ?? []).map((p) => {
    if (!isAbsolute(p)) throw new Error(`"${p}" in additionalDirectories must be an absolute path`);
    return p;
  });
  return { name: match.name, cwd: match.cwd, additionalDirectories: extras };
}

export async function resolveAssistant(name: string | null): Promise<Assistant> {
  if (name) return loadAssistant(name);
  const cwd = process.cwd();
  return { name: basename(cwd) || "harny", cwd, additionalDirectories: [] };
}

export async function loadSearchCwds(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(ASSISTANTS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[harny] could not read ${ASSISTANTS_FILE}: ${(err as Error).message} — falling back to process.cwd() only`);
    }
    return [process.cwd()];
  }
  let parsed: AssistantsFile;
  try {
    parsed = JSON.parse(raw) as AssistantsFile;
  } catch (err) {
    console.warn(`[harny] invalid JSON in ${ASSISTANTS_FILE}: ${(err as Error).message} — falling back to process.cwd() only`);
    return [process.cwd()];
  }
  const out = new Set<string>([process.cwd()]);
  for (const a of parsed.assistants ?? []) {
    if (a.cwd && isAbsolute(a.cwd)) out.add(a.cwd);
    for (const d of a.additionalDirectories ?? []) {
      if (isAbsolute(d)) out.add(d);
    }
  }
  return Array.from(out);
}
