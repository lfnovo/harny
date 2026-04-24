import { findRun, statePathFor } from "../harness/state/filesystem.js";
import type { AskUserQuestionItem } from "../harness/askUser.js";
import type { RunnerContext } from "./context.js";

export async function handleShow(
  cmd: { kind: "show"; runId: string; tail?: boolean; since?: string },
  ctx: RunnerContext,
): Promise<void> {
  const run = await findRun(ctx.searchCwds, cmd.runId);
  if (!run) { console.error(`Run not found: ${cmd.runId}`); process.exit(1); }

  if (cmd.tail) {
    const sfp = statePathFor(run.environment.cwd, run.origin.task_slug);
    const { tailRun, parseSinceArg } = await import("../harness/transcripts/tail.js");
    const sinceSeconds = cmd.since !== undefined ? parseSinceArg(cmd.since) : undefined;
    await tailRun(sfp, sinceSeconds);
    return;
  }

  console.log(`Run:       ${run.run_id}`);
  console.log(`Workflow:  ${run.origin.workflow}`);
  console.log(`Status:    ${run.lifecycle.status}`);
  console.log(`CWD:       ${run.environment.cwd}`);
  console.log(`Branch:    ${run.environment.branch}`);
  console.log(`TaskSlug:  ${run.origin.task_slug}`);
  console.log(`Started:   ${run.origin.started_at}`);
  if (run.lifecycle.ended_at)
    console.log(`Ended:     ${run.lifecycle.ended_at} (${run.lifecycle.ended_reason})`);
  if (run.environment.worktree_path) console.log(`Worktree:  ${run.environment.worktree_path}`);

  const pq = run.pending_question;
  if (pq) {
    if (pq.kind === "ask_user_question_batch" && pq.options) {
      const questions = pq.options as AskUserQuestionItem[];
      console.log(`\nPending AskUserQuestion batch (${pq.id.slice(0, 8)}, ${questions.length} question${questions.length === 1 ? "" : "s"}):`);
      questions.forEach((qq, qi) => {
        const head = qq.header ? `[${qq.header}] ` : "";
        console.log(`  Q${qi + 1}: ${head}${qq.question}`);
        qq.options.forEach((o, oi) => {
          const desc = o.description ? ` — ${o.description}` : "";
          console.log(`      ${oi + 1}. ${o.label}${desc}`);
        });
        if (qq.multiSelect) console.log(`      (multiSelect)`);
      });
    } else {
      console.log(`\nPending question (${pq.id.slice(0, 8)}):`);
      console.log(`  ${pq.prompt}`);
      if (pq.options) {
        const opts = pq.options as string[];
        opts.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
      }
    }
    console.log(`\nEngine workflows do not yet support resume. To discard the parked run: harny clean ${run.origin.task_slug}`);
  }

  const recent = run.history.slice(-20);
  if (recent.length > 0) {
    console.log(`\nLast ${recent.length} events:`);
    for (const e of recent) {
      if ("kind" in e && (e as Record<string, unknown>)["kind"] === "human_review") {
        const hr = e as { at: string; kind: string; state_path: string };
        console.log(`  [${hr.at}] human_review / ${hr.state_path}`);
      } else {
        const le = e as { at: string; phase: string; event: string };
        console.log(`  [${le.at}] ${le.phase} / ${le.event}`);
      }
    }
  }

  if (run.phases.length > 0) {
    console.log(`\nPhases:`);
    for (let i = 0; i < run.phases.length; i++) {
      const phase = run.phases[i]!;
      const next = run.phases[i + 1];
      const commitSkipped = phase.name === "developer" && next?.name === "committing" && next.no_op === true;
      const verdict = phase.verdict ? ` → ${phase.verdict.slice(0, 40)}` : "";
      const noop = phase.no_op ? " [no-op]" : "";
      const suffix = commitSkipped ? " [commit skipped — no-op]" : noop;
      console.log(`  ${phase.name} #${phase.attempt} (${phase.status})${verdict}${suffix}`);
    }
  }
}
