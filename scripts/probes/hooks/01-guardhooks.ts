/**
 * Probe: guardHooks — exercise buildGuardHooks() callbacks with fabricated
 * PreToolUse inputs and verify allow/deny for every matcher + escape hatch.
 *
 * Validates the LOGIC of our deny rules, not the SDK integration. SDK hook
 * wiring is already validated by scripts/probes/hook-probe.ts.
 *
 * Run when editing src/harness/guardHooks.ts:
 *   bun scripts/probes/hooks/01-guardhooks.ts
 *
 * Hard total deadline 2s (pure in-memory, no I/O).
 */

import { buildGuardHooks, type PhaseGuards } from '../../../src/harness/guardHooks.ts';

const PHASE_CWD = '/tmp/harny-probe-phase';
const PRIMARY_CWD = PHASE_CWD;
const TASK_SLUG = 'probe-task';

type Expected = 'allow' | 'deny';

type Scenario = {
  name: string;
  guards: PhaseGuards;
  toolName: string; // 'Write' | 'Edit' | 'Bash' | 'Read' | ...
  toolInput: Record<string, unknown>;
  expected: Expected;
};

function baseInput(toolName: string, toolInput: Record<string, unknown>) {
  return {
    session_id: 'probe-session',
    transcript_path: '/tmp/probe-transcript',
    cwd: PHASE_CWD,
    hook_event_name: 'PreToolUse' as const,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'probe-tool-use',
  };
}

