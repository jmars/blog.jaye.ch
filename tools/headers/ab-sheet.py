"""A/B sheet: one row per slug, one column per arm, for picking between arms.

An arm is a file <dir>/<slug>-<arm>.png; a missing one leaves a labelled gap
rather than silently shifting the row.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HEADERS = Path("/headers")
CELL = 400
LABEL = 16
PAD = 6


def main():
    src = HEADERS / "_qc" / sys.argv[1]
    slugs = sys.argv[2].split(",")
    arms = sys.argv[3].split(",")
    dest = HEADERS / "_qc" / sys.argv[4]
    W = len(arms) * (CELL + PAD) + PAD
    H = len(slugs) * (CELL + LABEL + PAD) + PAD
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    draw = ImageDraw.Draw(canvas)
    for r, s in enumerate(slugs):
        for c, a in enumerate(arms):
            f = src / f"{s}-{a}.png"
            x = PAD + c * (CELL + PAD)
            y = PAD + r * (CELL + LABEL + PAD)
            if not f.exists():
                draw.text((x + 4, y + CELL // 2), f"missing {f.name}", fill=(220, 90, 90))
                continue
            im = Image.open(f).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
            canvas.paste(im, (x, y))
            draw.text((x + 3, y + CELL + 2), f"{s}  [{a}]", fill=(210, 210, 210))
    canvas.save(dest, quality=88)
    print(f"{dest} {W}x{H}")


if __name__ == "__main__":
    main()
