/**
 * Phoenix observability — opt-in via HARNESS_PHOENIX_URL.
 *
 * When the env var is set, registers the Arize phoenix-otel tracer provider
 * and instruments the Claude Agent SDK via OpenInference, so each `query()`
 * call emits AGENT/TOOL spans Phoenix renders natively. When the env var
 * is absent, returns the original SDK `query` and emits no telemetry.
 *
 * Two gotchas this module hides:
 *   1. ESM namespace freeze — `manuallyInstrument(sdkNamespace)` from Arize
 *      tries to mutate the namespace; ESM forbids it. We shallow-copy into
 *      a mutable object, instrument the copy, and expose the patched query.
 *   2. Idempotent registration — `register()` mutates the global tracer
 *      provider. We cache the result so repeated calls in one process (e.g.
 *      orchestrator + sessionRecorder both invoke setupPhoenix) don't
 *      re-register.
 */

import * as ClaudeAgentSDKNS from "@anthropic-ai/claude-agent-sdk";
import { basename } from "node:path";
import { register, getDefaultSpanProcessor } from "@arizeai/phoenix-otel";
import { ClaudeAgentSDKInstrumentation } from "@arizeai/openinference-instrumentation-claude-agent-sdk";
import {
  trace,
  context,
  createContextKey,
  type Span,
  type Context,
} from "@opentelemetry/api";

/** Context key set by sessionRecorder around each query() call so the rename
 *  span processor can flatten "ClaudeAgent.query" → "harness.<phase>". */
const PHASE_CONTEXT_KEY = createContextKey("harness.phase");

/** Custom span processor: when a "ClaudeAgent.query" span starts inside a
 *  phase context, rename it to "harness.<phase>". This lets us collapse the
 *  double-wrapper (our CHAIN + their AGENT) into a single AGENT span the user
 *  cares about, while still letting OpenInference handle all the heavy
 *  lifting around tool span emission. */
class RenameClaudeAgentSpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    // The Span interface from @opentelemetry/api doesn't expose `name`, but
    // the SDK Span class does. Cast to a structural type to read it.
    const spanWithName = span as unknown as { name: string; updateName(n: string): void };
    if (spanWithName.name !== "ClaudeAgent.query") return;
    const phase = parentContext.getValue(PHASE_CONTEXT_KEY);
    if (typeof phase === "string" && phase.length > 0) {
      spanWithName.updateName(`harness.${phase}`);
    }
  }
  onEnd(): void {}
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export type PhoenixSetup = {
  /** SDK query function — instrumented if Phoenix enabled, raw otherwise. */
  query: typeof ClaudeAgentSDKNS.query;
  /** True if Phoenix is enabled and traces will export. */
  enabled: boolean;
  /** Phoenix base URL (so callers can build deep links). undefined when disabled. */
  url: string | undefined;
  /** Phoenix project name used. undefined when disabled. */
  projectName: string | undefined;
};

let cached: PhoenixSetup | null = null;
/** Captured so we can call forceFlush before process exits — otherwise the
 *  BatchSpanProcessor may drop the run span (and the last phase span) on the
 *  way out. */
let tracerProvider: { forceFlush?: () => Promise<void> } | null = null;

/**
 * Set up Phoenix instrumentation for the given run. Idempotent within a
 * process. The first call locks in the project name; subsequent calls return
 * the cached setup regardless of arguments (acceptable for our use — one
 * process runs one workflow against one cwd).
 *
 * The Phoenix project name is the basename of the assistant's cwd (per user
 * decision — keeps traces grouped by repo, not by workflow). Falls back to
 * "harness" if cwd is missing or its basename is empty.
 */
