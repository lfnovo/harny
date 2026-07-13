import type { State } from "../schema.js";
import type { RunV3 } from "./schema.js";

export type HistoricalRun =
  | { schema_version: 2; id: string; workflow: string; status: State["lifecycle"]["status"]; started_at: string; ended_at: string | null; cwd: string; branch: string; resumable: false; raw: State }
  | { schema_version: 3; id: string; workflow: string; status: RunV3["run"]["status"]; started_at: string; ended_at: string | null; cwd: string; branch: string; resumable: true; raw: RunV3 };

export function normalizeV2Run(state: State): HistoricalRun {
  return { schema_version: 2, id: state.run_id, workflow: state.origin.workflow, status: state.lifecycle.status, started_at: state.origin.started_at, ended_at: state.lifecycle.ended_at, cwd: state.environment.cwd, branch: state.environment.branch, resumable: false, raw: state };
}
export function normalizeV3Run(state: RunV3): HistoricalRun {
  return { schema_version: 3, id: state.run.id, workflow: state.run.workflow, status: state.run.status, started_at: state.run.started_at, ended_at: state.run.ended_at, cwd: state.workspace.primary_cwd, branch: state.workspace.branch, resumable: true, raw: state };
}
