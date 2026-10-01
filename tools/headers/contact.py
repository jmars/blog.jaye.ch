"""Stage 3.5: contact sheets for human QC of a harvested batch.

Renders the whole set as a grid of thumbnails so composition drift is visible
across plates rather than one image at a time. Writes to /headers/_qc/.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HEADERS = Path("/headers")
OUT = HEADERS / "_qc"

COLS = 5
TW, TH = 384, 160
PAD = 6
LABEL = 14


def sheet(files, dest, cols=COLS):
    # Cell aspect follows the plates, so a square batch is not squashed into a
    # strip: reviewing the composition of a square plate in a 2.4:1 cell is how
    # you fail to notice it.
    with Image.open(files[0]) as im0:
        aspect = im0.height / im0.width
    th = round(TW * aspect)
    rows = (len(files) + cols - 1) // cols
    W = cols * (TW + PAD) + PAD
    H = rows * (th + LABEL + PAD) + PAD
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    draw = ImageDraw.Draw(canvas)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB").resize((TW, th), Image.LANCZOS)
        x = PAD + (i % cols) * (TW + PAD)
        y = PAD + (i // cols) * (th + LABEL + PAD)
        canvas.paste(im, (x, y))
        draw.text((x + 2, y + th + 2), f.stem[:46], fill=(200, 200, 200))
    canvas.save(dest)
    print(f"{dest}  {W}x{H}  {len(files)} plates")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in HEADERS.glob("*.png"))
    if not files:
        sys.exit("no headers found")
    # split into chunks so each sheet stays legible when viewed
    per = 20
    for n, i in enumerate(range(0, len(files), per), 1):
        sheet(files[i:i + per], OUT / f"sheet-{n}.png")


if __name__ == "__main__":
    main()
