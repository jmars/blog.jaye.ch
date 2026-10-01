"""Build a N-up strip of named plates at a legible size, for close QC of a few
suspects without burning the whole image budget on a 20-up contact sheet."""
import sys
import math
from pathlib import Path

from PIL import Image, ImageDraw

HEADERS = Path("/headers")
OUT = HEADERS / "_qc"
CELL = 470
LABEL = 18
PAD = 8


def main():
    names = sys.argv[1].split(",")
    dest = OUT / sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else math.ceil(math.sqrt(len(names)))
    rows = math.ceil(len(names) / cols)
    W = cols * (CELL + PAD) + PAD
    H = rows * (CELL + LABEL + PAD) + PAD
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    draw = ImageDraw.Draw(canvas)
    for i, n in enumerate(names):
        im = Image.open(HEADERS / f"{n}.png").convert("RGB").resize((CELL, CELL), Image.LANCZOS)
        x = PAD + (i % cols) * (CELL + PAD)
        y = PAD + (i // cols) * (CELL + LABEL + PAD)
        canvas.paste(im, (x, y))
        draw.text((x + 3, y + CELL + 3), n, fill=(210, 210, 210))
    canvas.save(dest, quality=90)
    print(f"{dest} {W}x{H} {len(names)} plates")


if __name__ == "__main__":
    main()
