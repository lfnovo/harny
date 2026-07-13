import { appendFile, mkdir, readFile } from "node:fs/promises";
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
    if (await this.load()) throw new Error(`run.json already exists at ${this.runPath}`);
    await this.save(snapshot);
    await this.appendEvent({ at: snapshot.run.started_at, run_id: snapshot.run.id, type: "run.created" });
  }

  async save(snapshot: RunSnapshot): Promise<void> { await writeJsonAtomic(this.runPath, RunSnapshotSchema.parse(snapshot)); }

  async mutate(mutator: (snapshot: RunSnapshot) => void, event?: Omit<RunEvent, "at" | "run_id">): Promise<RunSnapshot> {
    const snapshot = await this.load();
    if (!snapshot) throw new Error(`No run.json at ${this.runPath}`);
    mutator(snapshot);
    await this.save(snapshot);
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
}
