import type { IsolationMode, LogMode, RunMode } from "./harness/types.js";
import type { RunnerContext } from "./runner/context.js";
import { configureEnv } from "./runner/env.js";
import { handleScan } from "./runner/scan.js";
import { handleLs } from "./runner/ls.js";
import { handleShow } from "./runner/show.js";
import { handleAnswer } from "./runner/answer.js";
import { handleUi } from "./runner/ui.js";
import { handleClean } from "./runner/clean.js";
import { handleRun } from "./runner/run.js";
import { handlePrFix } from "./runner/prFix.js";
import { startUpdateCheck, printUpdateNotice } from "./runner/updateCheck.js";
import pkg from "../package.json" with { type: "json" };

export function printVersion(): void {
  console.log(`harny ${pkg.version}`);
}

export function printHelp(): void {
  console.log(
    [
      "Usage: harny [flags] \"<prompt>\"",
      "       harny <subcommand> [subcommand-flags]",
      "",
      "Global flags:",
      "  --verbose, -v        Verbose log output",
      "  --quiet              Suppress all non-error output",
      "  --workflow <id>      Workflow to run (default: feature-dev)",
      "  --assistant <name>   Named-cwd shortcut from ~/.harny/assistants.json (optional)",
      "  --name <slug>        Name for this run (becomes .harny/<slug>/ and harny/<slug> branch)",
      "  --isolation <mode>   worktree (default) or inline",
      "  --mode <mode>        interactive, silent, or async",
      "  --version, -V        Print version and exit",
      "  --help, -h           Print this help and exit",
      "",
      "Subcommands:",
      "  ls [--status <s>] [--cwd <path>] [--workflow <id>]   List runs",
      "  show <runId> [--tail] [--since <duration>]            Show run detail",
      "  answer <runId> [text] [--json <value>]                Answer and resume a parked run",
      "  pr fix <number>                                        Fix feedback on an existing PR",
      "  ui [--port <n>] [--no-open]                          Launch the viewer UI",
      "  clean <slug> [--force] [--kill]                      Clean up a run",
      "  clean --prune                                         Prune unreachable pointers from ~/.harny/runs/",
      "  scan [<cwd>]                                          Reindex ~/.harny/runs/ from a project's .harny/<slug>/",
      "",
      "When no subcommand is given, the prompt is dispatched as a new harny run.",
      "Default workflow: feature-dev. cwd defaults to process.cwd() when --assistant is omitted.",
    ].join("\n"),
  );
}

type FlagSpec = { kind: "value" | "bool"; target: string; short?: string };
type SubcommandSpec = { positional?: string[]; flags: string[] };

export type RegistryCmd =
  | { kind: "ls"; status?: string; cwd?: string; workflow?: string }
  | { kind: "show"; runId: string; tail?: boolean; since?: string }
  | { kind: "answer"; runId: string; text?: string; json?: string }
  | { kind: "ui"; port?: number; noOpen?: boolean }
  | { kind: "clean"; slug: string | null; force?: boolean; kill?: boolean; prune?: boolean }
  | { kind: "scan"; cwd?: string }
  | { kind: "pr-fix"; number: number };

const FLAGS: Record<string, FlagSpec> = {
  "--verbose":  { kind: "bool",  target: "verbose", short: "-v" },
  "--quiet":    { kind: "bool",  target: "quiet" },
  "--workflow": { kind: "value", target: "workflow" },
  "--assistant":{ kind: "value", target: "assistant" },
  "--name":     { kind: "value", target: "name" },
  "--isolation":{ kind: "value", target: "isolation" },
  "--mode":     { kind: "value", target: "mode" },
};

const SUBCOMMANDS: Record<string, SubcommandSpec> = {
  ls:     { flags: ["--status", "--cwd", "--workflow"] },
  show:   { positional: ["runId"], flags: ["--tail", "--since"] },
  answer: { positional: ["runId"], flags: ["--json"] },
  ui:     { flags: ["--no-open", "--port"] },
  clean:  { positional: ["slug"], flags: ["--force", "--kill", "--prune"] },
  scan:   { positional: ["cwd"], flags: [] },
  pr:     { positional: ["action", "number"], flags: [] },
};

function parseIsolation(v: string): IsolationMode {
  if (v === "worktree" || v === "inline") return v;
  throw new Error(`--isolation must be one of: worktree, inline (got "${v}")`);
}

function parseMode(v: string): RunMode {
  if (v === "interactive" || v === "silent" || v === "async") return v;
  throw new Error(`--mode must be one of: interactive, silent, async (got "${v}")`);
}

