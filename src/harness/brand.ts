/**
 * harny's visual identity.
 *
 * The mark is a border collie: a herding dog, which is what the harness does to
 * agents. Its coat gives the palette (graphite and white) and its eye gives the
 * one accent (electric blue).
 *
 * These are the values that actually ship: every entry is either painted by the
 * sprite below or declared by `src/viewer/index.html`. That file is static and
 * served as a string, so it cannot import this module — the hexes are duplicated
 * there on purpose, and drift between the two is a bug in this file.
 *
 * Nothing imports PALETTE; it is documentation. That is exactly how it went wrong
 * before, so it is worth saying plainly: an earlier version declared ice blue as
 * "the eye" and dusty pink as "the ear" long after the artwork had changed, and
 * named three status colours the viewer had never used. A palette no compiler
 * checks only stays true if it is read against the thing it describes.
 */

export const PALETTE = {
  /** Coat. The viewer's surfaces and type. */
  graphite: "#0D0E11",
  charcoal: "#171A20",
  silver: "#969DA8",
  white: "#F2F3F5",
  /** The eye, and the one accent. The sprite paints the eye #5199F2 and the
   *  viewer paints the accent #4DA3F0 — near enough that the mark and the UI
   *  finally agree, which was not true of the palette this replaced. */
  accent: "#4DA3F0",
  accentLight: "#7CC0FF",
  /** The ear. The only colour outside the coat. */
  pink: "#F09894",
  /** Status, as the viewer declares them. */
  wait: "#F0B849",
  done: "#5FD39B",
  fail: "#FF6B6B",
} as const;

export const TAGLINE = "the harness that herds";

/**
 * The collie at 37x42, extracted from the reference artwork at its own native grid.
 *
 * The reference IS pixel art, so there is nothing to convert -- the job is to find
 * the grid it was drawn on and read it there. That grid is 57x57, found by scoring
 * candidate sizes for cell purity (how much of a cell is a single colour): 57 peaks
 * at 93.8% and every neighbour is lower. The other 1197px of the 1254px file are
 * upscale and JPEG noise. Averaging them is what produced mud on the early attempts;
 * a vote at the true grid is lossless.
 *
 * Three details the extraction had to decide rather than measure:
 *
 *   - The palette is declared, not derived, and it is THIS artwork's. Inheriting the
 *     previous sprite's palette washed the eyes out to grey: that dog's eye was a
 *     pale ice blue and this one's is a saturated cyan, so every eye pixel snapped
 *     to the nearest neutral. A colour does not vanish on its own -- it vanishes
 *     when the palette leaves it no seat. The mid-grey is the same story: without
 *     it the ramp between fur and white has a hole, and pink's green sits exactly
 *     in that hole, which speckled the muzzle on two earlier bakes.
 *
 *   - The vote is on the SNAPPED colour, not the raw one, and biased by
 *     1/frequency^0.3. This eye is drawn with a soft gradient rather than in blocks,
 *     so no raw value repeats often enough to win a cell, and the thin blue ring is
 *     outnumbered by the fur around it. Without both, the eye drops from 22px to 14.
 *
 *   - The artwork outlines the dog in pure black on a pure black field, so colour
 *     alone cannot tell contour from background. Only reachability can: flood from
 *     the border, and the black the flood never reaches is outline. Left as
 *     background it is invisible on a dark terminal and a hole on a light one.
 *
 * On size: rows = height / 2, and that is not negotiable (see collieRows). 42 rows
 * of art is 21 rows of terminal. Scaling the sprite down to buy rows was tried and
 * reverted -- 27% of this art is 1px detail, so a fractional rescale re-decides the
 * drawing by coin flip in ~16% of cells and visibly changes the dog's face. Fewer
 * rows has to come from art drawn smaller, not from art squeezed smaller.
 *
 * The grid below is the source of truth and the form worth editing: change a
 * letter and run the CLI. It is the only copy -- brand.test.ts reads it back out
 * of this file rather than holding a fixture, which would be a second sprite free
 * to drift from the one that ships.
 */
