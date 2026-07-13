import { findRun } from "../harness/state/runDiscovery.js";
import { RunStore } from "../harness/state/runStore.js";
import { toRunView } from "../harness/state/runView.js";
import type { UsageTotals } from "../harness/state/usage.js";

export async function handleShow(cmd: { kind: "show"; runId: string; tail?: boolean; since?: string }): Promise<void> {
  const run = await findRun(cmd.runId); if (!run) { console.error(`Run not found: ${cmd.runId}`); process.exit(1); }
  const store = new RunStore(run.workspace.primary_cwd, run.run.task_slug); const events = await store.events();
  if (cmd.tail) { const cutoff = cmd.since === undefined ? null : Date.now() - parseSince(cmd.since) * 1000; for (const event of events) if (cutoff === null || Date.parse(event.at) >= cutoff) console.log(JSON.stringify(event)); return; }
  const view = toRunView(run, events);
  console.log(`Run:       ${view.run_id}`); console.log(`Schema:    v4`); console.log(`Workflow:  ${view.origin.workflow}`); console.log(`Status:    ${view.lifecycle.status}`); console.log(`CWD:       ${view.environment.cwd}`); console.log(`Branch:    ${view.environment.branch}`); console.log(`TaskSlug:  ${view.origin.task_slug}`); console.log(`Started:   ${view.origin.started_at}`);
  if (view.lifecycle.ended_at) console.log(`Ended:     ${view.lifecycle.ended_at} (${view.lifecycle.ended_reason ?? ""})`); if (view.environment.worktree_path) console.log(`Worktree:  ${view.environment.worktree_path}`);
  if (hasUsage(view.usage.total)) {
    console.log(`Usage:     ${formatUsage(view.usage.total)}`);
    for (const [provider, usage] of Object.entries(view.usage.by_provider)) console.log(`  ${provider.padEnd(10)} ${formatUsage(usage)}`);
  }
  if (view.pending_question) console.log(`\nPending question:\n  ${view.pending_question.prompt}`);
  if (view.phases.length) { console.log("\nNodes:"); for (const phase of view.phases) { console.log(`  ${phase.name} (${phase.status}, attempt ${phase.attempt})${phase.usage ? ` — ${formatUsage(phase.usage)}` : ""}`); for (const attempt of phase.attempts_detail) if (attempt.usage && (phase.attempts_detail.length > 1 || attempt.usage.models)) { console.log(`    attempt ${attempt.number} (${attempt.status}) — ${formatAttempt(attempt.usage)}`); for (const [model, usage] of Object.entries(attempt.usage.models ?? {})) console.log(`      ${model} — ${formatMetrics(usage)}`); } } }
}

function parseSince(value: string): number { if (/^\d+$/.test(value)) return Number(value); const match = /^(\d+)(s|m|h)$/.exec(value); if (!match) throw new Error(`--since: unrecognized duration "${value}"`); const amount = Number(match[1]); return match[2] === "h" ? amount * 3600 : match[2] === "m" ? amount * 60 : amount; }
function hasUsage(value: UsageTotals): boolean { return value.input_tokens + value.output_tokens + value.cache_read_input_tokens + value.cache_creation_input_tokens + value.reasoning_output_tokens > 0 || value.cost_usd !== null; }
function formatUsage(value: UsageTotals): string { const parts = [`in ${number(value.input_tokens)}`, `out ${number(value.output_tokens)}`]; if (value.cache_read_input_tokens) parts.push(`cache-read ${number(value.cache_read_input_tokens)}`); if (value.cache_creation_input_tokens) parts.push(`cache-write ${number(value.cache_creation_input_tokens)}`); if (value.reasoning_output_tokens) parts.push(`reasoning ${number(value.reasoning_output_tokens)}`); if (value.cost_usd !== null) parts.push(`$${value.cost_usd.toFixed(4)}${value.cost_coverage === "partial" ? " reported (partial)" : " reported"}`); return parts.join(" · "); }
function formatAttempt(value: NonNullable<ReturnType<typeof toRunView>["phases"][number]["attempts_detail"][number]["usage"]>): string { return [`${value.provider}${value.model ? `/${value.model}` : ""}`, formatMetrics(value)].join(" · "); }
function formatMetrics(value: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; reasoningOutputTokens?: number; costUsd?: number }): string { const parts = [`in ${number(value.inputTokens)}`, `out ${number(value.outputTokens)}`]; if (value.cacheReadInputTokens) parts.push(`cache-read ${number(value.cacheReadInputTokens)}`); if (value.cacheCreationInputTokens) parts.push(`cache-write ${number(value.cacheCreationInputTokens)}`); if (value.reasoningOutputTokens) parts.push(`reasoning ${number(value.reasoningOutputTokens)}`); if (value.costUsd !== undefined) parts.push(`$${value.costUsd.toFixed(4)} reported`); return parts.join(" · "); }
function number(value: number): string { return value.toLocaleString("en-US"); }