export type ParsedArgs = {
  logMode: LogMode;
  assistant: string | null;
  workflow: string | null;
  registryCmd: RegistryCmd | null;
  name: string | null;
  isolation: IsolationMode | null;
  mode: RunMode | null;
  prompt: string;
  versionFlag: boolean;
  helpFlag: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  let versionFlag = false;
  let helpFlag = false;
  for (const a of argv) {
    if (a === "--version" || a === "-V") { versionFlag = true; break; }
    if (a === "--help" || a === "-h") { helpFlag = true; break; }
  }
  const lookup = new Map<string, FlagSpec>();
  for (const [flag, spec] of Object.entries(FLAGS)) {
    lookup.set(flag, spec);
    if (spec.short) lookup.set(spec.short, spec);
  }
  const fv: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const spec = lookup.get(a);
    if (spec) {
      if (spec.kind === "bool") { fv[spec.target] = true; }
      else { const next = argv[i + 1]; if (!next) throw new Error(`${a} requires a value`); fv[spec.target] = next; i++; }
    } else if (a.includes("=")) {
      const idx = a.indexOf("=");
      const eqSpec = lookup.get(a.slice(0, idx));
      if (eqSpec?.kind === "value") fv[eqSpec.target] = a.slice(idx + 1); else rest.push(a);
    } else rest.push(a);
  }
  const isolation = fv["isolation"] ? parseIsolation(fv["isolation"] as string) : null;
  const mode = fv["mode"] ? parseMode(fv["mode"] as string) : null;
  const sub = rest[0];
  let registryCmd: RegistryCmd | null = null;
  if (sub && sub in SUBCOMMANDS) {
    const spec = SUBCOMMANDS[sub]!;
    const pos: string[] = [];
    const sf: Record<string, string | boolean> = {};
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i]!;
      if (a.includes("=")) {
        const idx = a.indexOf("="); const flag = a.slice(0, idx);
        if (spec.flags.includes(flag)) sf[flag] = a.slice(idx + 1);
      } else if (spec.flags.includes(a)) {
        const next = rest[i + 1];
        if (next && !next.startsWith("-")) { sf[a] = next; i++; } else sf[a] = true;
      } else if (!a.startsWith("-")) pos.push(a);
    }
    switch (sub) {
      case "ls":
        registryCmd = { kind: "ls", status: sf["--status"] as string | undefined, cwd: sf["--cwd"] as string | undefined, workflow: sf["--workflow"] as string | undefined };
        break;
      case "show":
        if (pos[0]) registryCmd = { kind: "show", runId: pos[0], ...(sf["--tail"] ? { tail: true } : {}), ...(sf["--since"] ? { since: sf["--since"] as string } : {}) };
        break;
      case "answer":
        if (pos[0]) registryCmd = { kind: "answer", runId: pos[0], ...(pos[1] ? { text: pos.slice(1).join(" ") } : {}), ...(typeof sf["--json"] === "string" ? { json: sf["--json"] as string } : {}) };
        break;
      case "ui":
        registryCmd = { kind: "ui", ...(sf["--port"] ? { port: Number(sf["--port"]) } : {}), ...(sf["--no-open"] ? { noOpen: true } : {}) };
        break;
      case "clean":
        if (sf["--prune"]) {
          registryCmd = { kind: "clean", slug: null, prune: true };
        } else if (pos[0]) {
          registryCmd = { kind: "clean", slug: pos[0], ...(sf["--force"] ? { force: true } : {}), ...(sf["--kill"] ? { kill: true } : {}) };
        }
        break;
      case "scan":
        registryCmd = { kind: "scan", ...(pos[0] ? { cwd: pos[0] } : {}) };
        break;
      case "pr":
        if (pos[0] === "fix" && pos[1] && Number.isInteger(Number(pos[1])) && Number(pos[1]) > 0) registryCmd = { kind: "pr-fix", number: Number(pos[1]) };
        break;
    }
  }
  return {
    logMode: fv["quiet"] ? "quiet" : fv["verbose"] ? "verbose" : "compact",
    assistant: (fv["assistant"] as string) ?? null,
    workflow: (fv["workflow"] as string) ?? null,
    registryCmd, name: (fv["name"] as string) ?? null, isolation, mode,
    prompt: rest.join(" ").trim(),
    versionFlag, helpFlag,
  };
}

export async function main() {
  // Scrub credentials Bun's autoloaded project .env may have leaked into
  // process.env, then overlay harny's own ~/.harny/.env and ./harny.env.
  // HARNY_INHERIT_ENV=1 opts out.
  configureEnv();
  const parsed = parseArgs(process.argv.slice(2));
  const { logMode, registryCmd } = parsed;
  if (parsed.versionFlag) { printVersion(); process.exit(0); }
  if (parsed.helpFlag) { printHelp(); process.exit(0); }
  if (!registryCmd && !parsed.prompt) {
    console.log(
      [
        "Usage: harny [--workflow <id>] [--name <slug>] [--assistant <name>] \"<prompt>\"",
        "       harny ls | show <runId> | clean <slug> | ui",
        "",
        "Default workflow: feature-dev. cwd defaults to process.cwd() when --assistant is omitted.",
      ].join("\n"),
    );
    return;
  }
  const ctx: RunnerContext = { logMode, assistantName: parsed.assistant };
  // Fire-and-forget the update check now so its network round-trip overlaps
  // the actual work; the notice is printed once the command finishes.
  const updateCheck = startUpdateCheck(pkg.version, logMode);
  try {
    if (registryCmd) {
      switch (registryCmd.kind) {
        case "ls": await handleLs(registryCmd); break;
        case "show": await handleShow(registryCmd); break;
        case "answer": await handleAnswer(registryCmd); break;
        case "ui": await handleUi(registryCmd); break;
        case "clean": await handleClean(registryCmd, ctx); break;
        case "scan": await handleScan(registryCmd); break;
        case "pr-fix": await handlePrFix(registryCmd, ctx); break;
      }
      return;
    }
    await handleRun(parsed, ctx);
  } finally {
    printUpdateNotice(await updateCheck);
  }
}

if (import.meta.main) main();
