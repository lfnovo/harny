import type { IsolationMode } from "./types.js";

/**
 * Generic harness-level defaults that apply regardless of workflow.
 * Per-phase configs come from each workflow's `phaseDefaults` declaration.
 */
export const GENERIC_HARNESS_DEFAULTS: {
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
