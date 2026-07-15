"""The collie, drawn by hand at 18x18.

Sampling the illustration reproduces its pixels but not its meaning. At this size
a face has to be decided, not measured: the ear becomes three pixels because a
human says so, the eye becomes one, and everything that will not survive is cut.

  .  transparent      #  fur          d  fur dark (shadow/edge)
  p  ear pink         w  white        s  white shadow
  b  ice eye          k  ink (nose, pupil)
"""
COLORS = {
    "#": (0x3A, 0x40, 0x4B),
    "d": (0x24, 0x28, 0x30),
    "p": (0xC9, 0x87, 0x92),
    "w": (0xF4, 0xF5, 0xF7),
    "s": (0xC2, 0xC8, 0xD0),
    "b": (0x8F, 0xBF, 0xE8),
    "k": (0x14, 0x16, 0x1A),
}

SPRITE = [
    "....d........d....",
    "...dpd......dpd...",
    "..dppd######dppd..",
    "..dppd##ww##dppd..",
    "..dppd##ww##dppd..",
    "..dpd###ww###dpd..",
    "..dd####ww####dd..",
    "..d#####ww#####d..",
    "..d#b###ww###b#d..",
    "..d#b###ww###b#d..",
    "..d#####ww#####d..",
    "..d###wwwwww###d..",
    "...d#wwwwwwww#d...",
    "...dwwwkkkkwwwd...",
    "....wwwkkkkwww....",
    "....swwwwwwwws....",
    ".....swwwwwws.....",
    "......sswwss......",
]

def build():
    from PIL import Image
    n = len(SPRITE)
    assert all(len(r) == n for r in SPRITE), [len(r) for r in SPRITE]
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(SPRITE):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            px[x, y] = COLORS[ch] + (255,)
    return im

if __name__ == "__main__":
    from PIL import Image, ImageDraw, ImageFont
    F = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
    CW, CH = 9, 18
    im = build(); n = im.size[0]
    px = im.load()
    o = Image.new("RGB", (n*2*CW, n*CH), (13, 14, 17)); d = ImageDraw.Draw(o)
    for y in range(n):
        for x in range(n):
            r, g, b, a = px[x, y]
            if not a: continue
            d.rectangle([x*2*CW, y*CH, x*2*CW+2*CW-1, y*CH+CH-1], fill=(r, g, b))
    o.save("sprite_hand.png")
    print(f"  {n}x{n}, {len({p[:3] for p in im.getdata() if p[3]})} cores")
