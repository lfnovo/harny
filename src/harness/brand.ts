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
 * The collie at 18x18, drawn by hand.
 *
 * Converting the illustration was tried at length and never read as a dog. Every
 * mechanical step was individually right — ten declared colours so the ice-blue
 * eyes could not be averaged away, sampling by vote so no invented grey appeared
 * along an edge, two cells per pixel so the blocks looked chosen — and the result
 * was still a smudge. A face at this size is not a smaller face. It has to be
 * decided: at 18px an ear IS three pixels of pink because someone says so, and a
 * muzzle IS a white blob with a black bar for a nose. Sampling can only average
 * what is there; it cannot choose what to keep.
 *
 * Kept as raw RGBA with hard alpha. The sprite itself lives in the design notes as
 * a character grid, which is the form worth editing — change a letter, rebuild.
 * Seven colours, no antialiasing, no tone that was not put there on purpose.
 */
const COLLIE_RGBA_B64 =
  "AAAAAAAAAAAAAAAAAAAAACQoMP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQoMP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJCgw/8mHkv8kKDD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJCgw/8mHkv8kKDD/AAAAAAAAAAAAAAAAAAAAAAAAAAAkKDD/yYeS/8mHkv8kKDD/OkBL/zpAS/86QEv/OkBL/zpAS/86QEv/JCgw/8mHkv/Jh5L/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/yYeS/8mHkv8kKDD/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/JCgw/8mHkv/Jh5L/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/yYeS/8mHkv8kKDD/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/JCgw/8mHkv/Jh5L/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/yYeS/yQoMP86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/yQoMP/Jh5L/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/JCgw/zpAS/86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/zpAS/8kKDD/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/OkBL/zpAS/86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/zpAS/86QEv/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/OkBL/4+/6P86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/4+/6P86QEv/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/OkBL/4+/6P86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/4+/6P86QEv/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/OkBL/zpAS/86QEv/OkBL/zpAS//09ff/9PX3/zpAS/86QEv/OkBL/zpAS/86QEv/JCgw/wAAAAAAAAAAAAAAAAAAAAAkKDD/OkBL/zpAS/86QEv/9PX3//T19//09ff/9PX3//T19//09ff/OkBL/zpAS/86QEv/JCgw/wAAAAAAAAAAAAAAAAAAAAAAAAAAJCgw/zpAS//09ff/9PX3//T19//09ff/9PX3//T19//09ff/9PX3/zpAS/8kKDD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJCgw//T19//09ff/9PX3/xQWGv8UFhr/FBYa/xQWGv/09ff/9PX3//T19/8kKDD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPT19//09ff/9PX3/xQWGv8UFhr/FBYa/xQWGv/09ff/9PX3//T19/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMLI0P/09ff/9PX3//T19//09ff/9PX3//T19//09ff/9PX3/8LI0P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADCyND/9PX3//T19//09ff/9PX3//T19//09ff/wsjQ/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwsjQ/8LI0P/09ff/9PX3/8LI0P/CyND/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const COLLIE_PX = 18;
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
 * The collie as rows of full blocks, two cells per pixel.
 *
 * Half-blocks (one cell, two stacked pixels) pack more detail into fewer rows,
 * and that is exactly what made this read as a shrunken photo rather than as
 * pixel art: at 9x9 screen pixels each, the blocks are too fine to look chosen.
 * Two cells side by side make one ~18x18 square — the size Claude Code's own
 * mascot uses, and the size at which a block reads as a deliberate mark.
 *
 * The trade is height. A collie needs more pixels than a simple blob does (ears,
 * blaze, eyes, muzzle all have to survive), and bigger pixels over more of them
 * costs rows: 18 lines against the 12 half-blocks would take. Their creature fits
 * in 8 because it is a body with four legs, not a face.
 *
 * Truecolor only. There is no meaningful degraded form — without per-pixel
 * colour every cell is the same block and the dog is a rectangle — so callers
 * fall back to a text banner instead.
 */
export function collieRows(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < COLLIE_PX; y++) {
    let line = "";
    for (let x = 0; x < COLLIE_PX; x++) {
      const px = at(x, y);
      // Two cells wide: on the usual 1:2 cell this is a square, and the glyph is
      // U+2588 rather than a half-block so there is no top/bottom seam.
      line += px ? `\x1b[38;2;${px[0]};${px[1]};${px[2]}m██` : "\x1b[0m  ";
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
