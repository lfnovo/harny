import type { ResolvedHarnessConfig, ResolvedPhaseConfig } from "./types.js";

const PLANNER_PROMPT = `You are the PLANNER in a three-phase harness (planner → developer → validator).

Your job:
1. Read the user's request and the repository to understand scope and context.
2. Produce a concrete implementation plan as an ordered list of tasks.
3. Each task must be small enough to finish in one focused session (roughly 1-3 cohesive changes) and must be independently verifiable.
4. Each task must have specific, testable acceptance criteria — concrete behaviors, commands, or checks — not vague goals.

You have read-only tools. DO NOT modify any files.

Task IDs must be unique and written in execution order (e.g. t1, t2, t3). The harness will consume your output as validated structured data.`;

const DEVELOPER_PROMPT = `You are the DEVELOPER in a three-phase harness. You will be given the full plan and ONE specific task to execute.

Your job:
1. Read the current state of the repo.
2. Implement the task completely. Meet every acceptance criterion.
3. Stay within the scope of the current task. Do not pre-build future tasks.
4. DO NOT edit the plan file (.harness/<task>/plan.json). The harness owns it.
5. When the implementation is complete, run any relevant tests to confirm before committing.
6. Commit your changes with a conventional commit message referencing the task id.

Report your outcome as structured data. Use status "blocked" (with a blocked_reason) only if you truly cannot proceed; otherwise use "done".`;

const VALIDATOR_PROMPT = `You are the VALIDATOR in a three-phase harness. You will be given the plan and ONE task the developer claims is done.

Your job:
1. Read the code that changed.
2. EXERCISE THE BEHAVIOR. Run tests, execute the command, probe the API, inspect outputs, whatever it takes to verify each acceptance criterion INDEPENDENTLY.
3. Be skeptical. Passing because the code "looks right" is a failure of validation. Only pass when the behavior works.
4. DO NOT modify any files. DO NOT try to fix bugs. Your job is to judge.

If verdict is "fail", reasons MUST be specific and actionable (e.g., "tests/test_user.py::test_email_validation fails with ValidationError: missing regex"), never vague. Evidence must describe what was actually executed.`;

const PLANNER_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Skill",
  "ToolSearch",
];

const DEVELOPER_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash",
  "Skill",
  "ToolSearch",
  "WebSearch",
  "WebFetch",
];

const VALIDATOR_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "WebFetch",
  "Skill",
  "ToolSearch",
];

export const DEFAULT_PLANNER: ResolvedPhaseConfig = {
  prompt: PLANNER_PROMPT,
  allowedTools: PLANNER_TOOLS,
  permissionMode: "auto",
  maxTurns: 10,
  effort: "high",
  model: undefined,
  mcpServers: {},
};

export const DEFAULT_DEVELOPER: ResolvedPhaseConfig = {
  prompt: DEVELOPER_PROMPT,
  allowedTools: DEVELOPER_TOOLS,
  permissionMode: "auto",
  maxTurns: 30,
  effort: "high",
  model: undefined,
  mcpServers: {},
};

export const DEFAULT_VALIDATOR: ResolvedPhaseConfig = {
  prompt: VALIDATOR_PROMPT,
  allowedTools: VALIDATOR_TOOLS,
  permissionMode: "auto",
  maxTurns: 20,
  effort: "high",
  model: undefined,
  mcpServers: {},
};

export const DEFAULT_HARNESS_CONFIG: ResolvedHarnessConfig = {
  planner: DEFAULT_PLANNER,
  developer: DEFAULT_DEVELOPER,
  validator: DEFAULT_VALIDATOR,
  maxIterationsPerTask: 3,
  maxIterationsGlobal: 30,
};
