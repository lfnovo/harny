// engine-design.md §8, §11 — production actor implementations for feature-dev-engine.
// Machine shape lives in featureDev.ts; wired implementations live here.
// Contract: call machine.provide({ actors: buildFeatureDevActors(deps) }) at run-time.

import { fromPromise } from 'xstate';
import { z } from 'zod';
import { adaptRunPhase } from '../runtime/runPhaseAdapter.js';
import type { SessionRunPhase } from '../runtime/runPhaseAdapter.js';
import { DEFAULT_PLANNER, DEFAULT_DEVELOPER, DEFAULT_VALIDATOR } from '../../workflows/featureDev/defaults.js';
import { PlannerVerdictSchema, DeveloperVerdictSchema, ValidatorVerdictSchema } from '../../workflows/featureDev/verdicts.js';
import type { Plan, PlanTask } from '../../types.js';

// Engine-layer adapter schemas — extract only what the machine needs from legacy verdict shapes.
// ValidatorVerdictSchema only has 'pass'|'fail'; extend to include 'blocked' for engine routing.
const EngineDeveloperOutputSchema = z.object({
  status: z.enum(['done', 'blocked']),
  commit_message: z.string().default(''),
}).passthrough();

const EngineValidatorOutputSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'blocked']),
  reasons: z.array(z.string()).default([]),
}).passthrough();

export interface BuildFeatureDevActorsDeps {
  cwd: string;
  taskSlug: string;
  runId: string;
  /** Injectable for testing; omit to use the real runPhase from sessionRecorder. */
  sessionRunPhase?: SessionRunPhase;
}

export function buildFeatureDevActors(deps: BuildFeatureDevActorsDeps) {
  const runPhasePlanner = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev-engine',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: DEFAULT_PLANNER,
    sessionRunPhase: deps.sessionRunPhase,
  });

  const runPhaseDev = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev-engine',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: DEFAULT_DEVELOPER,
    sessionRunPhase: deps.sessionRunPhase,
  });

  const runPhaseValidator = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev-engine',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: DEFAULT_VALIDATOR,
    sessionRunPhase: deps.sessionRunPhase,
  });

  const plannerActor = fromPromise<Plan, { prompt: string; cwd: string }>(
    async ({ input }) => {
      const result = await runPhasePlanner({
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
    { session_id: string; status: 'done' | 'blocked'; commit_message: string },
    { task: PlanTask; cwd: string; resumeSessionId?: string }
  >(async ({ input }) => {
    const prompt = buildDeveloperPrompt(input.task);
    const result = await runPhaseDev({
      phaseName: 'developer',
      prompt,
      schema: DeveloperVerdictSchema,
      allowedTools: DEFAULT_DEVELOPER.allowedTools,
      resumeSessionId: input.resumeSessionId,
    });
    const verdict = EngineDeveloperOutputSchema.parse(result.output);
    return {
      session_id: result.session_id,
      status: verdict.status,
      commit_message: verdict.commit_message,
    };
  });

  const validatorActor = fromPromise<
    { verdict: 'pass' | 'fail' | 'blocked'; session_id: string; reasons: string[] },
    { task: PlanTask; cwd: string; resumeSessionId?: string }
  >(async ({ input }) => {
    const prompt = buildValidatorPrompt(input.task);
    const result = await runPhaseValidator({
      phaseName: 'validator',
      prompt,
      schema: ValidatorVerdictSchema,
      allowedTools: DEFAULT_VALIDATOR.allowedTools,
      resumeSessionId: input.resumeSessionId,
    });
    const verdict = EngineValidatorOutputSchema.parse(result.output);
    return {
      session_id: result.session_id,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
    };
  });

  return { plannerActor, developerActor, validatorActor };
}

function buildDeveloperPrompt(task: PlanTask): string {
  const acceptance = task.acceptance.map((a) => `- ${a}`).join('\n');
  return [
    `Execute task: ${task.title}`,
    '',
    task.description,
    '',
    'Acceptance criteria:',
    acceptance || '- (none specified)',
  ].join('\n');
}

function buildValidatorPrompt(task: PlanTask): string {
  const acceptance = task.acceptance.map((a) => `- ${a}`).join('\n');
  return [
    `Validate task: ${task.title}`,
    '',
    task.description,
    '',
    'Acceptance criteria to verify:',
    acceptance || '- (none specified)',
  ].join('\n');
}
