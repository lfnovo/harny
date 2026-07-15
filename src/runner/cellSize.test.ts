import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { queryCellRatio, stretchFor, NEUTRAL_RATIO } from "./cellSize.js";

/** A stand-in terminal that answers (or does not) on cue. */
function fakeTty(reply: string | null, opts: { isTTY?: boolean; raw?: boolean } = {}) {
  const stdin = new EventEmitter() as any;
  stdin.isTTY = opts.isTTY ?? true;
  stdin.isRaw = opts.raw ?? false;
  stdin.rawCalls = [] as boolean[];
  stdin.setRawMode = (m: boolean) => { stdin.rawCalls.push(m); stdin.isRaw = m; };
  stdin.resume = () => { stdin.paused = false; };
  stdin.pause = () => { stdin.paused = true; };
  stdin.isPaused = () => Boolean(stdin.paused);
  stdin.off = EventEmitter.prototype.off.bind(stdin);
  const stdout = {
    isTTY: true,
    written: [] as string[],
    write(s: string) {
      this.written.push(s);
      if (reply !== null) queueMicrotask(() => stdin.emit("data", Buffer.from(reply, "latin1")));
      return true;
    },
  } as any;
  return { stdin, stdout };
}

test("reads the cell ratio from a terminal that answers", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;38;19t");
  expect(await queryCellRatio(stdin, stdout)).toBeCloseTo(2, 5);
  expect(stdout.written).toEqual(["\x1b[16t"]);
});

test("a taller cell yields a stretch above 1", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;48;20t");   // 2.4, roughly Warp's default
  const ratio = await queryCellRatio(stdin, stdout);
  expect(ratio).toBeCloseTo(2.4, 5);
  expect(stretchFor(ratio)).toBeCloseTo(1.2, 5);
});

// The banner is decoration. Every one of these must degrade to "do not stretch"
// rather than hang, throw, or leave the terminal in raw mode.
test("gives up on a terminal that never answers", async () => {
  const { stdin, stdout } = fakeTty(null);
  const started = Date.now();
  expect(await queryCellRatio(stdin, stdout)).toBeNull();
  expect(Date.now() - started).toBeLessThan(1000);
});

test("ignores a reply that is not the one we asked for", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;0;0t");     // zero cell: nonsense
  expect(await queryCellRatio(stdin, stdout)).toBeNull();
});

test("ignores a ratio outside anything a font could be", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;400;19t");  // ~21:1
  expect(await queryCellRatio(stdin, stdout)).toBeNull();
});

test("never asks when stdin is not a terminal", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;38;19t", { isTTY: false });
  expect(await queryCellRatio(stdin, stdout)).toBeNull();
  expect(stdout.written).toEqual([]);   // and writes no escape into a pipe
});

test("restores raw mode after asking", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;38;19t");
  await queryCellRatio(stdin, stdout);
  expect(stdin.rawCalls).toEqual([true, false]);
  expect(stdin.isRaw).toBe(false);
});

test("restores raw mode even when the terminal stays silent", async () => {
  const { stdin, stdout } = fakeTty(null);
  await queryCellRatio(stdin, stdout);
  expect(stdin.isRaw).toBe(false);
  expect(stdin.listenerCount("data")).toBe(0);   // and leaves no listener behind
});

test("leaves a terminal that was already raw as it found it", async () => {
  const { stdin, stdout } = fakeTty("\x1b[6;38;19t", { raw: true });
  await queryCellRatio(stdin, stdout);
  expect(stdin.isRaw).toBe(true);
});

test("HARNY_NO_CELL_QUERY opts out entirely", async () => {
  process.env["HARNY_NO_CELL_QUERY"] = "1";
  try {
    const { stdin, stdout } = fakeTty("\x1b[6;38;19t");
    expect(await queryCellRatio(stdin, stdout)).toBeNull();
    expect(stdout.written).toEqual([]);
  } finally {
    delete process.env["HARNY_NO_CELL_QUERY"];
  }
});

test("no answer means no stretch", () => {
  expect(stretchFor(null)).toBe(1);
  expect(stretchFor(NEUTRAL_RATIO)).toBe(1);
});
