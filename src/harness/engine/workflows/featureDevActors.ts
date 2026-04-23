// Production actor implementations for feature-dev.
// Machine shape lives in featureDev.ts; wired implementations live here.
// Contract: call machine.provide({ actors: buildFeatureDevActors(deps) }) at run-time.

import { fromPromise } from 'xstate';
import { z } from 'zod';
import { adaptRunPhase } from '../runtime/runPhaseAdapter.js';
import type { SessionRunPhase } from '../runtime/runPhaseAdapter.js';
import { DEFAULT_PLANNER, DEFAULT_DEVELOPER, DEFAULT_VALIDATOR } from './featureDev/shared.js';
import { resolvePrompt } from '../promptResolver.js';
import { PlannerVerdictSchema, DeveloperVerdictSchema } from './featureDev/shared.js';
import { gitCommit as defaultGitCommit } from '../harnyActions.js';
import type { LogMode, Plan, PlanTask, RunMode } from '../../types.js';
import type { StateStore } from '../../state/store.js';
import { planFilePath, savePlan } from '../../state/plan.js';

// Engine-layer adapter schemas — extract only what the machine needs from legacy verdict shapes.
const EngineDeveloperOutputSchema = z.object({
  status: z.enum(['done', 'blocked']),
  commit_message: z.string().default(''),
}).passthrough();

// Engine-layer validator schema — includes 'blocked' which the legacy ValidatorVerdictSchema omits.
// The legacy schema only has 'pass'|'fail'; passing it to the SDK would prevent the model from
// ever returning 'blocked', silently breaking the engine's blocked→failed routing.
// The engine owns its own schema; legacy stays untouched.
const EngineValidatorVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'blocked']),
  reasons: z.array(z.string()).default([]),
}).passthrough();

export interface BuildFeatureDevActorsDeps {
  cwd: string;
  taskSlug: string;
  runId: string;
  /** Injectable for testing; omit to use the real runPhase from sessionRecorder. */
  sessionRunPhase?: SessionRunPhase;
  /** Injectable for testing; omit to use the real gitCommit from harnyActions. */
  gitCommit?: (opts: { cwd: string; message: string }, signal: AbortSignal) => Promise<{ sha: string | null }>;
  mode?: RunMode;
  logMode?: LogMode;
  /** When provided, phases[] and history[] are written around each phase call. */
  store?: StateStore;
  /** Prompt variant to resolve. Required; caller (orchestrator) normalizes to 'default' if unspecified. */
  variant: string;
}

export function buildFeatureDevActors(deps: BuildFeatureDevActorsDeps) {
  const runPhasePlanner = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: { ...DEFAULT_PLANNER, prompt: resolvePrompt('feature-dev', deps.variant, 'planner', deps.cwd) },
    sessionRunPhase: deps.sessionRunPhase,
    mode: deps.mode,
    logMode: deps.logMode,
    store: deps.store,
  });

  const runPhaseDev = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: { ...DEFAULT_DEVELOPER, prompt: resolvePrompt('feature-dev', deps.variant, 'developer', deps.cwd) },
    sessionRunPhase: deps.sessionRunPhase,
    mode: deps.mode,
    logMode: deps.logMode,
    store: deps.store,
  });

  const runPhaseValidator = adaptRunPhase({
    cwd: deps.cwd,
    workflowId: 'feature-dev',
    taskSlug: deps.taskSlug,
    runId: deps.runId,
    phaseConfig: { ...DEFAULT_VALIDATOR, prompt: resolvePrompt('feature-dev', deps.variant, 'validator', deps.cwd) },
    sessionRunPhase: deps.sessionRunPhase,
    mode: deps.mode,
    logMode: deps.logMode,
    store: deps.store,
  });

  const plannerActor = fromPromise<Plan, { prompt: string; cwd: string }>(
    async ({ input }) => {
      const result = await runPhasePlanner({
        phaseName: 'planner',
        prompt: input.prompt,
        schema: PlannerVerdictSchema,
        allowedTools: DEFAULT_PLANNER.allowedTools,
        attempt: 1,
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
    { task: PlanTask; cwd: string; resumeSessionId?: string; attempt?: number }
  >(async ({ input }) => {
    const prompt = buildDeveloperPrompt(input.task);
    const result = await runPhaseDev({
      phaseName: 'developer',
      prompt,
      schema: DeveloperVerdictSchema,
      allowedTools: DEFAULT_DEVELOPER.allowedTools,
      resumeSessionId: input.resumeSessionId,
      attempt: input.attempt ?? 1,
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
    { task: PlanTask; cwd: string; resumeSessionId?: string; attempt?: number }
  >(async ({ input }) => {
    const prompt = buildValidatorPrompt(input.task);
    const result = await runPhaseValidator({
      phaseName: 'validator',
      prompt,
      schema: EngineValidatorVerdictSchema,
      allowedTools: DEFAULT_VALIDATOR.allowedTools,
      resumeSessionId: input.resumeSessionId,
      attempt: input.attempt ?? 1,
    });
    const verdict = EngineValidatorVerdictSchema.parse(result.output);
    return {
      session_id: result.session_id,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
    };
  });

  const gitCommitFn = deps.gitCommit ?? defaultGitCommit;
  const commitActor = fromPromise<{ sha: string | null }, { cwd: string; message: string }>(
    ({ input, signal }) => gitCommitFn({ cwd: input.cwd, message: input.message }, signal),
  );

  // Persists the planner's output to .harny/<slug>/plan.json. Called once,
  // immediately after plannerActor returns, via the machine's persistingPlan
  // state. Errors route to the machine's failed state so the run terminates
  // cleanly rather than proceeding with an unpersisted plan.
  const persistPlanActor = fromPromise<void, { cwd: string; taskSlug: string; plan: Plan }>(
    async ({ input }) => {
      await savePlan(planFilePath(input.cwd, input.taskSlug), input.plan);
    },
  );

  return { plannerActor, developerActor, validatorActor, commitActor, persistPlanActor };
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
