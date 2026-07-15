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
 * The collie at 36x40, extracted from the reference artwork at its own native grid
 * and then scaled down by vote.
 *
 * The earlier attempts converted a 1254px illustration and never read as a dog, so
 * the sprite was drawn by hand instead. This one is neither: the reference IS pixel
 * art, so there was nothing to convert. Its native grid is 64x64 (found by scoring
 * candidate sizes for intra-cell flatness -- 64 is a sharp minimum), and every cell
 * is one flat colour. Sampling at that grid by vote is lossless; the extra 1190px of
 * the file are upscale and JPEG noise, and averaging them is what produced mud before.
 *
 * Two details the extraction had to decide rather than measure:
 *
 *   - The palette is declared, not derived. Twelve entries, and the two mid-greys
 *     are load-bearing: without them the ramp has a hole between the fur and the
 *     white, and pink -- whose green sits exactly there -- becomes the nearest
 *     colour to every mid-tone. That speckled the muzzle on two earlier bakes.
 *
 *   - The artwork outlines the dog in pure black on a pure black field, so colour
 *     alone cannot tell contour from background. Only reachability can: flood from
 *     the border, and the 108px of black the flood never reaches are outline. Left
 *     transparent they are invisible on a dark terminal and holes on a light one.
 *
 * The extraction lands at 46x52, which is 26 rows of terminal on every invocation
 * and was simply too much banner. Scaling down is the one step where mud could
 * still creep back in, so it is a vote as well -- an average would invent tones
 * that the palette does not contain, which is the whole failure mode above. The
 * vote is biased by 1/frequency^0.35: a plain majority erases the eye, because six
 * pixels of ice always lose to the fur surrounding them. 36x40 is the floor. Below
 * it the eyes smudge to a single blue pixel and the muzzle stops holding its shape;
 * at that size the face would have to be drawn, not resampled.
 *
 * The grid below is the source of truth and the form worth editing -- change a
 * letter and rebuild. `docs/design/collie-sprite.py` reads it back to render a
 * preview, so there is only ever one copy.
 */
const COLORS: Record<string, readonly [number, number, number]> = {
  k: [0x14, 0x16, 0x1a], // ink: outline, nose, pupil
  d: [0x24, 0x28, 0x30], // fur, shadowed
  "#": [0x3a, 0x40, 0x4b], // fur
  "+": [0x4e, 0x56, 0x63], // fur, lit
  ":": [0x76, 0x7d, 0x8a], // }  the ramp between fur and white. Remove either and
  "-": [0x9c, 0xa3, 0xad], // }  pink becomes the nearest colour to every mid grey.
  s: [0xc2, 0xc8, 0xd0], // white, shadowed
  w: [0xf4, 0xf5, 0xf7], // white: blaze, muzzle, ruff
  b: [0x8f, 0xbf, 0xe8], // the eye. The one accent.
  l: [0xd6, 0xe8, 0xf7], // the eye, catchlight
  p: [0xc9, 0x87, 0x92], // inner ear
  t: [0xa8, 0x5f, 0x68], // tongue
};

/** `.` is background: the terminal's own, never painted. */
const SPRITE: string[] = [
  "...##...........................###.",
  "..####.........................####.",
  "..#kk##.......................##kk#.",
  "..#kkk##.d.................d.##kkk#.",
  "..dttkk##dd..............#dd##kktkd.",
  "..dtttkk##dk.............k###kkttkd.",
  "..kptttkk##d.k..wwwww.dd.###ktttpkk.",
  "..kpppkdkkddd#d#wwwwwd##d##kkdkppkk.",
  "..kppppd########wwwww#######dkpppkk.",
  ".kkppptkdd#####dswwwsd#####dd+tppkkk",
  ".kdkptkdk########www########kdktpkdk",
  "..dktptkd########wwwd#######dktpt#d.",
  "..k#kpkd#########www########dkkpk#k.",
  ".kkd#d#####www###www###ww####d###dk.",
  "..kddd####wddws##www##sw#w#####dddd.",
  "...kdd#####ddd###www###ddd######dk..",
  "...kddd####kkd###www###dkkdd##ddkk..",
  "..kkdd####k#+kd#+www#ddk+kkd###ddkk.",
  "...kd####kswwkk#swwwsdkwksskd###dk..",
  "...k####dd+wkk:dwwwww#bwk+wdd#####..",
  "..#######dd:kkd#wwwwwdw:k:dd####d#..",
  ".d##d######wbbdwwwwwww#bbdd########d",
  "##dd########dddwwwwwwwddd#######dddd",
  ".kk#########dwwwwwwwwwwwdd#######dk.",
  "..k#dd######wwwkk###kkwwwd#####dd#k.",
  "..ddd######wwwwkkkkkkkwwwd######d#d.",
  ".kddd####kwwwwwkkkkkkkwwwwdd#d##kkdk",
  ".k.d#dddkkkkwwwwkkkkkwwwwkkkdddddk.k",
  "...ddkkkkkkwkwwwwskswwwwkwkkkkdkdk..",
  "...kdkkksss-llws-kks-wsls-ssskkkkk..",
  "...k.kkswwss-skkddkddkks-swwlskk.k..",
  "......-swwwssssktt#ttksssswwss-.....",
  "......sswwwws-wkpttppkw-swwwws-.....",
  "......s.wwwwss-kwpppww-ssw-ww.s.....",
  "........swwwww-lwkkkwlswww.ws.......",
  ".........sswwws-swwws-wwws.s........",
  "...........sswwss---swsws...........",
  ".............s-wwwwwws.s............",
  "...............s-www-s..............",
  ".................-ls................",
];

const COLLIE_W = SPRITE[0]!.length;
const COLLIE_H = SPRITE.length;

function at(x: number, y: number): readonly [number, number, number] | null {
  const ch = SPRITE[y]?.[x];
  return ch && ch !== "." ? (COLORS[ch] ?? null) : null;
}

/**
 * The collie as rows of half blocks.
 *
 * A terminal cell is about twice as tall as it is wide, so U+2580 -- foreground on
 * the top half, background on the bottom -- makes each half a square. That is the
 * whole trick: square pixels at two per row, so 40 rows of art cost 20 rows of
 * terminal. Painting a pixel with two full blocks side by side is square too, but
 * costs one terminal row each, and 40 of them is not a banner.
 *
 * An earlier note here claimed half blocks made the dog read as a shrunken photo.
 * That was true of the art at the time, not of the technique: it was a conversion
 * with 312 averaged colours, and it would have looked like mud at any block size.
 *
 * Truecolor only. Without per-pixel colour every cell is the same block and the dog
 * is a rectangle, so callers fall back to a text banner instead.
 */
export function collieRows(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < COLLIE_H; y += 2) {
    let line = "";
    for (let x = 0; x < COLLIE_W; x++) {
      const top = at(x, y);
      const bot = at(x, y + 1);
      // Reset every cell: a transparent half has to show the terminal's own
      // background, which means clearing whatever the previous cell set.
      if (top && bot) line += `\x1b[0m\x1b[38;2;${top[0]};${top[1]};${top[2]};48;2;${bot[0]};${bot[1]};${bot[2]}m\u2580`;
      else if (top) line += `\x1b[0m\x1b[38;2;${top[0]};${top[1]};${top[2]}m\u2580`;
      else if (bot) line += `\x1b[0m\x1b[38;2;${bot[0]};${bot[1]};${bot[2]}m\u2584`;
      else line += "\x1b[0m ";
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
