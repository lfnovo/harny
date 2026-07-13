import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface ChangeSetEntry { path: string; content_hash: string | null; }
export interface ChangeSet { id: string; base_sha: string; entries: ChangeSetEntry[]; }
export interface ChangeSetPolicy { allowPaths?: readonly string[]; maxFiles?: number; maxBytes?: number; }

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

/** Reject generated, credential-like, or unexpectedly large diffs before provider validation. */
export async function assertChangeSetAllowed(cwd: string, changeSet: ChangeSet, policy: ChangeSetPolicy = {}): Promise<void> {
  const allowed = policy.allowPaths ?? [];
  const protectedPaths = changeSet.entries.map((entry) => entry.path).filter((path) => isProtected(path) && !isAllowed(path, allowed));
  if (protectedPaths.length) throw new Error(`ChangeSet contains protected paths: ${protectedPaths.slice(0, 10).join(", ")}`);
  const maxFiles = policy.maxFiles ?? 500;
  if (changeSet.entries.length > maxFiles) throw new Error(`ChangeSet contains ${changeSet.entries.length} files, limit is ${maxFiles}`);
  const sizes = await Promise.all(changeSet.entries.map(async (entry) => {
    if (entry.content_hash === null) return 0;
    try { return (await stat(join(cwd, entry.path))).size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  }));
  const bytes = sizes.reduce((total, size) => total + size, 0);
  const maxBytes = policy.maxBytes ?? 10 * 1024 * 1024;
  if (bytes > maxBytes) throw new Error(`ChangeSet contains ${bytes} bytes, limit is ${maxBytes}`);
}

function isAllowed(path: string, allowed: readonly string[]): boolean {
  return allowed.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

function isProtected(path: string): boolean {
  if (path === "node_modules" || path.startsWith("node_modules/") || path.includes("/node_modules/")) return true;
  const name = path.split("/").at(-1) ?? path;
  if (name === ".env" || (name.startsWith(".env.") && !/[.](example|sample|template)$/.test(name))) return true;
  return /^(id_rsa|id_ed25519)$/.test(name) || /\.(pem|key)$/.test(name);
}

/** Verify, stage only registered paths, and commit the validated ChangeSet. */
export async function commitChangeSet(cwd: string, message: string, changeSet: ChangeSet, policy: ChangeSetPolicy = {}): Promise<string | null> {
  await assertChangeSetUnchanged(cwd, changeSet);
  await assertChangeSetAllowed(cwd, changeSet, policy);
  if (!changeSet.entries.length) return null;
  await git(cwd, ["add", "-A", "--", ...changeSet.entries.map((entry) => entry.path)]);
  const staged = await git(cwd, ["diff", "--cached", "--name-only", "-z"]);
  const stagedPaths = nulList(staged).sort();
  const expectedPaths = changeSet.entries.map((entry) => entry.path).sort();
  if (JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)) throw new Error("staged paths differ from the validated ChangeSet");
  await git(cwd, ["commit", "-m", message]);
  return (await git(cwd, ["rev-parse", "HEAD"])).toString().trim();
}