// Mimic the SDK's matcher dispatch: pick only the hook groups whose matcher
// regex matches the toolName, then run their callbacks in order. First deny
// wins; otherwise allow.
async function evaluate(
  guards: PhaseGuards,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<Expected> {
  const built = buildGuardHooks({
    guards,
    primaryCwd: PRIMARY_CWD,
    phaseCwd: PHASE_CWD,
    taskSlug: TASK_SLUG,
  });
  const groups = built.PreToolUse ?? [];
  const input = baseInput(toolName, toolInput);
  for (const g of groups) {
    if (!g.matcher) continue;
    if (!new RegExp(`^(?:${g.matcher})$`).test(toolName)) continue;
    for (const cb of g.hooks) {
      const out: any = await cb(input as any, 'probe-tool-use-id', { signal: new AbortController().signal });
      const decision = out?.hookSpecificOutput?.permissionDecision;
      if (decision === 'deny') return 'deny';
    }
  }
  return 'allow';
}

const scenarios: Scenario[] = [
  // --- readOnly (validator) ---
  {
    name: 'readOnly: Edit inside phaseCwd is denied',
    guards: { readOnly: true },
    toolName: 'Edit',
    toolInput: { file_path: `${PHASE_CWD}/src/foo.ts` },
    expected: 'deny',
  },
  {
    name: 'readOnly: Edit outside phaseCwd (throwaway) is allowed',
    guards: { readOnly: true },
    toolName: 'Edit',
    toolInput: { file_path: '/tmp/harny-e2e-abc/foo.ts' },
    expected: 'allow',
  },
  {
    name: 'readOnly: Write inside phaseCwd is denied',
    guards: { readOnly: true },
    toolName: 'Write',
    toolInput: { file_path: `${PHASE_CWD}/src/bar.ts` },
    expected: 'deny',
  },
  {
    name: 'readOnly: MultiEdit inside phaseCwd is denied',
    guards: { readOnly: true },
    toolName: 'MultiEdit',
    toolInput: { file_path: `${PHASE_CWD}/src/baz.ts` },
    expected: 'deny',
  },
  {
    name: 'readOnly: Read is not matched (matcher only covers write tools)',
    guards: { readOnly: true },
    toolName: 'Read',
    toolInput: { file_path: `${PHASE_CWD}/src/foo.ts` },
    expected: 'allow',
  },
  {
    name: 'readOnly: Bash is not covered (documented gap)',
    guards: { readOnly: true },
    toolName: 'Bash',
    toolInput: { command: `echo "fix" > ${PHASE_CWD}/src/foo.ts` },
    expected: 'allow',
  },

  // --- noPlanWrites (developer) ---
  {
    name: 'noPlanWrites: Write to plan.json is denied',
    guards: { noPlanWrites: true },
    toolName: 'Write',
    toolInput: { file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/plan.json` },
    expected: 'deny',
  },
  {
    name: 'noPlanWrites: Edit to plan.json is denied',
    guards: { noPlanWrites: true },
    toolName: 'Edit',
    toolInput: { file_path: `.harny/${TASK_SLUG}/plan.json` },
    expected: 'deny',
  },
  {
    name: 'noPlanWrites: Write to other file in same run dir is allowed',
    guards: { noPlanWrites: true },
    toolName: 'Write',
    toolInput: { file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/other.json` },
    expected: 'allow',
  },
  {
    name: 'noPlanWrites: Write to src/ is allowed',
    guards: { noPlanWrites: true },
    toolName: 'Write',
    toolInput: { file_path: `${PHASE_CWD}/src/foo.ts` },
    expected: 'allow',
  },

  // --- noGitHistory (developer) ---
  {
    name: 'noGitHistory: git commit is denied',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git commit -am "wip"' },
    expected: 'deny',
  },
  {
    name: 'noGitHistory: git reset --hard is denied',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git reset --hard HEAD~1' },
    expected: 'deny',
  },
  {
    name: 'noGitHistory: git push is denied',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git push origin main' },
    expected: 'deny',
  },
  {
    name: 'noGitHistory: git rebase is denied',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git rebase main' },
    expected: 'deny',
  },
  {
    name: 'noGitHistory: --amend anywhere is denied',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git commit --amend -m "oops"' },
    expected: 'deny',
  },
  {
    name: 'noGitHistory: cd /tmp/foo && git commit is allowed (escape hatch)',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'cd /tmp/foo && git commit -am "test repo"' },
    expected: 'allow',
  },
  {
    name: 'noGitHistory: git -C /tmp/foo commit is allowed (escape hatch)',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git -C /tmp/foo commit -am "test repo"' },
    expected: 'allow',
  },
  {
    name: 'noGitHistory: git status is allowed (not a forbidden verb)',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    expected: 'allow',
  },
  {
    name: 'noGitHistory: git log is allowed',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git log --oneline -5' },
    expected: 'allow',
  },
  {
    name: 'noGitHistory: non-git Bash is allowed',
    guards: { noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'echo hello' },
    expected: 'allow',
  },

  // --- combos: multiple flags compose additively ---
  {
    name: 'combo: noPlanWrites + noGitHistory both active — plan.json denied',
    guards: { noPlanWrites: true, noGitHistory: true },
    toolName: 'Write',
    toolInput: { file_path: `.harny/${TASK_SLUG}/plan.json` },
    expected: 'deny',
  },
  {
    name: 'combo: noPlanWrites + noGitHistory both active — git commit denied',
    guards: { noPlanWrites: true, noGitHistory: true },
    toolName: 'Bash',
    toolInput: { command: 'git commit -am "wip"' },
    expected: 'deny',
  },
  {
    name: 'combo: noPlanWrites + noGitHistory — src/ write is allowed',
    guards: { noPlanWrites: true, noGitHistory: true },
    toolName: 'Write',
    toolInput: { file_path: `${PHASE_CWD}/src/foo.ts` },
    expected: 'allow',
  },

  // --- empty guards: no hooks installed, everything allowed ---
  {
    name: 'empty guards: Edit plan.json is allowed (no hook installed)',
    guards: {},
    toolName: 'Edit',
    toolInput: { file_path: `${PHASE_CWD}/.harny/${TASK_SLUG}/plan.json` },
    expected: 'allow',
  },
  {
    name: 'empty guards: git reset is allowed (no hook installed)',
    guards: {},
    toolName: 'Bash',
    toolInput: { command: 'git reset --hard' },
    expected: 'allow',
  },
];

const DEADLINE_MS = 2000;
const deadline = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
);

async function runAll(): Promise<number> {
  let failures = 0;
  for (const s of scenarios) {
    try {
      const got = await evaluate(s.guards, s.toolName, s.toolInput);
      if (got === s.expected) {
        console.log(`PASS ${s.name}`);
      } else {
        console.log(`FAIL ${s.name} — expected=${s.expected} got=${got}`);
        failures++;
      }
    } catch (err: any) {
      console.log(`FAIL ${s.name} — threw: ${err?.message ?? err}`);
      failures++;
    }
  }
  return failures;
}

try {
  const failures = await Promise.race([runAll(), deadline]);
  console.log(`\n${scenarios.length - failures}/${scenarios.length} passed`);
  if (failures > 0) process.exit(1);
} catch (err: any) {
  console.log(`FAIL probe: ${err?.message ?? err}`);
  process.exit(1);
}