const COLORS: Record<string, readonly [number, number, number]> = {
  k: [0x16, 0x18, 0x20], // ink: outline, nose, pupil
  d: [0x20, 0x24, 0x2c], // fur, shadowed
  "#": [0x38, 0x3c, 0x44], // fur
  "+": [0x48, 0x48, 0x54], // fur, lit
  ":": [0x76, 0x7d, 0x8a], // the ramp between fur and white. Drop it and pink,
  //                          whose green sits exactly there, wins every mid grey.
  s: [0xc0, 0xb8, 0xb8], // white, shadowed
  w: [0xf8, 0xf8, 0xf8], // white: blaze, muzzle, ruff
  B: [0x0c, 0x4f, 0xa1], // }
  b: [0x51, 0x99, 0xf2], // }  the eye, in three tones. It is drawn with a soft
  l: [0x6f, 0xd2, 0xfd], // }  gradient, so one flat blue would not read as an eye.
  p: [0xf0, 0x98, 0x94], // inner ear
  t: [0xcc, 0x78, 0x78], // tongue
};

/** `.` is background: the terminal's own, never painted. */
const SPRITE: string[] = [
  "..k+++.........................+++...",
  "..+#+++......................k+++++..",
  "..+kk+++....................k+++kk+..",
  "..+kkk#++k+k...............k++#kkk+..",
  "..+ktkk##+++k...........k.k+##kktk+..",
  "..dkptkk##d#+...........+k###kktpk+..",
  "..dkpttkk####..kkkkkkkk.+###kkttpkd..",
  "..dkppttkk##dk#:wwwww+#kd##kkttppkd..",
  "..dkppd##kd#####wwwww#####dk##pppkd..",
  ".kdkpptkd########www########dktppkd..",
  ".ddkppptk########www########ktpppk#d.",
  ".d##kpkkkd#######www#######dkkkpk##d.",
  "..d#kptk#########www#########ktpk#d..",
  "...##kdd#########www#########dtk##...",
  ".dddd######www###www###www#######ddd.",
  ".ddddd####w###w##www##w###w####ddddd.",
  "..kdd+###########www###########+ddk..",
  "...d++#####kkk###www###kkk#####++k...",
  "..k+######kBwkk##www##kwB+k#####+#k..",
  "..ddd####kwBwkB##www##BwkBwk####ddd..",
  "...k#####kwbkkl#wwwww#lkkBwk#####d...",
  "..++#######blbl#wwwww#lbll#######++..",
  ".++#########lb#wwwwwww#bl##########+.",
  "+#############wwwkkkwww#############+",
  "..dd########wwwwk###kwwww########dd..",
  "...########wwwwwkkkkkwwwwwd#######...",
  "..k##d####dwwwwwkkkkkwwwwwd####d##k..",
  "..d#dd##ddwwkwwwwkkkwwwwkwwdd##dd#d..",
  "..ddk##dddwwkwwwwwkwwwwwkwwddd##ddd..",
  "..d.d#dddd#wwkwwwkkkwwwkww+dddd#d.d..",
  "....ddkdwwswwskkk#k#kkkswwswwdkdd....",
  "....dkkwwwssswkkttkttkkwwsswwwkkd....",
  ".....kwwwwwsswwktptptkwssswwwww......",
  ".....kwswwwwsswkwpppwkwsswwwwsw......",
  ".....kskwwwwwsswkpppkwsswwwwwks......",
  ".......kwswwwwssskkkwsswwwwsw........",
  ".......kskwwwswsswwwsswswwwkk........",
  "..........kwwswwssssswwkww...........",
  "...........kkkwswwwwwswkw............",
  ".............kk.kwwwk.k..............",
  ".................kwk.................",
  ".................kk..................",
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
 * whole trick: square pixels at two per row, so 42 rows of art cost 21 rows of
 * terminal. Painting a pixel with two full blocks side by side is square too, but
 * costs one terminal row each, and 42 of them is not a banner.
 *
 * This is the densest a square pixel gets. Quadrants (U+2596..) and sextants
 * (U+1FB00..) subdivide a cell further, but into 1x2 and 3x4 shapes -- they buy
 * columns, never rows, and they distort. rows = height / 2 is the floor.
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
  /** Right-hand detail lines, e.g. providers or run counts. Kept short: past the
   *  art's 21 rows they continue below it rather than beside it. */
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
  // resizing the sprite cannot silently leave it stranded at the top.
  const top = Math.max(0, Math.floor((art.length - text.length) / 2));
  // The art is only 21 rows, and `detail` is not bounded. Lines past the last row
  // used to fall off the end without a word; they now continue below the dog, in
  // the same column, so nothing the caller passed can go missing in silence.
  const gutter = " ".repeat(2 + COLLIE_W + 3);
  const out: string[] = [""];
  art.forEach((row, i) => {
    out.push(`  ${row}   ${text[i - top] ?? ""}`.trimEnd());
  });
  for (const overflow of text.slice(art.length - top)) out.push(`${gutter}${overflow}`.trimEnd());
  out.push("");
  return out.join("\n");
}
