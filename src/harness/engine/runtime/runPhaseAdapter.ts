// engine-design.md §8, §8.4
import { z } from 'zod';
import { runPhase, type PhaseRunResult } from '../../sessionRecorder.js';
import type { LogMode, PhaseName, ResolvedPhaseConfig, RunMode } from '../../types.js';
import type { AgentRunOptions } from '../types.js';
import type { StateStore } from '../../state/store.js';
import type { PhaseGuards } from '../../guardHooks.js';

export type AgentRunOptionsSubset = Pick<
  AgentRunOptions,
  'phaseName' | 'prompt' | 'schema' | 'allowedTools' | 'resumeSessionId'
> & { signal?: AbortSignal; attempt?: number };

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
  guards?: PhaseGuards;
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
  /** When provided, writes phases[] and history[] entries around each phase call. */
  store?: StateStore;
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

    const attempt = engineArgs.attempt ?? 1;
    const startedAt = new Date().toISOString();

    if (deps.store) {
      await deps.store.appendPhase({
        name: engineArgs.phaseName,
        attempt,
        started_at: startedAt,
        ended_at: null,
        status: 'running',
        verdict: null,
        session_id: null,
      });
      await deps.store.appendHistory({ at: startedAt, phase: engineArgs.phaseName, event: 'phase_start' });
    }

    let phaseStatus: 'completed' | 'failed' = 'failed';
    let phaseSessionId: string | null = null;
    let phaseVerdict: string | null = null;

    try {
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
        // Thread phase-level SDK guards so invariants like "harness is sole
        // writer of plan.json" / "sole committer" are enforced at the SDK
        // layer, not just by prompt. See guardHooks.ts.
        guards: phaseConfig.guards,
      });

      if (result.status === 'error') {
        phaseSessionId = result.sessionId;
        throw new Error(result.error ?? 'phase failed');
      }
      if (result.status === 'paused_for_user_input') {
        phaseSessionId = result.sessionId;
        throw new Error('phase paused for user input; not supported in engine adapter');
      }

      phaseStatus = 'completed';
      phaseSessionId = result.sessionId;
      phaseVerdict = JSON.stringify(result.structuredOutput);

      return { output: result.structuredOutput, session_id: result.sessionId };
    } finally {
      if (deps.store) {
        const endedAt = new Date().toISOString();
        await deps.store.updatePhase(engineArgs.phaseName, attempt, {
          ended_at: endedAt,
          status: phaseStatus,
          session_id: phaseSessionId,
          verdict: phaseVerdict,
        });
        await deps.store.appendHistory({ at: endedAt, phase: engineArgs.phaseName, event: 'phase_end' });
      }
    }
  };
}
