// engine-design.md §8, §11 — production actor implementations for feature-dev-engine.
// Machine shape lives in featureDev.ts; wired implementations live here.
// Contract: call machine.provide({ actors: buildFeatureDevActors(deps) }) at run-time.

import { fromPromise } from 'xstate';
import { adaptRunPhase } from '../runtime/runPhaseAdapter.js';
import type { SessionRunPhase } from '../runtime/runPhaseAdapter.js';
import { DEFAULT_PLANNER } from '../../workflows/featureDev/defaults.js';
import { PlannerVerdictSchema } from '../../workflows/featureDev/verdicts.js';
import type { Plan, PlanTask } from '../../types.js';

export interface BuildFeatureDevActorsDeps {
  cwd: string;
  taskSlug: string;
  runId: string;
  /** Injectable for testing; omit to use the real runPhase from sessionRecorder. */
  sessionRunPhase?: SessionRunPhase;
}

export function buildFeatureDevActors(deps: BuildFeatureDevActorsDeps) {
  const runPhase = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev-engine',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: DEFAULT_PLANNER,
    sessionRunPhase: deps.sessionRunPhase,
  });

  const plannerActor = fromPromise<Plan, { prompt: string; cwd: string }>(
    async ({ input }) => {
      const result = await runPhase({
        phaseName: 'planner',
        prompt: input.prompt,
        schema: PlannerVerdictSchema,
        allowedTools: DEFAULT_PLANNER.allowedTools,
      });

      const verdict = PlannerVerdictSchema.parse(result.output);
      const now = new Date().toISOString();

      return {
        schema_version: 1 as const,
        task_slug: deps.taskSlug,
        primary_cwd: deps.cwd,
        user_prompt: input.prompt,
        branch: '',
        isolation: 'inline' as const,
        worktree_path: null,
        created_at: now,
        updated_at: now,
        status: 'in_progress' as const,
        summary: verdict.summary,
        iterations_global: 0,
        tasks: verdict.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          acceptance: t.acceptance,
          status: 'pending' as const,
          attempts: 0,
          commit_sha: null,
          history: [],
        })),
        metadata: { planner_session_id: result.session_id },
      };
    },
  );

  const developerActor = fromPromise<
    { session_id?: string },
    { task: PlanTask; cwd: string; resumeSessionId?: string }
  >(async () => {
    throw new Error('wired in B.3');
  });

  const validatorActor = fromPromise<
    { verdict: 'pass' | 'fail' | 'blocked'; session_id?: string },
    { task: PlanTask; cwd: string; resumeSessionId?: string }
  >(async () => {
    throw new Error('wired in B.3');
  });

  return { plannerActor, developerActor, validatorActor };
}
