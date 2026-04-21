import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERIC_HARNESS_DEFAULTS } from "./defaults.js";
import type {
  HarnessConfigFile,
  PhaseConfig,
  ResolvedHarnessConfig,
  ResolvedPhaseConfig,
} from "./types.js";
import type { Workflow } from "./workflow.js";

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

export async function loadHarnessConfig(
  cwd: string,
  workflow: Workflow,
): Promise<ResolvedHarnessConfig> {
  const path = join(cwd, "harness.json");
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
  for (const [name, defaultConfig] of Object.entries(workflow.phaseDefaults)) {
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
      parsed.maxIterationsPerTask ?? GENERIC_HARNESS_DEFAULTS.maxIterationsPerTask,
    maxIterationsGlobal:
      parsed.maxIterationsGlobal ?? GENERIC_HARNESS_DEFAULTS.maxIterationsGlobal,
    maxRetriesBeforeReset:
      parsed.maxRetriesBeforeReset ??
      GENERIC_HARNESS_DEFAULTS.maxRetriesBeforeReset,
    isolation: parsed.isolation ?? GENERIC_HARNESS_DEFAULTS.isolation,
  };
}
