/**
 * harny's visual identity.
 *
 * The mark is a border collie: a herding dog, which is what the harness does to
 * agents. Its coat gives the palette (graphite and white) and its eye gives the
 * one accent (ice blue).
 *
 * The viewer mirrors PALETTE in `src/viewer/index.html` as CSS custom properties.
 * That file is static and served as a string, so it cannot import this module —
 * the hexes are duplicated there on purpose and this file is the source of truth.
 */

export const PALETTE = {
  /** Coat. */
  graphite: "#0D0E11",
  charcoal: "#171A20",
  slate: "#4E5663",
  silver: "#969DA8",
  white: "#F2F3F5",
  /** The eye. The only accent harny gets. */
  ice: "#7FB2D4",
  iceLight: "#A6CDE4",
  /** The ear. The only colour outside the coat, kept dusty so it cannot
   *  compete with ice for the eye. */
  pink: "#C98792",
  /** Status. Sage/amber/brick sit far enough from ice to stay distinguishable. */
  sage: "#86BF9E",
  amber: "#D9A85C",
  brick: "#D97070",
} as const;

export const TAGLINE = "the harness that herds";

/**
 * The collie at 24x24, as raw RGBA.
 *
 * Baked from the illustration the viewer serves at /collie.png, so the terminal and
 * the browser show the same dog — but baked as pixel art, not as a downsample.
 *
 * Simply resizing the 603px artwork gave 312 distinct colours across 341 pixels:
 * nearly every pixel its own intermediate tone, which reads as mud. Crisp terminal
 * mascots are not higher resolution, they are lower resolution drawn deliberately,
 * with flat colour and hard edges. So the pixels snap to a declared ten-colour
 * palette and the alpha is thresholded rather than feathered.
 *
 * Two things that palette had to be taught, both found by looking:
 *   - Letting an algorithm pick the palette (median-cut) drops the brand. It
 *     allocates by pixel frequency, and the ice-blue eyes are ~6px of 341, so they
 *     get merged into the coat.
 *   - A gap in the ramp gets filled by whatever is nearest, and pink's green sits
 *     mid-way between the fur and the white — without mid-greys, pink became the
 *     closest match for every antialiased edge and speckled the whole face.
 *
 * The eyes are placed, not derived: at 24px each is about two pixels, and no
 * resampler preserves that against dark fur. Their coordinates come from measuring
 * the artwork; see scripts in the design notes.
 *
 * The coat is mid-graphite in the artwork itself, which is what lets one image
 * serve a near-black terminal and a white one.
 *
 * Size is a straight trade against banner height: with half-blocks the dog's
 * width in pixels IS the column count, so detail costs rows. 24 (12 rows) is
 * where the ruff's fur and the ear pink resolve; 16 loses both.
 *
 * Quadrant glyphs would double the horizontal resolution at the same height,
 * but a cell carries only two colours -- the eyes are ~2px of ice against dark
 * fur and get crushed to a flat bar. Exact colour beat extra pixels here.
 */
const COLLIE_RGBA_B64 =
  "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nKOt/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwsjQ//T19//CyND/wsjQ/3Z9iv92fYr/dn2K/3Z9iv/CyND/wsjQ//T19//CyND/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwsjQ/8LI0P/09ff/wsjQ/5yjrf+co63/nKOt/5yjrf/CyND/9PX3/8LI0P/CyND/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADCyND/wsjQ/8LI0P/CyND/nKOt/8LI0P/CyND/wsjQ/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMLI0P/CyND/wsjQ/8LI0P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACco63/nKOt/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const COLLIE_PX = 24;
/** Below this the pixel is background, not dog. */
const ALPHA_FLOOR = 100;

let decoded: Uint8Array | null = null;
function pixels(): Uint8Array {
  if (!decoded) decoded = Uint8Array.from(atob(COLLIE_RGBA_B64), (c) => c.charCodeAt(0));
  return decoded;
}

