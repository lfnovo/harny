import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLED_DIR = join(import.meta.dir, 'workflows', 'prompts');

export function resolvePrompt(
  workflowId: string,
  variant: string,
  actor: string,
  cwd: string,
): string {
  const filename = `${actor}.md`;
  const candidates = [
    join(cwd, '.harny', 'prompts', workflowId, variant, filename),
    join(cwd, '.harny', 'prompts', workflowId, 'default', filename),
    join(BUNDLED_DIR, variant, filename),
    join(BUNDLED_DIR, 'default', filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }

  throw new Error(
    `resolvePrompt: no prompt found for workflow=${workflowId} variant=${variant} actor=${actor} cwd=${cwd}`,
  );
}
