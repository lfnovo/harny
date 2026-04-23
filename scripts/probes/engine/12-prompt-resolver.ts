/**
 * Probe: prompt resolver — 5 resolution scenarios, zero real Claude calls.
 * (a) bundled-default fallback
 * (b) bundled-variant beats bundled-default
 * (c) project-default beats bundled
 * (d) project-variant beats project-default
 * (e) missing-variant falls back to project-default
 *
 * RUN
 *   bun scripts/probes/engine/12-prompt-resolver.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpGitRepo } from '../../../src/harness/testing/index.ts';
import { resolvePrompt } from '../../../src/harness/engine/promptResolver.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): bundled-default fallback — no project overrides, no variant file
try {
  await Promise.race([
    (async () => {
      const name = 'bundled-default-fallback';
      const repo = await tmpGitRepo();
      try {
        const result = resolvePrompt('feature-dev-engine', 'default', 'planner', repo.path);
        if (!result.includes('You are the PLANNER')) {
          throw new Error(`expected bundled planner content, got: ${result.slice(0, 80)}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL bundled-default-fallback: ${e.message}`);
  failures++;
}

// Scenario (b): bundled-variant beats bundled-default
try {
  await Promise.race([
    (async () => {
      const name = 'bundled-variant-beats-default';
      const repo = await tmpGitRepo();
      try {
        const result = resolvePrompt('feature-dev-engine', '_test-variant', 'planner', repo.path);
        if (!result.includes('TEST-VARIANT-PLANNER-UNIQUE-CONTENT')) {
          throw new Error(`expected test-variant content, got: ${result.slice(0, 80)}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL bundled-variant-beats-default: ${e.message}`);
  failures++;
}

// Scenario (c): project-default beats bundled
try {
  await Promise.race([
    (async () => {
      const name = 'project-default-beats-bundled';
      const repo = await tmpGitRepo();
      try {
        const promptDir = join(repo.path, '.harny', 'prompts', 'feature-dev-engine', 'default');
        await mkdir(promptDir, { recursive: true });
        await writeFile(join(promptDir, 'planner.md'), 'PROJECT-DEFAULT-PLANNER', 'utf8');

        const result = resolvePrompt('feature-dev-engine', 'default', 'planner', repo.path);
        if (result !== 'PROJECT-DEFAULT-PLANNER') {
          throw new Error(`expected project-default content, got: ${result.slice(0, 80)}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL project-default-beats-bundled: ${e.message}`);
  failures++;
}

// Scenario (d): project-variant beats project-default
try {
  await Promise.race([
    (async () => {
      const name = 'project-variant-beats-project-default';
      const repo = await tmpGitRepo();
      try {
        const defaultDir = join(repo.path, '.harny', 'prompts', 'feature-dev-engine', 'default');
        const variantDir = join(repo.path, '.harny', 'prompts', 'feature-dev-engine', 'my-variant');
        await mkdir(defaultDir, { recursive: true });
        await mkdir(variantDir, { recursive: true });
        await writeFile(join(defaultDir, 'planner.md'), 'PROJECT-DEFAULT-PLANNER', 'utf8');
        await writeFile(join(variantDir, 'planner.md'), 'PROJECT-VARIANT-PLANNER', 'utf8');

        const result = resolvePrompt('feature-dev-engine', 'my-variant', 'planner', repo.path);
        if (result !== 'PROJECT-VARIANT-PLANNER') {
          throw new Error(`expected project-variant content, got: ${result.slice(0, 80)}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL project-variant-beats-project-default: ${e.message}`);
  failures++;
}

// Scenario (e): missing-variant falls back to project-default
try {
  await Promise.race([
    (async () => {
      const name = 'missing-variant-falls-back-to-project-default';
      const repo = await tmpGitRepo();
      try {
        const defaultDir = join(repo.path, '.harny', 'prompts', 'feature-dev-engine', 'default');
        await mkdir(defaultDir, { recursive: true });
        await writeFile(join(defaultDir, 'planner.md'), 'PROJECT-DEFAULT-FALLBACK', 'utf8');
        // no my-variant dir — variant file absent

        const result = resolvePrompt('feature-dev-engine', 'my-variant', 'planner', repo.path);
        if (result !== 'PROJECT-DEFAULT-FALLBACK') {
          throw new Error(`expected project-default fallback, got: ${result.slice(0, 80)}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL missing-variant-falls-back-to-project-default: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
