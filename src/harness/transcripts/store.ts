import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runDir } from "../state/paths.js";
import { AgentEventSchema, TranscriptRecordSchema, type AgentEvent, type TranscriptAttemptRef, type TranscriptRecord } from "./types.js";

const ID = "[a-z][a-z0-9_-]*";
const INSTANCE_PATTERN = new RegExp(`^(${ID})(?::(\\d+):(${ID}))?$`);

export class TranscriptStore {
  private readonly nextSequences = new Map<string, number>();

  constructor(private readonly primaryCwd: string, private readonly taskSlug: string) {}

  path(ref: TranscriptAttemptRef): string {
    const match = INSTANCE_PATTERN.exec(ref.instanceId);
    if (!match) throw new Error(`invalid transcript instance id: ${ref.instanceId}`);
    if (!Number.isInteger(ref.attempt) || ref.attempt < 1) throw new Error(`invalid transcript attempt: ${ref.attempt}`);
    const root = join(runDir(this.primaryCwd, this.taskSlug), "transcripts");
    return match[2] === undefined
      ? join(root, match[1]!, `attempt-${ref.attempt}.jsonl`)
      : join(root, match[1]!, match[2], match[3]!, `attempt-${ref.attempt}.jsonl`);
  }

  async append(ref: TranscriptAttemptRef, provider: string, event: AgentEvent): Promise<TranscriptRecord> {
    if (!provider.trim()) throw new Error("transcript provider is required");
    const path = this.path(ref);
    const seq = await this.nextSequence(path);
    const record = TranscriptRecordSchema.parse({ version: 1, seq, at: new Date().toISOString(), provider, event: AgentEventSchema.parse(event) });
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    this.nextSequences.set(path, seq + 1);
    return record;
  }

  async read(ref: TranscriptAttemptRef, options: { after?: number; limit?: number } = {}): Promise<{ events: TranscriptRecord[]; nextAfter: number }> {
    const after = Math.max(0, options.after ?? 0);
    const limit = Math.min(500, Math.max(1, options.limit ?? 200));
    let raw: string;
    try { raw = await readFile(this.path(ref), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], nextAfter: after }; throw error; }
    const complete = raw.endsWith("\n");
    const lines = raw.split("\n");
    if (!complete) lines.pop();
    const parsed: TranscriptRecord[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      try { parsed.push(TranscriptRecordSchema.parse(JSON.parse(line))); }
      catch (error) { throw new Error(`invalid transcript record at line ${index + 1}: ${String(error)}`); }
    }
    const events = parsed.filter((event) => event.seq > after).slice(0, limit);
    return { events, nextAfter: events.at(-1)?.seq ?? after };
  }

  async exists(ref: TranscriptAttemptRef): Promise<boolean> {
    try { await stat(this.path(ref)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  private async nextSequence(path: string): Promise<number> {
    const cached = this.nextSequences.get(path);
    if (cached !== undefined) return cached;
    let raw = "";
    try { raw = await readFile(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const lines = raw.split("\n").filter(Boolean);
    if (!lines.length) return 1;
    const last = TranscriptRecordSchema.parse(JSON.parse(lines.at(-1)!));
    return last.seq + 1;
  }
}
