import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HarnessConfigFile,
  IsolationMode,
  PhaseConfig,
  ResolvedHarnessConfig,
  ResolvedPhaseConfig,
  RunMode,
} from "./types.js";

interface WorkflowConfigLike {
  phaseDefaults?: Record<string, ResolvedPhaseConfig>;
  defaultMode?: RunMode;
}

/**
 * Generic harness-level defaults (apply regardless of workflow).
 * Per-phase configs come from each workflow's `phaseDefaults` declaration.
 */
const GENERIC_DEFAULTS: {
  isolation: IsolationMode;
  maxIterationsPerTask: number;
  maxIterationsGlobal: number;
  maxRetriesBeforeReset: number;
} = {
  isolation: "worktree",
  maxIterationsPerTask: 3,
  maxIterationsGlobal: 30,
  maxRetriesBeforeReset: 1,
};

function mergePhase(
  base: ResolvedPhaseConfig,
  override: PhaseConfig | undefined,
): ResolvedPhaseConfig {
  if (!override) return base;
  return {
    prompt: override.prompt ?? base.prompt,
    // Arrays are REPLACED, not merged — documented semantics.
    allowedTools: override.allowedTools ?? base.allowedTools,
    permissionMode: override.permissionMode ?? base.permissionMode,
    maxTurns: override.maxTurns ?? base.maxTurns,
    effort: override.effort ?? base.effort,
    model: override.model ?? base.model,
    // mcpServers: deep merge at key level — override replaces matching keys.
    mcpServers: { ...base.mcpServers, ...(override.mcpServers ?? {}) },
  };
}

/**
 * Resolves the run mode using the precedence chain:
 *   1. cliMode (--mode flag)
 *   2. harny.json defaultMode
 *   3. workflow.defaultMode
 *   4. auto: process.stdin.isTTY ? "interactive" : "silent"
 */
export function resolveRunMode(
  cliMode: RunMode | undefined,
  fileDefault: RunMode | undefined,
  workflowDefault: RunMode | undefined,
): RunMode {
  if (cliMode) return cliMode;
  if (fileDefault) return fileDefault;
  if (workflowDefault) return workflowDefault;
  return process.stdin.isTTY ? "interactive" : "silent";
}

export async function loadHarnessConfig(
  cwd: string,
  workflow: WorkflowConfigLike,
  cliMode?: RunMode,
): Promise<ResolvedHarnessConfig> {
  const path = join(cwd, "harny.json");
  let parsed: HarnessConfigFile = {};
  try {
    const raw = await readFile(path, "utf8");
    try {
      parsed = JSON.parse(raw) as HarnessConfigFile;
    } catch (err) {
      throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Merge per-phase: start from workflow's phaseDefaults, overlay file overrides.
  const phases: Record<string, ResolvedPhaseConfig> = {};
  for (const [name, defaultConfig] of Object.entries(workflow.phaseDefaults ?? {})) {
    phases[name] = mergePhase(defaultConfig, parsed.phases?.[name]);
  }
  // Allow file overrides for phases the workflow didn't declare (rare, but
  // keeps the config file open for future custom phases).
  if (parsed.phases) {
    for (const [name, override] of Object.entries(parsed.phases)) {
      if (!(name in phases)) {
        // Without a default to merge into, we cannot construct a valid
        // ResolvedPhaseConfig — skip and let the workflow fail at runPhase.
        void override;
      }
    }
  }

  return {
    phases,
    maxIterationsPerTask:
      parsed.maxIterationsPerTask ?? GENERIC_DEFAULTS.maxIterationsPerTask,
    maxIterationsGlobal:
      parsed.maxIterationsGlobal ?? GENERIC_DEFAULTS.maxIterationsGlobal,
    maxRetriesBeforeReset:
      parsed.maxRetriesBeforeReset ??
      GENERIC_DEFAULTS.maxRetriesBeforeReset,
    isolation: parsed.isolation ?? GENERIC_DEFAULTS.isolation,
    mode: resolveRunMode(cliMode, parsed.defaultMode, workflow.defaultMode),
  };
}
