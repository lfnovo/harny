import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentProvider, AgentRequest, AgentResult, AgentSession } from "../providers/types.js";
import { AgentPausedError } from "../providers/types.js";
import { runNextFeatureDev } from "./featureDev.js";
import type { ForgeProvider, PullRequestArtifact, PullRequestSpec } from "../forge/types.js";
import { FilesystemRunStoreV3 } from "../state/v3/store.js";
import { V3FeatureRunPersistence } from "./persistence.js";
import { existsSync } from "node:fs";
import { answerWorkflow } from "./runtime.js";

async function makeRepo() {
  const cwd = await mkdtemp(join(tmpdir(), "harny-next-feature-"));
  const git = async (...args: string[]) => { const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); const code = await proc.exited; if (code) throw new Error(await new Response(proc.stderr).text()); return (await new Response(proc.stdout).text()).trim(); };
  await git("init", "-q"); await git("config", "user.email", "test@example.com"); await git("config", "user.name", "Test");
  await writeFile(join(cwd, "feature.txt"), "base\n"); await git("add", "."); await git("commit", "-qm", "base"); return { cwd, git };
}

async function v3(cwd: string, slug: string, workflow = "feature-dev") {
  const store = new FilesystemRunStoreV3(cwd, slug); const now = new Date().toISOString();
  await store.create({ schema_version: 3, run: { id: `run-${slug}`, task_slug: slug, workflow, status: "running", started_at: now, ended_at: null, ended_reason: null, pid: process.pid, parent_run_id: null }, origin: { prompt: "implement", workflow_source: workflow, cwd, host: "host", user: "user" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: `harny/${slug}`, worktree_path: null, reserved: true }, nodes: {}, artifacts: {}, changesets: {}, deliverables: [], pending_human: null });
  return { store, persistence: new V3FeatureRunPersistence(store) };
}

class FeatureProvider implements AgentProvider {
  id = "claude"; capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true };
  calls: string[] = []; validations = 0; developments = 0;
  constructor(private cwd: string, private options: { tasks?: number; validator?: ("pass" | "fail" | "blocked")[]; developerBlocked?: boolean; noChanges?: boolean; unauthorizedCommit?: boolean } = {}) {}
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.calls.push(request.phase ?? "agent");
    let output: unknown;
    if (request.phase === "planner") output = { summary: "feature", tasks: Array.from({ length: this.options.tasks ?? 1 }, (_, index) => ({ id: `t${index + 1}`, title: `Build ${index + 1}`, description: "Build it", acceptance: ["works"] })) };
    else if (request.phase === "developer") {
      this.developments++;
      if (!this.options.noChanges) await writeFile(join(this.cwd, request.taskId === "t1" ? "feature.txt" : `${request.taskId}.txt`), `version ${this.developments}\n`);
      if (this.options.unauthorizedCommit) { const proc = Bun.spawn(["git", "commit", "-am", "unauthorized"], { cwd: this.cwd, stdout: "ignore", stderr: "ignore" }); if (await proc.exited) throw new Error("test commit failed"); }
      output = this.options.developerBlocked
        ? { task_id: request.taskId, status: "blocked", summary: "blocked", commit_message: "", blocked_reason: "cannot proceed" }
        : { task_id: request.taskId, status: "done", summary: "done", commit_message: `feat: build ${request.taskId}` };
    } else {
      const verdict = this.options.validator?.[this.validations] ?? (++this.validations === 1 ? "fail" : "pass");
      if (this.options.validator) this.validations++;
      output = { verdict, reasons: verdict === "pass" ? ["verified"] : [verdict] };
    }
    return { output: request.schema.parse(output), session: { id: `${request.phase}-${this.calls.length}`, provider: this.id } };
  }
  async resume<T>(_session: AgentSession, request: AgentRequest<T>) { return this.run(request); }
}

