#!/usr/bin/env python3
"""tools/headers/ar.py — aspect-ratio discriminator.

One question: when a plate comes back as a ROW of two or four identical objects
instead of one emblem, is that the prompt's fault or the canvas's?

Renders the SAME brief at the SAME seed at several frame shapes. Only the
canvas changes — prompt text, negative, sampler and seed are byte-identical to
the pipeline's, and the width/height come from render.py's own workflow(), so
this exercises the real render path rather than a copy of it.

If multiplicity collapses as the frame approaches square, the wide 2.4:1
canvas is the cause (SDXL fills a wide field with a row). If every shape still
tiles, the subject or the prompt is the cause and no canvas will fix it.

    python3 tools/headers/ar.py the-container
    python3 tools/headers/ar.py the-container the-same-move

Writes content/headers/_qc/ar/<slug>-<W>x<H>.png
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render as R  # noqa: E402  (path has to be set up first)

OUT = R.ROOT / "content" / "headers" / "_qc" / "ar"
# 2.4:1 (the pipeline's), 1.75:1, 1:1, and 1:1.5 — the last two are the shapes
# SDXL's own buckets are densest in, so they are where a composition prior is
# strongest.
SIZES = [(1536, 640), (1344, 768), (1024, 1024), (768, 1152)]


def main(slugs):
    briefs = json.loads((HERE / "briefs.json").read_text())
    style = json.loads((HERE / "style.json").read_text())
    ckpt = style["model"]["checkpoint"]
    OUT.mkdir(parents=True, exist_ok=True)
    if not R.wait_up():
        sys.exit(f"ComfyUI not reachable at {R.COMFY}")

    for slug in slugs:
        base = briefs[slug]
        for w, h in SIZES:
            # a private slug keeps ComfyUI's output name unique per shape; the
            # prompt itself never contains the slug, so nothing else varies
            b = dict(base, slug=f"{slug}-{w}x{h}")
            st = json.loads(json.dumps(style))
            st["composition"]["width"] = w
            st["composition"]["height"] = h
            dest = OUT / f"{slug}-{w}x{h}.png"
            t0 = time.time()
            img = R.render_one(b["slug"], b, st, ckpt)
            R.fetch(img, dest)
            print(f"  {slug} {w}x{h}  {dest.stat().st_size // 1024}KB  "
                  f"{time.time() - t0:.0f}s")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["the-container"])
