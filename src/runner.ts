import type { IsolationMode, LogMode, RunMode } from "./harness/types.js";
import { loadSearchCwds } from "./runner/context.js";
import type { RunnerContext } from "./runner/context.js";
import { handleLs } from "./runner/ls.js";
import { handleShow } from "./runner/show.js";
import { handleAnswer } from "./runner/answer.js";
import { handleUi } from "./runner/ui.js";
import { handleClean } from "./runner/clean.js";
import { handleRun } from "./runner/run.js";

type FlagSpec = { kind: "value" | "bool"; target: string; short?: string };
type SubcommandSpec = { positional?: string[]; flags: string[] };

export type RegistryCmd =
  | { kind: "ls"; status?: string; cwd?: string; workflow?: string }
  | { kind: "show"; runId: string; tail?: boolean; since?: string }
  | { kind: "answer"; runId: string }
  | { kind: "ui"; port?: number; noOpen?: boolean }
  | { kind: "clean"; slug: string; force?: boolean; kill?: boolean };

const FLAGS: Record<string, FlagSpec> = {
  "--verbose":  { kind: "bool",  target: "verbose", short: "-v" },
  "--quiet":    { kind: "bool",  target: "quiet" },
  "--workflow": { kind: "value", target: "workflow" },
  "--assistant":{ kind: "value", target: "assistant" },
  "--task":     { kind: "value", target: "task" },
  "--isolation":{ kind: "value", target: "isolation" },
  "--mode":     { kind: "value", target: "mode" },
};

const SUBCOMMANDS: Record<string, SubcommandSpec> = {
  ls:     { flags: ["--status", "--cwd", "--workflow"] },
  show:   { positional: ["runId"], flags: ["--tail", "--since"] },
  answer: { positional: ["runId"], flags: ["--json"] },
  ui:     { flags: ["--no-open", "--port"] },
  clean:  { positional: ["slug"], flags: ["--force", "--kill"] },
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
  task: string | null;
  isolation: IsolationMode | null;
  mode: RunMode | null;
  prompt: string;
};

export function parseArgs(argv: string[]): ParsedArgs {
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
        if (pos[0]) registryCmd = { kind: "answer", runId: pos[0] };
        break;
      case "ui":
        registryCmd = { kind: "ui", ...(sf["--port"] ? { port: Number(sf["--port"]) } : {}), ...(sf["--no-open"] ? { noOpen: true } : {}) };
        break;
      case "clean":
        if (pos[0]) registryCmd = { kind: "clean", slug: pos[0], ...(sf["--force"] ? { force: true } : {}), ...(sf["--kill"] ? { kill: true } : {}) };
        break;
    }
  }
  return {
    logMode: fv["quiet"] ? "quiet" : fv["verbose"] ? "verbose" : "compact",
    assistant: (fv["assistant"] as string) ?? null,
    workflow: (fv["workflow"] as string) ?? null,
    registryCmd, task: (fv["task"] as string) ?? null, isolation, mode,
    prompt: rest.join(" ").trim(),
  };
}

export async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { logMode, registryCmd } = parsed;
  if (!registryCmd && !parsed.prompt) {
    console.log(
      [
        "Usage: harny [--workflow <id>] [--task <slug>] [--assistant <name>] \"<prompt>\"",
        "       harny ls | show <runId> | clean <slug> | ui",
        "",
        "Default workflow: feature-dev. cwd defaults to process.cwd() when --assistant is omitted.",
      ].join("\n"),
    );
    return;
  }
  const searchCwds = await loadSearchCwds();
  const ctx: RunnerContext = { logMode, assistantName: parsed.assistant, searchCwds };
  if (registryCmd) {
    const handlers = { ls: handleLs, show: handleShow, answer: handleAnswer, ui: handleUi, clean: handleClean };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handlers[registryCmd.kind] as any)(registryCmd as any, ctx);
    return;
  }
  await handleRun(parsed, ctx);
}

if (import.meta.main) main();
