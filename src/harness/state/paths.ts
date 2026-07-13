import { join } from "node:path";

export function runDir(primaryCwd: string, taskSlug: string): string { return join(primaryCwd, ".harny", taskSlug); }
export function worktreePathFor(primaryCwd: string, taskSlug: string): string { return join(primaryCwd, ".harny", "worktrees", taskSlug); }
