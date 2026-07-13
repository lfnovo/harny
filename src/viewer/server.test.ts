import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { RunStore } from "../harness/state/runStore.js";
import type { RunSnapshot } from "../harness/state/runSchema.js";
import { setRegistryDirForTesting, writePointer } from "../harness/state/registry.js";
import { TranscriptStore } from "../harness/transcripts/store.js";
import { startViewer } from "./server.js";

let root = "";
let stop: (() => void) | undefined;
afterEach(async () => {
  stop?.(); stop = undefined;
  setRegistryDirForTesting(null);
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function snapshot(cwd: string): RunSnapshot {
  return {
    schema_version: 4,
    run: { id: "run-viewer", task_slug: "viewer-task", workflow: "test", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null },
    origin: { prompt: "show the transcript", workflow_source: "test", cwd, host: "host", user: "user" },
    workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "main", worktree_path: null, reserved: true },
    inputs: {},
    execution: { workflow: "test", status: "running", nodes: { agent: { id: "agent", status: "running", attempts: 1, attemptHistory: [{ number: 1, status: "running", startedAt: "2026-01-01T00:00:00.000Z" }] } } },
    changesets: {},
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate viewer test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("viewer exposes transcript availability and incremental, attempt-scoped pages", async () => {
  root = await mkdtemp(join(tmpdir(), "harny-viewer-transcript-"));
  setRegistryDirForTesting(join(root, "registry"));
  const run = snapshot(root);
  await new RunStore(root, run.run.task_slug).create(run);
  await writePointer(run);
  const transcripts = new TranscriptStore(root, run.run.task_slug);
  await transcripts.append({ instanceId: "agent", attempt: 1 }, "codex", { type: "reasoning", text: "first" });
  await transcripts.append({ instanceId: "agent", attempt: 1 }, "codex", { type: "message", role: "assistant", text: "second" });

  const viewer = await startViewer({ port: await availablePort() }); stop = viewer.stop;
  const cwdHash = Buffer.from(root).toString("base64url");
  const detail = await fetch(`${viewer.url}/api/runs/${cwdHash}/viewer-task`).then((response) => response.json());
  expect(detail.state.phases[0].attempts_detail[0].transcript_available).toBe(true);

  const firstResponse = await fetch(`${viewer.url}/api/runs/${cwdHash}/viewer-task/transcripts?instance=agent&attempt=1&after=0&limit=1`);
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first).toMatchObject({ next_after: 1, complete: false, events: [{ seq: 1, provider: "codex", event: { type: "reasoning", text: "first" } }] });
  const second = await fetch(`${viewer.url}/api/runs/${cwdHash}/viewer-task/transcripts?instance=agent&attempt=1&after=${first.next_after}&limit=10`).then((response) => response.json());
  expect(second).toMatchObject({ next_after: 2, events: [{ seq: 2, event: { type: "message", text: "second" } }] });

  expect((await fetch(`${viewer.url}/api/runs/${cwdHash}/viewer-task/transcripts?instance=unknown&attempt=1`)).status).toBe(404);
  expect((await fetch(`${viewer.url}/api/runs/${cwdHash}/viewer-task/transcripts?instance=../agent&attempt=1`)).status).toBe(404);
});
