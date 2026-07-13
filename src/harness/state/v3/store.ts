import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "../atomic.js";
import { RunV3Schema, type RunEventV3, type RunV3 } from "./schema.js";

export class FilesystemRunStoreV3 {
  readonly runPath: string;
  readonly eventsPath: string;
  constructor(primaryCwd: string, taskSlug: string) {
    const dir = join(primaryCwd, ".harny", taskSlug);
    this.runPath = join(dir, "run.json"); this.eventsPath = join(dir, "events.jsonl");
  }
  async load(): Promise<RunV3 | null> {
    try { return RunV3Schema.parse(JSON.parse(await readFile(this.runPath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async create(snapshot: RunV3): Promise<void> {
    if (await this.load()) throw new Error(`run.json already exists at ${this.runPath}`);
    await this.save(snapshot); await this.appendEvent({ at: snapshot.run.started_at, run_id: snapshot.run.id, type: "run.created" });
  }
  async save(snapshot: RunV3): Promise<void> { await writeJsonAtomic(this.runPath, RunV3Schema.parse(snapshot)); }
  async mutate(mutator: (snapshot: RunV3) => void, event?: Omit<RunEventV3, "at" | "run_id">): Promise<RunV3> {
    const snapshot = await this.load(); if (!snapshot) throw new Error(`No run.json at ${this.runPath}`);
    mutator(snapshot); await this.save(snapshot);
    if (event) await this.appendEvent({ ...event, at: new Date().toISOString(), run_id: snapshot.run.id });
    return snapshot;
  }
  async appendEvent(event: RunEventV3): Promise<void> {
    await mkdir(dirname(this.eventsPath), { recursive: true });
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  }
  async events(): Promise<RunEventV3[]> {
    try { return (await readFile(this.eventsPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEventV3); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
}
