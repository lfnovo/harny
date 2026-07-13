import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertChangeSetUnchanged, captureChangeSet, commitChangeSet } from "./changeSet.js";

async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), "harny-changeset-"));
  const run = async (...args: string[]) => { const p = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" }); if (await p.exited) throw new Error(await new Response(p.stderr).text()); };
  await run("init", "-q"); await run("config", "user.email", "test@example.com"); await run("config", "user.name", "Test");
  await writeFile(join(cwd, "base.txt"), "base\n"); await run("add", "."); await run("commit", "-qm", "base"); return cwd;
}

test("ChangeSet enforces implemented = validated = committed", async () => {
  const cwd = await repo();
  await writeFile(join(cwd, "base.txt"), "changed\n"); await writeFile(join(cwd, "new.txt"), "new\n");
  const changeSet = await captureChangeSet(cwd);
  expect(changeSet.entries.map((entry) => entry.path)).toEqual(["base.txt", "new.txt"]);
  expect(await commitChangeSet(cwd, "validated", changeSet)).toMatch(/^[0-9a-f]{40}$/);
});
test("ChangeSet rejects a file changed after validation", async () => {
  const cwd = await repo(); await writeFile(join(cwd, "base.txt"), "first\n");
  const changeSet = await captureChangeSet(cwd); await writeFile(join(cwd, "base.txt"), "tampered\n");
  expect(assertChangeSetUnchanged(cwd, changeSet)).rejects.toThrow("changed after validation");
});

test("ChangeSet rejects a new file appearing after validation", async () => {
  const cwd = await repo(); await writeFile(join(cwd, "base.txt"), "first\n");
  const changeSet = await captureChangeSet(cwd); await writeFile(join(cwd, "surprise.txt"), "surprise\n");
  expect(commitChangeSet(cwd, "unsafe", changeSet)).rejects.toThrow("changed after validation");
});