test("next feature-dev retries, persists task state, validates and commits the same ChangeSet", async () => {
  const { cwd, git } = await makeRepo(); const { store, persistence } = await v3(cwd, "task"); const provider = new FeatureProvider(cwd);
  const result = await runNextFeatureDev({ provider, persistence, cwd, primaryCwd: cwd, taskSlug: "task", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("done");
  expect(provider.calls).toEqual(["planner", "developer", "validator", "developer", "validator"]);
  expect(await git("log", "-1", "--pretty=%s")).toBe("feat: build t1");
  expect(await readFile(join(cwd, "feature.txt"), "utf8")).toBe("version 2\n");
  const plan = (await store.load())!.artifacts.plan!.value as import("../types.js").Plan;
  expect(plan.status).toBe("done"); expect(plan.tasks[0]?.status).toBe("done"); expect(plan.tasks[0]?.attempts).toBe(2); expect(plan.tasks[0]?.commit_sha).toMatch(/^[0-9a-f]{40}$/);
});

test("next feature-dev succeeds with multiple tasks and persists each commit", async () => {
  const { cwd, git } = await makeRepo(); const { store, persistence } = await v3(cwd, "multi"); const provider = new FeatureProvider(cwd, { tasks: 2, validator: ["pass", "pass"] });
  const result = await runNextFeatureDev({ provider, persistence, cwd, primaryCwd: cwd, taskSlug: "multi", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("done"); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(3);
  const plan = (await store.load())!.artifacts.plan!.value as import("../types.js").Plan;
  expect(plan.tasks.map((task) => task.status)).toEqual(["done", "done"]); expect(plan.tasks.every((task) => Boolean(task.commit_sha))).toBe(true);
});

test("next feature-dev fails on developer blocked without validating or committing", async () => {
  const { cwd, git } = await makeRepo(); const { persistence } = await v3(cwd, "blocked"); const provider = new FeatureProvider(cwd, { developerBlocked: true });
  const result = await runNextFeatureDev({ provider, persistence, cwd, primaryCwd: cwd, taskSlug: "blocked", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("failed"); expect(provider.calls).toEqual(["planner", "developer"]); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(1);
});

test("next feature-dev fails when validator blocks", async () => {
  const { cwd, git } = await makeRepo(); const provider = new FeatureProvider(cwd, { validator: ["blocked"] });
  const result = await runNextFeatureDev({ provider, persistence: (await v3(cwd, "vblocked")).persistence, cwd, primaryCwd: cwd, taskSlug: "vblocked", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("failed"); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(1);
});

test("next feature-dev exhausts bounded validator retries", async () => {
  const { cwd, git } = await makeRepo(); const provider = new FeatureProvider(cwd, { validator: ["fail", "fail", "fail"] });
  const result = await runNextFeatureDev({ provider, persistence: (await v3(cwd, "exhausted")).persistence, cwd, primaryCwd: cwd, taskSlug: "exhausted", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("failed"); expect(provider.developments).toBe(3); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(1);
});

test("next feature-dev treats an empty ChangeSet as a successful no-op", async () => {
  const { cwd, git } = await makeRepo(); const provider = new FeatureProvider(cwd, { noChanges: true, validator: ["pass"] });
  const saved = await v3(cwd, "noop"); const result = await runNextFeatureDev({ provider, persistence: saved.persistence, cwd, primaryCwd: cwd, taskSlug: "noop", userPrompt: "verify", variant: "default" });
  expect(result.status).toBe("done"); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(1);
  const plan = (await saved.store.load())!.artifacts.plan!.value as import("../types.js").Plan; expect(plan.tasks[0]?.commit_sha).toBeNull();
});

test("feature-pr creates a draft PR only after commit and verifies its head", async () => {
  const { cwd, git } = await makeRepo(); const sha = async () => await git("rev-parse", "HEAD"); let created: PullRequestSpec | null = null;
  const forge: ForgeProvider = { id: "github", async findPullRequest() { return null; }, async createPullRequest(spec) { created = spec; return { repository: spec.repository, number: 9, url: "https://github.com/o/r/pull/9", base: spec.base, head: spec.head, headSha: spec.expectedHeadSha, draft: spec.draft }; }, async updatePullRequest(_pr: PullRequestArtifact, _spec: PullRequestSpec) { throw new Error("not expected"); } };
  const result = await runNextFeatureDev({ provider: new FeatureProvider(cwd, { validator: ["pass"] }), persistence: (await v3(cwd, "with-pr", "feature-pr")).persistence, cwd, primaryCwd: cwd, taskSlug: "with-pr", userPrompt: "implement", variant: "default", workflowId: "feature-pr", forge,
    prGit: async (args) => args[0] === "remote" ? "git@github.com:o/r.git" : args[0] === "ls-remote" ? `${await sha()}\trefs/heads/harny/with-pr` : "",
  });
  expect(result.status).toBe("done"); expect(created).not.toBeNull(); expect(created!.draft).toBe(true); expect(created!.head).toBe("harny/with-pr"); expect(created!.expectedHeadSha).toBe(await sha());
});

test("next feature-dev uses run.json v3 as the sole authoritative state", async () => {
  const { cwd } = await makeRepo(); const store = new FilesystemRunStoreV3(cwd, "v3"); const now = new Date().toISOString();
  await store.create({ schema_version: 3, run: { id: "run-v3", task_slug: "v3", workflow: "feature-dev", status: "running", started_at: now, ended_at: null, ended_reason: null, pid: process.pid, parent_run_id: null }, origin: { prompt: "implement", workflow_source: "bundled", cwd, host: "host", user: "user" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "harny/v3", worktree_path: null, reserved: true }, nodes: {}, artifacts: {}, changesets: {}, deliverables: [], pending_human: null });
  const result = await runNextFeatureDev({ provider: new FeatureProvider(cwd, { validator: ["pass"] }), persistence: new V3FeatureRunPersistence(store), cwd, primaryCwd: cwd, taskSlug: "v3", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("done"); const persisted = await store.load(); expect((persisted?.artifacts.plan?.value as { status?: string }).status).toBe("done");
  expect(Object.values(persisted?.changesets ?? {})[0]?.validated_by).toBeTruthy(); expect(Object.values(persisted?.changesets ?? {})[0]?.committed_sha).toMatch(/^[0-9a-f]{40}$/);
  expect(persisted?.artifacts["runtime-snapshot"]).toBeDefined(); expect(existsSync(join(cwd, ".harny/v3/state.json"))).toBe(false); expect(existsSync(join(cwd, ".harny/v3/plan.json"))).toBe(false);
});

test("developer cannot smuggle an unauthorized commit into branch history", async () => {
  const { cwd, git } = await makeRepo(); const result = await runNextFeatureDev({ provider: new FeatureProvider(cwd, { unauthorizedCommit: true }), persistence: (await v3(cwd, "history")).persistence, cwd, primaryCwd: cwd, taskSlug: "history", userPrompt: "implement", variant: "default" });
  expect(result.status).toBe("failed"); expect(result.error).toContain("changed git history"); expect(Number(await git("rev-list", "--count", "HEAD"))).toBe(1);
});

test("provider question parks and resumes the same provider session", async () => {
  const { cwd } = await makeRepo(); const store = new FilesystemRunStoreV3(cwd, "provider-pause"); const now = new Date().toISOString();
  await store.create({ schema_version: 3, run: { id: "pause", task_slug: "provider-pause", workflow: "feature-dev", status: "running", started_at: now, ended_at: null, ended_reason: null, pid: 1, parent_run_id: null }, origin: { prompt: "implement", workflow_source: "bundled", cwd, host: "h", user: "u" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "harny/provider-pause", worktree_path: null, reserved: true }, nodes: {}, artifacts: {}, changesets: {}, deliverables: [], pending_human: null });
  class PausingProvider extends FeatureProvider { resumed: AgentSession | null = null; first = true; override async run<T>(request: AgentRequest<T>) { if (request.phase === "planner" && this.first) { this.first = false; throw new AgentPausedError({ id: "planner-session", provider: "claude" }, "Which scope?"); } return await super.run(request); } override async resume<T>(session: AgentSession, request: AgentRequest<T>) { this.resumed = session; return await super.run(request); } }
  const provider = new PausingProvider(cwd, { validator: ["pass"] }); const persistence = new V3FeatureRunPersistence(store);
  expect((await runNextFeatureDev({ provider, persistence, cwd, primaryCwd: cwd, taskSlug: "provider-pause", userPrompt: "implement", variant: "default", mode: "async" })).status).toBe("waiting_human");
  expect((await store.load())?.pending_human?.session?.id).toBe("planner-session"); await answerWorkflow(persistence, "small");
  expect((await runNextFeatureDev({ provider, persistence, cwd, primaryCwd: cwd, taskSlug: "provider-pause", userPrompt: "implement", variant: "default", mode: "async" })).status).toBe("done"); expect(provider.resumed?.id).toBe("planner-session");
});
