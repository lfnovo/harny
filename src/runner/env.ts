import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Anthropic SDK credentials that Bun's autoloaded project `.env` can
// silently leak into the harness. Scrubbed at boot when a project
// `.env` defines them, then re-populated from harny's own files.
// Set `HARNY_INHERIT_ENV=1` to opt out of all scrubbing/overlay logic.
const SCRUBBED_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
] as const;

const PROJECT_DOTENV_CANDIDATES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
];

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip trailing inline comment for unquoted values.
    if (!val.startsWith('"') && !val.startsWith("'")) {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    // Strip a single layer of surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch (err) {
    console.warn(`[harny] could not read ${path}: ${(err as Error).message}`);
    return {};
  }
}

function projectDotenvHasScrubbedKey(cwd: string): boolean {
  for (const name of PROJECT_DOTENV_CANDIDATES) {
    const parsed = loadFile(join(cwd, name));
    for (const key of SCRUBBED_KEYS) {
      if (parsed[key] !== undefined) return true;
    }
  }
  return false;
}

export type ConfigureEnvOptions = {
  cwd?: string;
  home?: string;
};

export type ConfigureEnvResult = {
  inherited: boolean;
  scrubbed: string[];
  appliedFrom: { global: boolean; project: boolean };
};

/**
 * Configure harny's credential environment.
 *
 * Precedence (high → low):
 *   1. process.env values not in SCRUBBED_KEYS (always preserved)
 *   2. process.env scrubbed keys when no project `.env` mentions them
 *      OR when `HARNY_INHERIT_ENV=1`
 *   3. `<cwd>/harny.env`
 *   4. `<home>/.harny/.env`
 *
 * The function fills only missing keys; it never overwrites a value
 * that already exists in process.env after scrubbing.
 */
export function configureEnv(opts: ConfigureEnvOptions = {}): ConfigureEnvResult {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();

  if (process.env.HARNY_INHERIT_ENV === "1") {
    return { inherited: true, scrubbed: [], appliedFrom: { global: false, project: false } };
  }

  const scrubbed: string[] = [];
  if (projectDotenvHasScrubbedKey(cwd)) {
    for (const key of SCRUBBED_KEYS) {
      if (process.env[key] !== undefined) {
        delete process.env[key];
        scrubbed.push(key);
      }
    }
  }

  const globalFile = join(home, ".harny", ".env");
  const projectFile = join(cwd, "harny.env");
  const global = loadFile(globalFile);
  const project = loadFile(projectFile);
  // Project overrides global; both apply only to missing keys.
  const merged = { ...global, ...project };
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  return {
    inherited: false,
    scrubbed,
    appliedFrom: {
      global: Object.keys(global).length > 0,
      project: Object.keys(project).length > 0,
    },
  };
}
