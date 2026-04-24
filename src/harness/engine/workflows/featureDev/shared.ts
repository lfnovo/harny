import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ResolvedPhaseConfig } from '../../../types.js';
import { ProblemSchema } from '../../../state/problem.js';

// Prompts are single-sourced from the bundled .md files next door. Loading at
// module init means a missing or misnamed file surfaces at startup, not on the
// first phase invocation. See #68 for the prior drift that motivated this.
const BUNDLED_PROMPTS_DIR = join(import.meta.dir, '..', 'prompts', 'default');
const PLANNER_PROMPT = readFileSync(join(BUNDLED_PROMPTS_DIR, 'planner.md'), 'utf8');
const DEVELOPER_PROMPT = readFileSync(join(BUNDLED_PROMPTS_DIR, 'developer.md'), 'utf8');
const VALIDATOR_PROMPT = readFileSync(join(BUNDLED_PROMPTS_DIR, 'validator.md'), 'utf8');

const PLANNER_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Skill',
  'ToolSearch',
  'AskUserQuestion',
];

const DEVELOPER_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'Skill',
  'ToolSearch',
  'WebSearch',
  'WebFetch',
];

const VALIDATOR_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'Skill',
  'ToolSearch',
];

export const DEFAULT_PLANNER: ResolvedPhaseConfig = {
  prompt: PLANNER_PROMPT,
  allowedTools: PLANNER_TOOLS,
  permissionMode: 'bypassPermissions',
  maxTurns: 50,
  effort: 'high',
  model: 'sonnet',
  mcpServers: {},
  // Planner's allowedTools are already read-only; no SDK-level guards needed.
  guards: {},
};

export const DEFAULT_DEVELOPER: ResolvedPhaseConfig = {
  prompt: DEVELOPER_PROMPT,
  allowedTools: DEVELOPER_TOOLS,
  permissionMode: 'bypassPermissions',
  maxTurns: 200,
  effort: 'high',
  model: 'sonnet',
  mcpServers: {},
  // Enforces two CLAUDE.md invariants at the SDK layer: "harness is sole
  // writer of plan.json" and "harness is sole committer". Escape hatches
  // for throwaway paths (cd /tmp/..., git -C /tmp/...) live in guardHooks.ts.
  guards: { noPlanWrites: true, noGitHistory: true },
};

export const DEFAULT_VALIDATOR: ResolvedPhaseConfig = {
  prompt: VALIDATOR_PROMPT,
  allowedTools: VALIDATOR_TOOLS,
  permissionMode: 'bypassPermissions',
  maxTurns: 200,
  effort: 'high',
  model: 'sonnet',
  mcpServers: {},
  // readOnly blocks Edit/Write/MultiEdit/NotebookEdit inside the phase cwd.
  // NOTE: does NOT cover Bash — validator can still `echo > file`, `sed -i`,
  // `rm`, etc. Accepted gap: validator needs Bash to exercise tests; full
  // mutation blocking is brittle. Rely on prompt + allowedTools for Bash.
  guards: { readOnly: true },
};

const PROBLEMS_FIELD_DESCRIPTION =
  'OPTIONAL. Problems encountered during this attempt that would benefit FUTURE runs of the harness if fixed at the project level (not fixed within this task). Examples: missing CLAUDE.md coverage of a critical area, missing dev dependency, ambiguous acceptance criterion, agent tool you wished you had. Leave empty/omit if nothing noteworthy.';

export const PlannerVerdictSchema = z
  .object({
    summary: z.string().describe('One-line description of what will be built'),
    tasks: z
      .array(
        z.object({
          id: z.string().describe('Unique task identifier in execution order (e.g. t1, t2)'),
          title: z.string().describe('Short imperative title'),
          description: z.string().describe('What to do and why'),
          acceptance: z
            .array(z.string())
            .describe('Specific, testable acceptance criteria'),
        }),
      )
      .min(1),
  })
  .strict();

export const DeveloperVerdictSchema = z
  .object({
    task_id: z.string(),
    status: z.enum(['done', 'blocked']),
    summary: z
      .string()
      .describe('2-3 sentence description of what changed'),
    commit_message: z
      .string()
      .describe(
        'Proposed conventional-commit message (subject line only, or subject + body). The harness will commit on your behalf if validation passes. Empty string if status is blocked.',
      ),
    blocked_reason: z
      .string()
      .optional()
      .describe('Required when status is blocked'),
    problems: z
      .array(ProblemSchema)
      .optional()
      .describe(PROBLEMS_FIELD_DESCRIPTION),
  })
  .strict();

export type PlannerVerdict = z.infer<typeof PlannerVerdictSchema>;
export type DeveloperVerdict = z.infer<typeof DeveloperVerdictSchema>;
