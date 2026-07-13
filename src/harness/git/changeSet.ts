import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChangeSetEntry { path: string; content_hash: string | null; }
export interface ChangeSet { id: string; base_sha: string; entries: ChangeSetEntry[]; }

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args[0]} failed (exit ${code}): ${stderr.trim()}`);
  return Buffer.from(stdout);
}

function nulList(buffer: Buffer): string[] { return buffer.toString("utf8").split("\0").filter(Boolean); }
async function contentHash(cwd: string, path: string): Promise<string | null> {
  try { return createHash("sha256").update(await readFile(join(cwd, path))).digest("hex"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Capture the exact paths and contents that an agent produced. */
export async function captureChangeSet(cwd: string): Promise<ChangeSet> {
  const base_sha = (await git(cwd, ["rev-parse", "HEAD"])).toString().trim();
  const [tracked, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", "-z", "HEAD"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  // Harness state is authoritative metadata, never agent output and never a
  // commit candidate (not every repository has added .harny to .gitignore).
  const paths = [...new Set([...nulList(tracked), ...nulList(untracked)])]
    .filter((path) => path !== ".harny" && !path.startsWith(".harny/"))
    .sort();
  const entries = await Promise.all(paths.map(async (path) => ({ path, content_hash: await contentHash(cwd, path) })));
  const id = createHash("sha256").update(JSON.stringify({ base_sha, entries })).digest("hex");
  return { id, base_sha, entries };
}

export async function assertChangeSetUnchanged(cwd: string, expected: ChangeSet): Promise<void> {
  const actual = await captureChangeSet(cwd);
  if (actual.id !== expected.id) throw new Error(`ChangeSet changed after validation (expected ${expected.id}, got ${actual.id})`);
}

/** Verify, stage only registered paths, and commit the validated ChangeSet. */
export async function commitChangeSet(cwd: string, message: string, changeSet: ChangeSet): Promise<string | null> {
  await assertChangeSetUnchanged(cwd, changeSet);
  if (!changeSet.entries.length) return null;
  await git(cwd, ["add", "-A", "--", ...changeSet.entries.map((entry) => entry.path)]);
  const staged = await git(cwd, ["diff", "--cached", "--name-only", "-z"]);
  const stagedPaths = nulList(staged).sort();
  const expectedPaths = changeSet.entries.map((entry) => entry.path).sort();
  if (JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)) throw new Error("staged paths differ from the validated ChangeSet");
  await git(cwd, ["commit", "-m", message]);
  return (await git(cwd, ["rev-parse", "HEAD"])).toString().trim();
}
