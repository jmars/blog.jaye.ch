#!/usr/bin/env python3
"""tools/headers/postprocess.py — stage 3: derive the og:image from each header.

The page wants a wide banner; social cards want 1200x630. Cropping is NOT left
to the platform — Twitter and Facebook centre-crop an oversized image
themselves and can cut the emblem out of frame, so the 1.9:1 crop is made here,
deliberately, from the middle.

Runs INSIDE the container (it needs Pillow, which the host does not have):

    NO_GPU=1 tools/headers/gpu.sh python3 /work/tools/headers/postprocess.py

Reads  content/headers/<slug>.png       (1536x640, straight from ComfyUI)
Writes content/headers/webp/<slug>.webp  (1536x640, what the page inlines)
Writes content/headers/og/<slug>.webp    (1200x630, what og:image points at)

The render is SQUARE (see style.json composition._ratio — measured, not chosen
for layout). The page shows that square centred at less than full width.

The social card is the one place that must be 1.91:1, so the square is set
centred on a 1200x630 field and the sides are filled by extending the plate's
own outermost paper columns. Cropping to the ratio instead would cut the
emblem's top or bottom, which is the whole subject of the image.

The PNG stays the source of record — it is what the renderer produced and what
re-crops are made from. The WebPs are derived artifacts, and they exist because
a large PNG inlined as base64 adds ~1.6MB to every page.
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Pillow not available — run this inside the container")

SRC = Path("/headers")
OG = SRC / "og"
WEBP = SRC / "webp"
TARGET = (1200, 630)
# A header is fine linework on flat paper, which is the easy case for a lossy
# codec; 82 holds the stipple without visible ringing. The og card is the one
# image a stranger sees first, so it gets more.
QUALITY = 82
OG_QUALITY = 86
# How far the flat edge-extension blends back into the real paper at the seam.
FEATHER = 90


def to_card(im, target=TARGET, feather=FEATHER):
    """Fit a header render to the 1.91:1 social-card field.

    The card is WIDER than it is tall and the render is wider still (2.4:1), so
    the only honest operation is a centre crop of the surplus width — a slight
    one, 1536 -> 1219 on a 640-tall source, which a gestural asymmetric frame
    survives without losing its subject. The earlier branch here upscaled the
    render to a SQUARE and extended the sides, which was right for the square
    canvas and squashes a wide one; that is the branch that produced a
    distorted card the moment the canvas went back to 2.4:1.

    If a future canvas is instead TALLER than the target, the sides are filled
    by extending the image's own outermost columns (feathered) rather than by a
    flat colour: a flat fill reads as a mat, a continuation reads as more paper.
    """
    tw, th = target
    sw, sh = im.size
    if sw / sh >= tw / th:
        # too wide: centre-crop the surplus width
        w = round(sh * tw / th)
        left = (sw - w) // 2
        return im.crop((left, 0, left + w, sh)).resize(target, Image.LANCZOS)

    # too tall: scale to the target height and extend the sides from own columns
    sq = im.resize((round(sw * th / sh), th), Image.LANCZOS)
    side = sq.size[0]
    left = (tw - side) // 2
    canvas = Image.new("RGB", (tw, th))
    canvas.paste(sq, (left, 0))
    canvas.paste(sq.crop((0, 0, 1, th)).resize((left, th), Image.NEAREST), (0, 0))
    canvas.paste(sq.crop((side - 1, 0, side, th)).resize((tw - left - side, th),
                                                        Image.NEAREST), (left + side, 0))
    blurred = canvas.filter(ImageFilter.GaussianBlur(14))
    mask = Image.new("L", (tw, th), 0)
    px = mask.load()
    for i in range(feather):
        t = int(255 * (i / feather))          # 0 at the seam lip -> 255 outward
        for x in (left - 1 - i, left + side + i):
            if 0 <= x < tw:
                for y in range(th):
                    px[x, y] = t
    return Image.composite(canvas, blurred, mask)


def main(slugs):
    OG.mkdir(parents=True, exist_ok=True)
    WEBP.mkdir(parents=True, exist_ok=True)
    files = [SRC / f"{s}.png" for s in slugs] if slugs else sorted(SRC.glob("*.png"))
    made = 0
    for src in files:
        if not src.exists():
            print(f"  missing {src.name}")
            continue
        im = Image.open(src).convert("RGB")
        w, h = im.size
        # The page's plate: re-encoded at source size, the page scales it.
        im.save(WEBP / f"{src.stem}.webp", "WEBP", quality=QUALITY, method=6)
        cropped = to_card(im)
        # WebP only. A PNG crop here would be ~1.2MB of a file that is fully
        # derivable from content/headers/<slug>.png, and the build consumes only
        # the WebP — 58 of them is 80MB of junk in the repo.
        dest = OG / f"{src.stem}.webp"
        cropped.save(dest, "WEBP", quality=OG_QUALITY, method=6)
        made += 1
        print(f"  {src.name}  {w}x{h} -> {TARGET[0]}x{TARGET[1]}  "
              f"(og {dest.stat().st_size // 1024}KB, "
              f"plate {(WEBP / f'{src.stem}.webp').stat().st_size // 1024}KB)")
    print(f"wrote {made} og cards -> {OG}, {made} plate webp -> {WEBP}")


if __name__ == "__main__":
    main(sys.argv[1:])
