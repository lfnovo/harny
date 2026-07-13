import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runHarness } from "../orchestrator.js";
import { tmpGitRepo } from "../testing/index.js";
import type { AgentProvider, AgentRequest, AgentResult } from "../providers/types.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await (cleanups.pop()!)().catch(() => {}); });

class ScenarioProvider implements AgentProvider {
  id = "claude"; connectionFingerprint = "claude:test"; capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true };
  developerCalls = 0; validatorCalls = 0;
  validatorScratchPolicies: boolean[] = [];
  constructor(private readonly options: { tasks?: number; validator?: Array<"pass" | "fail" | "blocked">; finalValidator?: "pass" | "fail"; finalMutates?: boolean; developerBlocked?: boolean; noOp?: boolean; generated?: boolean; writeScratch?: boolean } = {}) {}
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    let output: unknown;
    if (request.phase === "validator" || request.phase === "final_validator") this.validatorScratchPolicies.push(Boolean(request.env?.TMPDIR && request.systemPrompt?.includes("RUNTIME SCRATCH POLICY") && request.systemPrompt.includes(request.env.TMPDIR)));
    if (request.phase === "planner") output = { summary: "plan", tasks: Array.from({ length: this.options.tasks ?? 1 }, (_, index) => ({ id: `t${index + 1}`, title: `Task ${index + 1}`, description: "Implement", acceptance: ["works"] })) };
    else if (request.phase === "developer") { this.developerCalls++; if (!this.options.noOp && !this.options.developerBlocked) await writeFile(join(request.cwd, `${request.taskId}.txt`), `attempt ${this.developerCalls}\n`); if (this.options.generated) { await mkdir(join(request.cwd, "node_modules/pkg"), { recursive: true }); await writeFile(join(request.cwd, "node_modules/pkg/index.js"), "generated\n"); } output = this.options.developerBlocked ? { status: "blocked", summary: "blocked", commit_message: "", blocked_reason: "cannot proceed" } : { status: "done", summary: "done", commit_message: `feat: ${request.taskId}` }; }
    else if (request.phase === "final_validator") { if (this.options.writeScratch) await writeFile(join(request.env!.TMPDIR!, "probe.txt"), "scratch\n"); if (this.options.finalMutates) await writeFile(join(request.cwd, "unauthorized.txt"), "changed\n"); const verdict = this.options.finalValidator ?? "pass"; output = { verdict, reasons: [`final: ${verdict}`] }; }
    else { if (this.options.writeScratch) await writeFile(join(request.env!.TMPDIR!, "probe.txt"), "scratch\n"); const verdict = this.options.validator?.[this.validatorCalls++] ?? "pass"; output = { verdict, reasons: [`AC1: ${verdict}`] }; }
    return { output: request.schema.parse(output), session: { id: `${request.phase}-${this.developerCalls}-${this.validatorCalls}`, provider: this.id, connectionFingerprint: this.connectionFingerprint } };
  }
}

async function run(provider: ScenarioProvider, slug: string) { const repo = await tmpGitRepo({ seed: {} }); cleanups.push(repo.cleanup); return { repo, result: await runHarness({ cwd: repo.path, userPrompt: "implement", taskSlug: slug, isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: provider }) }; }

test("validator failure returns to developer within the configured bound", async () => { const provider = new ScenarioProvider({ validator: ["fail", "pass"] }); const { result } = await run(provider, "retry"); expect(result.status).toBe("done"); expect(provider.developerCalls).toBe(2); expect(provider.validatorCalls).toBe(2); expect(result.state?.execution.nodes.tasks?.steps?.["0.validator"]?.attempts).toBe(2); expect(Object.keys(result.state?.changesets ?? {})).toHaveLength(2); });
test("developer and validator blocked are terminal and never commit", async () => { const developer = await run(new ScenarioProvider({ developerBlocked: true }), "dev-blocked"); expect(developer.result.status).toBe("failed"); expect(developer.result.state?.execution.nodes.tasks?.steps?.["0.commit"]).toBeUndefined(); const validator = await run(new ScenarioProvider({ validator: ["blocked"] }), "validator-blocked"); expect(validator.result.status).toBe("failed"); expect(validator.result.state?.execution.nodes.tasks?.steps?.["0.commit"]).toBeUndefined(); });
test("multiple tasks commit sequentially and an empty ChangeSet is a successful no-op", async () => { const multiple = await run(new ScenarioProvider({ tasks: 2 }), "multi"); expect(multiple.result.status).toBe("done"); expect(multiple.result.state?.execution.nodes.tasks?.steps?.["1.commit"]?.status).toBe("completed"); const noop = await run(new ScenarioProvider({ noOp: true }), "noop"); expect(noop.result.status).toBe("done"); expect((noop.result.state?.execution.nodes.tasks?.steps?.["0.commit"]?.output as { sha?: string | null }).sha).toBeNull(); });
test("bounded validation exhaustion fails without committing", async () => { const provider = new ScenarioProvider({ validator: ["fail", "fail", "fail"] }); const { result } = await run(provider, "exhausted"); expect(result.status).toBe("failed"); expect(provider.developerCalls).toBe(3); expect(result.state?.execution.nodes.tasks?.steps?.["0.commit"]).toBeUndefined(); });
test("task identity remains scheduler-owned and is not duplicated in developer output", async () => { const { result } = await run(new ScenarioProvider(), "task-identity"); expect(result.status).toBe("done"); const verdict = result.state?.execution.nodes.tasks?.steps?.["0.developer"]?.output as { verdict?: Record<string, unknown> }; expect(verdict.verdict).not.toHaveProperty("task_id"); });
test("protected generated paths fail before validation or commit", async () => { const provider = new ScenarioProvider({ generated: true }); const { result } = await run(provider, "generated"); expect(result.status).toBe("failed"); expect(provider.validatorCalls).toBe(0); expect(result.state?.run.ended_reason).toContain("protected paths"); expect(result.state?.execution.nodes.tasks?.steps?.["0.commit"]).toBeUndefined(); });
test("final validation prevents a false successful terminal state", async () => { const { result } = await run(new ScenarioProvider({ finalValidator: "fail" }), "final-fail"); expect(result.status).toBe("failed"); expect(result.state?.execution.nodes.tasks?.steps?.["0.commit"]?.status).toBe("completed"); expect(result.state?.execution.nodes.final_validator?.status).toBe("failed"); });
test("final validation cannot mutate the committed repository state", async () => { const { result } = await run(new ScenarioProvider({ finalMutates: true }), "final-mutates"); expect(result.status).toBe("failed"); expect(result.state?.execution.nodes.final_validator?.error).toContain("ChangeSet changed after validation"); });
test("validator scratch is supplied to providers and removed after each attempt", async () => { const provider = new ScenarioProvider({ writeScratch: true }); const { repo, result } = await run(provider, "scratch"); expect(result.status).toBe("done"); expect(provider.validatorScratchPolicies).toEqual([true, true]); expect(existsSync(join(repo.path, ".harny/tmp/validator-0-1"))).toBe(false); expect(existsSync(join(repo.path, ".harny/tmp/validator-final-1"))).toBe(false); });
