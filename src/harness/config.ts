import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_HARNESS_CONFIG } from "./defaults.js";
import type {
  HarnessConfigFile,
  PhaseConfig,
  ResolvedHarnessConfig,
  ResolvedPhaseConfig,
} from "./types.js";

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
): Promise<ResolvedHarnessConfig> {
  const path = join(cwd, "harness.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_HARNESS_CONFIG;
    }
    throw err;
  }

  let parsed: HarnessConfigFile;
  try {
    parsed = JSON.parse(raw) as HarnessConfigFile;
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }

  return {
    planner: mergePhase(DEFAULT_HARNESS_CONFIG.planner, parsed.planner),
    developer: mergePhase(DEFAULT_HARNESS_CONFIG.developer, parsed.developer),
    validator: mergePhase(DEFAULT_HARNESS_CONFIG.validator, parsed.validator),
    maxIterationsPerTask:
      parsed.maxIterationsPerTask ??
      DEFAULT_HARNESS_CONFIG.maxIterationsPerTask,
    maxIterationsGlobal:
      parsed.maxIterationsGlobal ?? DEFAULT_HARNESS_CONFIG.maxIterationsGlobal,
    maxRetriesBeforeReset:
      parsed.maxRetriesBeforeReset ??
      DEFAULT_HARNESS_CONFIG.maxRetriesBeforeReset,
  };
}
