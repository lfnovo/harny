/**
 * Zero-token template for a persisted workflow validator probe.
 * Copy this file into a numbered probe directory and replace the executor
 * assertions with the behavior being validated.
 */
import { WorkflowDefinitionSchema } from '../../../src/harness/workflow/schema.ts';
import { runWorkflow, type WorkflowSnapshot } from '../../../src/harness/workflow/runtime.ts';

let snapshot: WorkflowSnapshot | null = null;
const workflow = WorkflowDefinitionSchema.parse({
  version: 1,
  name: 'validator-smoke',
  defaults: { provider: 'claude', timeout: 1_000 },
  workspace: { isolation: 'inline' },
  outcome: { type: 'none' },
  nodes: [{ id: 'validate', type: 'command', command: ['validate-fixture'], depends_on: [], inputs: {} }],
});

const result = await runWorkflow({
  workflow,
  store: {
    async load() { return snapshot; },
    async save(value) { snapshot = structuredClone(value); },
  },
  executors: {
    async command() { return { verdict: 'pass', evidence: ['fixture checked'] }; },
  },
});

if (result.status !== 'done' || result.nodes.validate?.status !== 'completed') {
  console.error('FAIL validator-smoke');
  process.exit(1);
}
console.log('PASS validator-smoke');
