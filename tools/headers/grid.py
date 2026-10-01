"""Variants grid: one row per slug, one column per candidate file.

For picking the best frame among seed re-rolls without a contact sheet of the
whole batch. Files are <dir>/<slug>-<tag>.png; a missing one leaves a gap.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HEADERS = Path("/headers")
CELL = 380
LABEL = 16
PAD = 6


def main():
    slugs = sys.argv[1].split(",")
    tags = sys.argv[2].split(",")
    dest = HEADERS / "_qc" / sys.argv[3]
    src = HEADERS / "_qc" / "reroll-sq"
    cols = len(tags)
    W = cols * (CELL + PAD) + PAD
    H = len(slugs) * (CELL + LABEL + PAD) + PAD
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    draw = ImageDraw.Draw(canvas)
    for r, s in enumerate(slugs):
        for c, t in enumerate(tags):
            f = src / f"{s}-{t}.png"
            x = PAD + c * (CELL + PAD)
            y = PAD + r * (CELL + LABEL + PAD)
            if not f.exists():
                draw.text((x + 4, y + CELL // 2), f"missing {f.name}",
                          fill=(220, 90, 90))
                continue
            im = Image.open(f).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
            canvas.paste(im, (x, y))
            draw.text((x + 3, y + CELL + 2), f"{s}  [{t}]", fill=(210, 210, 210))
    canvas.save(dest, quality=90)
    print(f"{dest} {W}x{H}")


if __name__ == "__main__":
    main()
