/**
 * Ask the terminal how tall its character cells are.
 *
 * Half-block art packs two vertical pixels into one cell, so a square image only
 * looks square when the cell is exactly twice as tall as it is wide. That is the
 * common default (Menlo/SF Mono at 1.2 line spacing land on ~1:2.0), but it is a
 * user setting, not a constant: Warp's default lands near 1:2.4, which stretches
 * the mascot 20% vertically. There is no value that is right for everyone.
 *
 * `CSI 16 t` asks for the real cell size in pixels; the terminal answers
 * `CSI 6 ; height ; width t`. xterm, iTerm2, Ghostty, WezTerm and VS Code all
 * answer it. Apple Terminal does not, so this must fail quietly.
 *
 * Everything here is written to fail closed. The banner is decoration; corrupting
 * someone's shell to draw a dog would be a bad trade, so the terminal is restored
 * on every path and the caller gets the safe default whenever anything is off.
 */

/** The ratio half-block art is drawn for: a cell twice as tall as it is wide. */
export const NEUTRAL_RATIO = 2;

const QUERY = "\x1b[16t";
/** A terminal that means to answer does so immediately; this only bounds the ones that never will. */
const TIMEOUT_MS = 120;

type Tty = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

/**
 * Cell height divided by cell width, or null if the terminal did not say.
 * Never throws.
 */
export async function queryCellRatio(
  stdin: Tty = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<number | null> {
  // Only ask when both ends are a real terminal and we can read the reply.
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return null;
  if (process.env["HARNY_NO_CELL_QUERY"]) return null;

  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused();
  let onData: ((chunk: Buffer) => void) | null = null;

  const restore = () => {
    try {
      if (onData) stdin.off("data", onData);
      if (!wasRaw) stdin.setRawMode?.(false);
      if (wasPaused) stdin.pause();
    } catch { /* restoring must never be the thing that throws */ }
  };

  try {
    stdin.setRawMode(true);
    stdin.resume();
    const reply = await new Promise<string | null>((resolve) => {
      let buf = "";
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      onData = (chunk: Buffer) => {
        buf += chunk.toString("latin1");
        // CSI 6 ; <height> ; <width> t
        const match = buf.match(/\x1b\[6;(\d+);(\d+)t/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
        // Guard against a terminal that streams something else at us.
        else if (buf.length > 64) { clearTimeout(timer); resolve(null); }
      };
      stdin.on("data", onData);
      stdout.write(QUERY);
    });
    if (!reply) return null;
    const m = reply.match(/\x1b\[6;(\d+);(\d+)t/);
    if (!m) return null;
    const height = Number(m[1]);
    const width = Number(m[2]);
    if (!Number.isFinite(height) || !Number.isFinite(width) || width <= 0 || height <= 0) return null;
    const ratio = height / width;
    // A cell outside this range is a reply we misread, not a font choice.
    if (ratio < 1.2 || ratio > 3.5) return null;
    return ratio;
  } catch {
    return null;
  } finally {
    restore();
  }
}

/**
 * How much to stretch the art horizontally so it lands square on this terminal.
 * 1 means no stretch, which is both the neutral case and the fallback.
 */
export function stretchFor(ratio: number | null): number {
  if (ratio == null) return 1;
  return ratio / NEUTRAL_RATIO;
}
