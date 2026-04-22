/**
 * Probe 7 — Latency + overhead bench (informational, no pass/fail).
 *
 * Measures:
 *   A. surreal subprocess boot to first responsive WS
 *   B. live query notification end-to-end latency (CREATE → subscriber callback)
 *   C. SurrealSessionStore.append() per-batch overhead at three batch sizes
 *
 * No model API calls — pure infra timing. Numbers go into FINDINGS.md so we
 * can decide whether the runtime cost is acceptable for hot paths.
 */

import { Surreal, Table } from "surrealdb";
import { startSurreal, log } from "./_helpers.js";
import { SurrealSessionStore, SCHEMA } from "./SurrealSessionStore.js";

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx]!;
}

function fmt(arr: number[]): string {
  if (arr.length === 0) return "n=0";
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return `n=${arr.length} min=${min.toFixed(2)} mean=${mean.toFixed(2)} p50=${pct(arr, 0.5).toFixed(2)} p95=${pct(arr, 0.95).toFixed(2)} max=${max.toFixed(2)}`;
}

async function benchBoot(): Promise<number> {
  const t0 = performance.now();
  const h = await startSurreal({ storage: "memory", quiet: true });
  const elapsed = performance.now() - t0;
  await h.stop();
  return elapsed;
}

async function benchLiveLatency(samples: number): Promise<number[]> {
  const h = await startSurreal({ storage: "memory", quiet: true });
  const T = new Table("bench_live");
  const subscriber = new Surreal();
  await subscriber.connect(h.url);
  await subscriber.signin({ username: h.user, password: h.pass });
  await subscriber.use({ namespace: h.namespace, database: h.database });
  const live = await subscriber.live(T);

  const arrivedAt = new Map<string, number>();
  const unsub = live.subscribe((msg) => {
    arrivedAt.set(String(msg.recordId), performance.now());
  });

  await Bun.sleep(80);
  const sentAt = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const t = performance.now();
    const created = await h.db.create(T).content({ i, ts: t });
    const row = Array.isArray(created) ? created[0] : created;
    const id = String((row as { id: unknown }).id);
    sentAt.set(id, t);
    await Bun.sleep(20);
  }
  await Bun.sleep(300);

  unsub();
  await live.kill();
  await subscriber.close();
  await h.stop();

  const latencies: number[] = [];
  for (const [id, sent] of sentAt) {
    const arr = arrivedAt.get(id);
    if (arr !== undefined) latencies.push(arr - sent);
  }
  return latencies;
}

async function benchAppend(): Promise<{ b1: number[]; b10: number[]; b100: number[] }> {
  const h = await startSurreal({ storage: "memory", quiet: true });
  await h.db.query(SCHEMA);
  const store = new SurrealSessionStore(h.db);

  const sample = (size: number) => {
    return Array.from({ length: size }, (_, i) => ({
      type: "user" as const,
      uuid: `u${i}`,
      text: "Lorem ipsum dolor sit amet ".repeat(5),
    }));
  };

  const measure = async (size: number, iters: number): Promise<number[]> => {
    const out: number[] = [];
    for (let i = 0; i < iters; i++) {
      const entries = sample(size);
      const t = performance.now();
      await store.append(
        { projectKey: "bench", sessionId: `s-${size}-${i}` },
        entries,
      );
      out.push(performance.now() - t);
    }
    return out;
  };

  const b1 = await measure(1, 30);
  const b10 = await measure(10, 30);
  const b100 = await measure(100, 30);

  await h.stop();
  return { b1, b10, b100 };
}

async function main() {
  log("probe7", "A. boot latency (5 spawns)");
  const boots: number[] = [];
  for (let i = 0; i < 5; i++) {
    boots.push(await benchBoot());
  }
  log("probe7", `boot: ${fmt(boots)} ms`);

  log("probe7", "B. live query notification latency (40 samples)");
  const live = await benchLiveLatency(40);
  log("probe7", `live: ${fmt(live)} ms`);

  log("probe7", "C. SessionStore.append batch overhead");
  const { b1, b10, b100 } = await benchAppend();
  log("probe7", `append batch=1   : ${fmt(b1)} ms`);
  log("probe7", `append batch=10  : ${fmt(b10)} ms`);
  log("probe7", `append batch=100 : ${fmt(b100)} ms`);

  console.log(`\n=== Probe 7 result: informational, no pass/fail ===`);
  console.log(`boot ms          : ${fmt(boots)}`);
  console.log(`live latency ms  : ${fmt(live)}`);
  console.log(`append b=1   ms  : ${fmt(b1)}`);
  console.log(`append b=10  ms  : ${fmt(b10)}`);
  console.log(`append b=100 ms  : ${fmt(b100)}`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
