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
 * Downsampled from the same illustration the viewer serves at /collie.png, so the
 * terminal and the browser show the same dog. Kept as RGBA rather than quantised
 * to PALETTE so the antialiased edges survive, and with real alpha so the mark
 * composites onto any terminal background instead of carrying its own.
 *
 * The coat is mid-graphite in the artwork itself, which is what lets one image
 * serve a near-black terminal and a white one. An earlier hand-drawn build needed
 * two tone variants for exactly this reason.
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
  "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";

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
 * Truecolor only. There is no meaningful degraded form — without per-pixel
 * colour every cell is the same block and the dog is a rectangle — so callers
 * fall back to a text banner instead.
 */
export function collieRows(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < COLLIE_PX; y += 2) {
    let line = "";
    for (let x = 0; x < COLLIE_PX; x++) {
      const top = at(x, y);
      const bot = at(x, y + 1);
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
};

const WORDMARK = "h a r n y";

/**
 * The banner. `level` comes from `colorLevel()`; anything below truecolor gets
 * the text form, because the dog needs per-pixel colour to be a dog.
 */
export function banner(opts: BannerOpts, level: number): string {
  const { version, detail = [] } = opts;
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

  const art = collieRows();
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