type Px = readonly [number, number, number] | null;
function at(x: number, y: number): Px {
  if (y >= COLLIE_PX) return null;
  const data = pixels();
  const i = (y * COLLIE_PX + x) * 4;
  const a = data[i + 3] ?? 0;
  if (a < ALPHA_FLOOR) return null;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

/**
 * The collie as half-block rows: each cell packs two vertical pixels via
 * foreground/background on U+2580, which is what makes it read as a solid image
 * instead of the gappy mush braille gives you at this size.
 *
 * `stretch` widens the art to cancel the terminal's cell shape. Two stacked
 * pixels are only square when the cell is exactly twice as tall as it is wide;
 * that is the usual default, but line spacing is a user setting (Warp's lands
 * near 1:2.4, which makes the dog 20% too tall). Columns are duplicated rather
 * than resampled, so a stretched dog is still the same ten flat colours — no
 * interpolation, no new tones, no mush.
 *
 * Truecolor only. There is no meaningful degraded form — without per-pixel
 * colour every cell is the same block and the dog is a rectangle — so callers
 * fall back to a text banner instead.
 */
export function collieRows(stretch = 1): string[] {
  const width = Math.max(1, Math.round(COLLIE_PX * stretch));
  const rows: string[] = [];
  for (let y = 0; y < COLLIE_PX; y += 2) {
    let line = "";
    for (let x = 0; x < width; x++) {
      // nearest-neighbour source column; at stretch = 1 this is the identity
      const sx = Math.min(COLLIE_PX - 1, Math.floor(x / stretch));
      const top = at(sx, y);
      const bot = at(sx, y + 1);
      if (!top && !bot) line += "\x1b[0m ";
      else if (top && !bot) line += `\x1b[0m\x1b[38;2;${top[0]};${top[1]};${top[2]}m▀`;
      else if (!top && bot) line += `\x1b[0m\x1b[38;2;${bot[0]};${bot[1]};${bot[2]}m▄`;
      else line += `\x1b[0m\x1b[38;2;${top![0]};${top![1]};${top![2]}m\x1b[48;2;${bot![0]};${bot![1]};${bot![2]}m▀`;
    }
    rows.push(`${line}\x1b[0m`);
  }
  return rows;
}

export type BannerOpts = {
  version: string;
  /** Right-hand detail lines, e.g. providers or run counts. Kept short. */
  detail?: string[];
  /** Horizontal correction for this terminal's cell shape; 1 = the 1:2 default. */
  stretch?: number;
};

const WORDMARK = "h a r n y";

/**
 * The banner. `level` comes from `colorLevel()`; anything below truecolor gets
 * the text form, because the dog needs per-pixel colour to be a dog.
 */
export function banner(opts: BannerOpts, level: number): string {
  const { version, detail = [], stretch = 1 } = opts;
  if (level < 3) {
    // No art: a rectangle of identical blocks says nothing. Stay quiet instead.
    return `harny ${version} — ${TAGLINE}`;
  }
  // Bold with the terminal's own foreground: painting the wordmark coat-white
  // makes it vanish on a light terminal. The dog carries the brand colour; the
  // type just inherits whatever theme the user already chose.
  const wordmark = (s: string) => `\x1b[1m${s}\x1b[0m`;
  // Mid-tone silver is legible against both a near-black and a white terminal.
  const dim = (s: string) => `\x1b[38;2;150;157;168m${s}\x1b[0m`;

  const art = collieRows(stretch);
  // Wordmark sits beside the dog rather than under it: keeps the banner to the
  // art's own height instead of stacking two blocks of vertical space.
  const text = [wordmark(WORDMARK), dim(TAGLINE), "", dim(`v${version}`), ...detail.map(dim)];
  // Centre the text against the art rather than pinning it to fixed rows, so
  // changing COLLIE_PX cannot silently leave it stranded at the top.
  const top = Math.max(0, Math.floor((art.length - text.length) / 2));
  const out: string[] = [""];
  art.forEach((row, i) => {
    out.push(`  ${row}   ${text[i - top] ?? ""}`.trimEnd());
  });
  out.push("");
  return out.join("\n");
}
