import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSiblingBranches } from "../../../src/viewer/server.ts";

function git(cwd: string, ...args: string[]) { execFileSync("git", args, { cwd, stdio: "pipe" }); }
function repo(files: string[]): string { const cwd = mkdtempSync(join(tmpdir(), "harny-sibling-")); git(cwd, "init", "-b", "main"); git(cwd, "config", "user.email", "test@harny.local"); git(cwd, "config", "user.name", "Harny Test"); for (const file of files) writeFileSync(join(cwd, file), "initial\n"); git(cwd, "add", "."); git(cwd, "commit", "-m", "initial"); return cwd; }
function change(cwd: string, branch: string, files: string[]) { git(cwd, "checkout", "-b", branch); for (const file of files) writeFileSync(join(cwd, file), `${branch}\n`); git(cwd, "commit", "-am", `${branch} change`); git(cwd, "checkout", "main"); }

let failures = 0;
async function scenario(name: string, run: () => Promise<void>) { try { await run(); console.log(`PASS ${name}`); } catch (error) { console.log(`FAIL ${name}: ${(error as Error).message}`); failures++; } }

await scenario("sibling-branches", async () => { const cwd = repo(["alpha.txt"]); try { change(cwd, "harny/sibling", ["alpha.txt"]); writeFileSync(join(cwd, "alpha.txt"), "main\n"); git(cwd, "commit", "-am", "main change"); const siblings = await findSiblingBranches(cwd, "main"); if (!siblings.find((value) => value.branch === "harny/sibling")?.files.includes("alpha.txt")) throw new Error(JSON.stringify(siblings)); } finally { rmSync(cwd, { recursive: true, force: true }); } });
await scenario("filters-non-harness-branches", async () => { const cwd = repo(["shared.ts"]); try { change(cwd, "harny/managed", ["shared.ts"]); change(cwd, "feature/random", ["shared.ts"]); writeFileSync(join(cwd, "shared.ts"), "main\n"); git(cwd, "commit", "-am", "main change"); const names = (await findSiblingBranches(cwd, "main")).map((value) => value.branch); if (!names.includes("harny/managed") || names.includes("feature/random")) throw new Error(JSON.stringify(names)); } finally { rmSync(cwd, { recursive: true, force: true }); } });
await scenario("multiple-files", async () => { const files = ["a.ts", "b.ts", "c.ts"]; const cwd = repo(files); try { change(cwd, "harny/multi", files); for (const file of files) writeFileSync(join(cwd, file), "main\n"); git(cwd, "commit", "-am", "main change"); const result = (await findSiblingBranches(cwd, "main")).find((value) => value.branch === "harny/multi"); if (!result || files.some((file) => !result.files.includes(file))) throw new Error(JSON.stringify(result)); } finally { rmSync(cwd, { recursive: true, force: true }); } });

process.exit(failures ? 1 : 0);
