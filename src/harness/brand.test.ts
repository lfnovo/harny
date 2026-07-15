import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { collieRows, banner, PALETTE, TAGLINE } from "./brand.js";

/**
 * The sprite is a private character grid, so these tests read it back out of the
 * source the same way `docs/design/collie-sprite.py` does. That keeps one copy: a
 * fixture here would be a second sprite that could drift from the shipped one.
 */
function sprite(): { colors: Map<string, string>, rows: string[] } {
  const src = readFileSync(new URL("./brand.ts", import.meta.url), "utf8");
  const colorBlock = /const COLORS[^{]*\{(.*?)\n\};/s.exec(src)?.[1] ?? "";
  const colors = new Map<string, string>();
  for (const m of colorBlock.matchAll(/^\s*"?(.)"?:\s*\[(0x[0-9a-f]+), (0x[0-9a-f]+), (0x[0-9a-f]+)\]/gm)) {
    colors.set(m[1]!, [m[2], m[3], m[4]].map((h) => Number(h)).join(";"));
  }
  const gridBlock = /const SPRITE: string\[\] = \[(.*?)\n\];/s.exec(src)?.[1] ?? "";
  const rows = [...gridBlock.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  return { colors, rows };
}

/** Decode one rendered row back into its two source rows of sprite characters. */
function decode(line: string, byRgb: Map<string, string>): [string, string] {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const cell of line.split("\x1b[0m").filter((c) => c.length)) {
    if (cell === " ") { top.push("."); bottom.push("."); continue; }
    const m = /\[38;2;(\d+);(\d+);(\d+)(?:;48;2;(\d+);(\d+);(\d+))?m(.)/.exec(cell);
    if (!m) throw new Error(`unparsed cell: ${JSON.stringify(cell)}`);
    const ch = (r: string, g: string, b: string) => byRgb.get(`${Number(r)};${Number(g)};${Number(b)}`) ?? "?";
    const fg = ch(m[1]!, m[2]!, m[3]!);
    if (m[7] === "▄") { top.push("."); bottom.push(fg); }
    else { top.push(fg); bottom.push(m[4] ? ch(m[4]!, m[5]!, m[6]!) : "."); }
  }
  return [top.join(""), bottom.join("")];
}

describe("collieRows", () => {
  const { colors, rows } = sprite();
  const byRgb = new Map([...colors].map(([ch, rgb]) => [rgb, ch]));

  test("what the terminal receives decodes back to the sprite, exactly", () => {
    // The only honest check: the escape codes are the artefact, not the grid.
    const decoded = collieRows().flatMap((line) => decode(line, byRgb));
    expect(decoded).toEqual(rows);
  });

  test("two sprite rows per terminal row, because a half block is two pixels", () => {
    expect(collieRows()).toHaveLength(Math.ceil(rows.length / 2));
  });

  test("every painted colour is a declared one", () => {
    // Guards the failure that produced every earlier bake: a tone nobody chose.
    const declared = new Set(colors.values());
    for (const line of collieRows()) {
      for (const m of line.matchAll(/[34]8;2;(\d+);(\d+);(\d+)/g)) {
        expect(declared).toContain(`${m[1]};${m[2]};${m[3]}`);
      }
    }
  });

  test("the eye and the ear survive", () => {
    // They are a handful of pixels each and are the first thing any resampling drops.
    // Counted off the decoded grid, not the raw escapes: a cell with a background
    // renders as `38;2;R;G;B;48;2;...m`, so matching on the colour alone would need
    // to know which half of the block it landed in.
    const decoded = collieRows().flatMap((line) => decode(line, byRgb)).join("");
    for (const [key, what] of [["b", "eye"], ["p", "ear"]] as const) {
      expect(decoded.split(key).length - 1, what).toBeGreaterThan(0);
    }
  });

  test("every row resets, so no colour leaks past the art", () => {
    for (const line of collieRows()) expect(line.endsWith("\x1b[0m")).toBe(true);
  });
});

describe("banner", () => {
  test("below truecolor it is text, with no escapes at all", () => {
    // A rectangle of identical blocks says nothing, so the art is not attempted.
    for (const level of [0, 1, 2]) {
      const out = banner({ version: "1.2.3" }, level);
      expect(out).not.toContain("\x1b");
      expect(out).toContain("1.2.3");
      expect(out).toContain(TAGLINE);
    }
  });

  test("at truecolor it draws the dog and keeps the text beside it", () => {
    const out = banner({ version: "1.2.3", detail: ["claude + codex"] }, 3);
    expect(out).toContain("▀");
    expect(out).toContain("v1.2.3");
    expect(out).toContain(TAGLINE);
    expect(out).toContain("claude + codex");
    // Beside, not below: the banner stays the art's own height.
    expect(out.split("\n").filter((l) => l.includes("▀") || l.includes("▄")).length)
      .toBe(collieRows().length);
  });

  test("side text is centred against the art, not pinned to fixed rows", () => {
    // Resizing the sprite must not strand the wordmark at the top.
    const lines = banner({ version: "1.2.3" }, 3).split("\n");
    const first = lines.findIndex((l) => l.includes("h a r n y"));
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(lines.length - 1);
  });

  test("fits a standard terminal", () => {
    const plain = banner({ version: "1.2.3", detail: ["claude + codex"] }, 3)
      .split("\n")
      .map((l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length);
    expect(Math.max(...plain)).toBeLessThanOrEqual(80);
  });
});

describe("PALETTE", () => {
  test("every entry is a six-digit hex", () => {
    for (const [name, value] of Object.entries(PALETTE)) {
      expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("the viewer really does mirror it", () => {
    // PALETTE is documentation that no compiler checks, and it had drifted into
    // fiction once: it named colours the viewer had never painted.
    const viewer = readFileSync(new URL("../viewer/index.html", import.meta.url), "utf8").toUpperCase();
    const painted = new Set(collieRows().join("").matchAll(/38;2;(\d+);(\d+);(\d+)/g));
    const spriteHexes = new Set([...painted].map((m) =>
      "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase()));
    for (const [name, value] of Object.entries(PALETTE)) {
      const known = viewer.includes(value.toUpperCase()) || spriteHexes.has(value.toUpperCase());
      expect(known, `${name} (${value}) is painted by neither the viewer nor the sprite`).toBe(true);
    }
  });
});
