import { appendFile, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "./atomic.js";
import { RunSnapshotSchema, type RunEvent, type RunSnapshot } from "./runSchema.js";

/** The only writable run store. run.json is authoritative; events.jsonl is audit-only. */
export class RunStore {
  readonly runPath: string;
  readonly eventsPath: string;

  constructor(primaryCwd: string, taskSlug: string) {
    const dir = join(primaryCwd, ".harny", taskSlug);
    this.runPath = join(dir, "run.json");
    this.eventsPath = join(dir, "events.jsonl");
  }

  async load(): Promise<RunSnapshot | null> {
    try { return RunSnapshotSchema.parse(JSON.parse(await readFile(this.runPath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async create(snapshot: RunSnapshot): Promise<void> {
    await this.withLock(async () => { if (await this.load()) throw new Error(`run.json already exists at ${this.runPath}`); await this.saveUnlocked(snapshot); });
    await this.appendEvent({ at: snapshot.run.started_at, run_id: snapshot.run.id, type: "run.created" });
  }

  async save(snapshot: RunSnapshot): Promise<void> { await this.withLock(() => this.saveUnlocked(snapshot)); }

  async mutate(mutator: (snapshot: RunSnapshot) => void, event?: Omit<RunEvent, "at" | "run_id">): Promise<RunSnapshot> {
    const snapshot = await this.withLock(async () => { const current = await this.load(); if (!current) throw new Error(`No run.json at ${this.runPath}`); mutator(current); await this.saveUnlocked(current); return current; });
    if (event) await this.appendEvent({ ...event, at: new Date().toISOString(), run_id: snapshot.run.id });
    return snapshot;
  }

  async appendEvent(event: RunEvent): Promise<void> {
    await mkdir(dirname(this.eventsPath), { recursive: true });
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  }

  async events(): Promise<RunEvent[]> {
    try { return (await readFile(this.eventsPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async saveUnlocked(snapshot: RunSnapshot): Promise<void> { await writeJsonAtomic(this.runPath, RunSnapshotSchema.parse(snapshot)); }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.runPath}.lock`; await mkdir(dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 500; attempt++) {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(lockPath, "wx"); await handle.writeFile(String(process.pid));
        try { return await operation(); } finally { await handle.close().catch(() => {}); handle = undefined; await unlink(lockPath).catch(() => {}); }
      } catch (error) {
        if (handle) { await handle.close().catch(() => {}); await unlink(lockPath).catch(() => {}); }
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stale = await stat(lockPath).then((value) => Date.now() - value.mtimeMs > 30_000).catch(() => false); if (stale) { await unlink(lockPath).catch(() => {}); continue; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(`timed out acquiring run store lock at ${lockPath}`);
  }
}
