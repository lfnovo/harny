"""Preview the terminal collie, and document how it got there.

The sprite is NOT stored here. It lives in `src/harness/brand.ts` as a character
grid, and this script reads it back out -- so there is exactly one copy, and the
one you preview is the one that ships. Edit a letter there, run this, look.

    python3 docs/design/collie-sprite.py        # writes collie-preview.png

--------------------------------------------------------------------------------
How the sprite was made, and why it took four tries

The reference artwork is a 1254x1254 PNG of a border collie's face. Three earlier
attempts converted it and none read as a dog:

  1. Downsample + median-cut. The palette is picked by pixel frequency, so the
     ~6px of ice-blue eye got merged into the fur. It threw away the brand to
     save the background.
  2. Downsample + declared palette. Better, still mud -- because LANCZOS averages,
     and the mean of a black/white edge is a grey that exists nowhere in the art.
     Every edge became invented tone.
  3. Vote sampling, then hand-drawing at 18x18. Clean, but 18px cannot hold a face
     with erect ears, a blaze, two eyes, a muzzle and a mouth.

What all three missed: the reference IS pixel art. There was never anything to
convert. Its native grid is 64x64 -- found by scoring candidate sizes for
intra-cell flatness, where 64 is a sharp minimum (16.4 against 32.2 at 62 and
23.9 at 66) -- and every cell is one flat colour. Sample at that grid by vote and
the extraction is lossless. The other 1190 pixels are upscale and JPEG noise.

Two things still had to be decided rather than measured:

  - The palette. Twelve declared entries. The two mid-greys are load-bearing:
    without them the ramp has a hole between the fur and the white, and pink --
    whose green channel sits exactly in that hole -- becomes the nearest colour
    to every mid-tone. That is what speckled the muzzle twice.

  - The outline. The art draws the dog's contour in pure black on a pure black
    field, so no threshold can separate contour from background. Only
    reachability can: flood from the border, and the 108px of black the flood
    never reaches are outline. Left as background they are invisible on a dark
    terminal and holes on a light one.

Rendering is half blocks (U+2580, fg = top pixel, bg = bottom). A terminal cell
is about twice as tall as it is wide, so each half is square: 52 rows of art in
26 rows of terminal.
"""
import pathlib
import re

BRAND = pathlib.Path(__file__).parents[2] / "src" / "harness" / "brand.ts"


def load():
    """Read COLORS and SPRITE straight out of brand.ts -- it is the source of truth."""
    src = BRAND.read_text()
    colors = {}
    block = re.search(r"const COLORS[^{]*\{(.*?)\n\};", src, re.S).group(1)
    for ch, r, g, b in re.findall(
        r'^\s*"?(.)"?:\s*\[(0x[0-9a-f]+),\s*(0x[0-9a-f]+),\s*(0x[0-9a-f]+)\]', block, re.M
    ):
        colors[ch] = (int(r, 16), int(g, 16), int(b, 16))
    block = re.search(r"const SPRITE: string\[\] = \[(.*?)\n\];", src, re.S).group(1)
    return colors, re.findall(r'"([^"]*)"', block)


def build(colors, sprite):
    from PIL import Image

    w, h = len(sprite[0]), len(sprite)
    assert all(len(r) == w for r in sprite), [len(r) for r in sprite]
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(sprite):
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = colors[ch] + (255,)
    return im


if __name__ == "__main__":
    from PIL import Image, ImageDraw, ImageFont

    colors, sprite = load()
    im = build(colors, sprite)
    w, h = im.size
    px = im.load()

    def panel(bg):
        C = 9  # a half block is ~9x9 screen px on a 9x18 cell
        o = Image.new("RGB", (w * C, h * C), bg)
        d = ImageDraw.Draw(o)
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a:
                    d.rectangle([x * C, y * C, x * C + C - 1, y * C + C - 1], fill=(r, g, b))
        return o

    F = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 13)
    # Both backgrounds: the light one is where a missing outline shows up as a hole.
    a, b = panel((13, 14, 17)), panel((250, 250, 250))
    sheet = Image.new("RGB", (a.width + b.width + 30, a.height + 30), (60, 60, 66))
    d = ImageDraw.Draw(sheet)
    sheet.paste(a, (10, 8))
    sheet.paste(b, (a.width + 20, 8))
    d.text((10, a.height + 12), f"escuro ({w} col x {(h + 1) // 2} lin)", font=F, fill=(235, 235, 242))
    d.text((a.width + 20, a.height + 12), "claro (o contorno tem que segurar)", font=F, fill=(235, 235, 242))
    out = pathlib.Path(__file__).parent / "collie-preview.png"
    sheet.save(out)
    print(f"  {w}x{h}, {len({p[:3] for p in im.getdata() if p[3]})} cores -> {out.name}")
