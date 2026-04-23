// engine-design.md §8, §8.4
import { z } from 'zod';
import { runPhase, type PhaseRunResult } from '../../sessionRecorder.js';
import type { LogMode, PhaseName, ResolvedPhaseConfig, RunMode } from '../../types.js';
import type { AgentRunOptions } from '../types.js';

export type AgentRunOptionsSubset = Pick<
  AgentRunOptions,
  'phaseName' | 'prompt' | 'schema' | 'allowedTools' | 'resumeSessionId'
> & { signal?: AbortSignal };

export type SessionRunPhase = (args: {
  phase: PhaseName;
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
  harnessTaskId: string | null;
  prompt: string;
  outputSchema: z.ZodType<unknown>;
  resumeSessionId?: string | null;
  logMode?: LogMode;
  mode?: RunMode;
  workflowId: string;
  runId: string;
}) => Promise<PhaseRunResult<unknown>>;

export interface AdaptRunPhaseDeps {
  cwd: string;
  workflowId: string;
  taskSlug: string;
  runId: string;
  log?: (msg: string) => void;
  /** Full phase config; engine allowedTools always win over this value. */
  phaseConfig: ResolvedPhaseConfig;
  /** Injectable for testing; defaults to the real runPhase from sessionRecorder. */
  sessionRunPhase?: SessionRunPhase;
  mode?: RunMode;
  logMode?: LogMode;
}

export function adaptRunPhase(
  deps: AdaptRunPhaseDeps,
): (engineArgs: AgentRunOptionsSubset) => Promise<{ output: unknown; session_id: string }> {
  const sessionRunPhaseFn = deps.sessionRunPhase ?? (runPhase as unknown as SessionRunPhase);

  return async (engineArgs: AgentRunOptionsSubset) => {
    const phaseConfig: ResolvedPhaseConfig = {
      ...deps.phaseConfig,
      // engine args always win on allowedTools
      allowedTools: engineArgs.allowedTools,
    };

    const result = await sessionRunPhaseFn({
      phase: engineArgs.phaseName,
      phaseConfig,
      primaryCwd: deps.cwd,
      phaseCwd: deps.cwd,
      taskSlug: deps.taskSlug,
      harnessTaskId: null,
      prompt: engineArgs.prompt,
      outputSchema: engineArgs.schema as z.ZodType<unknown>,
      resumeSessionId: engineArgs.resumeSessionId,
      workflowId: deps.workflowId,
      runId: deps.runId,
      mode: deps.mode ?? 'silent',
      logMode: deps.logMode ?? 'compact',
    });

    if (result.status === 'error') {
      throw new Error(result.error ?? 'phase failed');
    }
    if (result.status === 'paused_for_user_input') {
      throw new Error('phase paused for user input; not supported in engine adapter');
    }

    return { output: result.structuredOutput, session_id: result.sessionId };
  };
}