export function setupPhoenix(args: {
  workflowId: string;
  runId?: string;
  taskSlug?: string;
  cwd?: string;
}): PhoenixSetup {
  const url = process.env.HARNESS_PHOENIX_URL;
  if (!url) {
    return {
      query: ClaudeAgentSDKNS.query,
      enabled: false,
      url: undefined,
      projectName: undefined,
    };
  }

  if (cached) return cached;

  // Resource attrs for filtering in Phoenix UI. Set BEFORE register() so the
  // tracer provider picks them up.
  const attrs: string[] = [`harness.workflow=${args.workflowId}`];
  if (args.runId) attrs.push(`harness.run_id=${args.runId}`);
  if (args.taskSlug) attrs.push(`harness.task_slug=${args.taskSlug}`);
  const existing = process.env.OTEL_RESOURCE_ATTRIBUTES ?? "";
  process.env.OTEL_RESOURCE_ATTRIBUTES = existing
    ? `${existing},${attrs.join(",")}`
    : attrs.join(",");

  const projectName =
    (args.cwd && basename(args.cwd).trim()) || "harness";
  // OTel SDK 2.x removed `addSpanProcessor`; processors must be passed at
  // construction time via register's spanProcessors. Build the default OTLP
  // exporter processor ourselves + add our rename processor alongside it.
  const defaultProcessor = getDefaultSpanProcessor({ url, batch: true });
  const renameProcessor = new RenameClaudeAgentSpanProcessor();
  const provider = register({
    projectName,
    url,
    spanProcessors: [defaultProcessor, renameProcessor as never],
  }) as unknown as {
    forceFlush?: () => Promise<void>;
  };
  tracerProvider = provider;

  // ESM namespace freeze workaround. See module-level comment.
  const mutable: Record<string, unknown> = { ...ClaudeAgentSDKNS };
  const instrumentation = new ClaudeAgentSDKInstrumentation();
  instrumentation.manuallyInstrument(mutable as never);

  cached = {
    query: mutable.query as typeof ClaudeAgentSDKNS.query,
    enabled: true,
    url,
    projectName,
  };
  return cached;
}

/**
 * Run an async function inside a TOP-LEVEL OTel span we own. Used to wrap an
 * entire harness run (including all phases). The SDK's spans created inside
 * this scope inherit our trace_id, so a single harness run = one trace in
 * Phoenix.
 *
 * Span name is the task slug (the "feature name" from --task), so traces
 * appear as e.g. "calc-module" in Phoenix's trace list. Tagged with
 * openinference.span.kind=AGENT.
 *
 * Forces a flush of pending spans on exit so the run span (and the last
 * phase's spans) actually make it to Phoenix before the process dies.
 *
 * When Phoenix is disabled, runs the body directly with no overhead.
 */
export async function withRunSpan<T>(
  setup: PhoenixSetup,
  taskSlug: string,
  attrs: Record<string, string | number>,
  body: (traceId: string | undefined) => Promise<T>,
): Promise<T> {
  if (!setup.enabled) return body(undefined);
  const tracer = trace.getTracer("harness");
  const span: Span = tracer.startSpan(taskSlug);
  span.setAttribute("openinference.span.kind", "AGENT");
  for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
  const traceId = span.spanContext().traceId;
  try {
    return await context.with(trace.setSpan(context.active(), span), () =>
      body(traceId),
    );
  } finally {
    span.end();
    // Wait for pending spans (incl. our run span) to actually flush before
    // the caller returns and the process potentially exits. Bounded by the
    // exporter's own timeout; failure is silent (non-fatal).
    try {
      if (tracerProvider?.forceFlush) await tracerProvider.forceFlush();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Run an async function with a phase name attached to the OTel context, so
 * the rename processor can collapse "ClaudeAgent.query" spans into
 * "harness.<phase>" spans. No new span is created — the SDK's AGENT span
 * IS the phase span (just renamed). When Phoenix is disabled, runs the body
 * directly.
 */
export async function withPhaseContext<T>(
  setup: PhoenixSetup,
  phaseName: string,
  body: () => Promise<T>,
): Promise<T> {
  if (!setup.enabled) return body();
  const ctx = context.active().setValue(PHASE_CONTEXT_KEY, phaseName);
  return await context.with(ctx, body);
}

/**
 * Build a Phoenix UI URL that filters to a specific trace_id within a project.
 * Returns undefined if Phoenix isn't enabled. Used by the viewer to render
 * "Open in Phoenix" deep links.
 */
export function phoenixTraceUrl(
  setup: PhoenixSetup,
  traceId: string,
): string | undefined {
  if (!setup.enabled || !setup.url || !setup.projectName) return undefined;
  // Phoenix UI route is /projects/<projectName>/traces/<traceId>. The base
  // URL might or might not have a trailing slash; normalize.
  const base = setup.url.replace(/\/+$/, "");
  return `${base}/projects/${encodeURIComponent(setup.projectName)}/traces/${traceId}`;
}
