/**
 * Shared helpers for Surreal probes.
 * Spawns `surreal start` as a detached subprocess on a random port,
 * waits until WS is reachable, and gives back a connected SDK client.
 */

import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Surreal } from "surrealdb";

export type SurrealHandle = {
  db: Surreal;
  url: string;
  port: number;
  proc: Subprocess;
  dataDir: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
  stop: () => Promise<void>;
};

let portCounter = 17000 + Math.floor(Math.random() * 1000);
function nextPort(): number {
  return portCounter++;
}

export async function startSurreal(opts: {
  storage?: "memory" | "surrealkv";
  namespace?: string;
  database?: string;
  user?: string;
  pass?: string;
  quiet?: boolean;
} = {}): Promise<SurrealHandle> {
  const port = nextPort();
  const user = opts.user ?? "root";
  const pass = opts.pass ?? "root";
  const namespace = opts.namespace ?? "test";
  const database = opts.database ?? "test";
  const storage = opts.storage ?? "memory";

  const dataDir = await mkdtemp(join(tmpdir(), "harness-surreal-"));
  const path = storage === "memory" ? "memory" : `surrealkv://${dataDir}/db`;

  const proc = spawn({
    cmd: [
      "surreal",
      "start",
      "--no-banner",
      "--bind",
      `127.0.0.1:${port}`,
      "--user",
      user,
      "--pass",
      pass,
      path,
    ],
    stdout: opts.quiet ? "ignore" : "pipe",
    stderr: opts.quiet ? "ignore" : "pipe",
  });

  // Wait for the WS endpoint to come up.
  const url = `ws://127.0.0.1:${port}/rpc`;
  const deadline = Date.now() + 5000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const probe = new Surreal();
      await probe.connect(url);
      await probe.signin({ username: user, password: pass });
      await probe.use({ namespace, database });
      // Success — close and return a fresh handle.
      await probe.close();
      break;
    } catch (e) {
      lastErr = e;
      await Bun.sleep(60);
    }
  }
  if (Date.now() >= deadline) {
    proc.kill();
    throw new Error(`surreal did not become ready within 5s: ${lastErr}`);
  }

  const db = new Surreal();
  await db.connect(url);
  await db.signin({ username: user, password: pass });
  await db.use({ namespace, database });

  const stop = async () => {
    try {
      await db.close();
    } catch {}
    proc.kill();
    await proc.exited;
    if (storage !== "memory") {
      await rm(dataDir, { recursive: true, force: true });
    }
  };

  return {
    db,
    url,
    port,
    proc,
    dataDir,
    user,
    pass,
    namespace,
    database,
    stop,
  };
}

export function ts(): string {
  return new Date().toISOString();
}

export function log(label: string, msg: string, data?: unknown): void {
  const prefix = `[${ts()}] [${label}]`;
  if (data !== undefined) {
    console.log(prefix, msg, JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, msg);
  }
}
