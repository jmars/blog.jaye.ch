#!/usr/bin/env python3
"""tools/headers/ab-style.py — style-variant A/B.

Renders a slug set under several candidate STYLE blocks at the same seeds, so a
change to the hand can be judged side by side without re-rendering the batch.
Only style.json's prompt prefix/style/negative vary; the briefs, the sampler and
the seed are identical, and the composition regexes mirror prompts.mjs compose()
so the prompt is assembled exactly as the pipeline assembles it.

    python3 tools/headers/ab-style.py slug,slug variant,variant

Writes content/headers/_qc/ab-style/<slug>-<variant>.png
"""
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render as R  # noqa: E402

OUT = R.ROOT / "content" / "headers" / "_qc" / "ab-style"

MEDIUM = re.compile(
    r"\b(engraved|engraving|etched|etching|linework|line work|lithograph|woodcut"
    r"|steel[- ]?plate|plate)\b", re.I)
WIDE = [
    (re.compile(r"\bwide horizontal vignette\b", re.I), ""),
    (re.compile(r"\bwide\s+frame\b", re.I), "square frame"),
    (re.compile(r"\bwide\s+empt(?:y|iness)\b", re.I), "empty"),
    (re.compile(r"\bwide\s+(arc|sheet|field|plate|band|sweep)\b", re.I), r"\1"),
    (re.compile(r"\bwide\b", re.I), ""),
]


def clean(s):
    t = MEDIUM.sub("", str(s or ""))
    for re_, to in WIDE:
        t = re_.sub(to, t)
    return re.sub(r"\s+([,.;])", r"\1", re.sub(r"\s{2,}", " ", t)).strip()


def compose(brief, spec):
    subject = ", ".join(
        filter(None, [clean(brief["emblem"])] + [clean(s) for s in brief.get("symbols", [])]))
    parts = [spec["prefix"], spec["style"], subject, clean(brief["composition"]),
             f"single oxblood red accent on {brief['accent']}", spec["suffix"]]
    return re.sub(r"\s{2,}", " ", ", ".join(p for p in parts if p)).replace(", ,", ",")


# The candidate hands. All keep the site's bone-paper palette (the ground is a
# design-system token, not a style choice); what varies is how much GESTURE
# versus ENGRAVING the prompt asks for.
VARIANTS = {
    # the live style, for a same-session control
    "live": None,
    # Yoji-primary: dry-brush pen, asymmetric dynamic mass, no stippling clause,
    # no aged-paper clause. Sabogal survives only as splatter texture.
    "yoji": {
        "prefix": "a stark black ink emblem on plain paper,",
        "style": ("loose gestural brush pen drawing, bold calligraphic strokes with "
                  "visible speed and heavy pressure variation, dry-brush skips and "
                  "streaks, big flat black ink masses, sharp angular silhouette, "
                  "ragged torn edges, spatter and drips, extreme black-and-white "
                  "contrast, raw and unfinished, dramatic asymmetric composition"),
    },
    # Yoji pushed harder: figure-forward, motion, minimal symbol
    "yoji2": {
        "prefix": "a brutal black ink brush drawing on plain white paper,",
        "style": ("Yoji Shinkawa style concept sketch, single gestural brush pen "
                  "figure, fast confident strokes, thick-to-thin tapering lines, "
                  "dry brush texture, solid black silhouette masses, aggressive "
                  "asymmetry, off-balance dynamic pose, unfinished edges trailing "
                  "off the paper, high contrast black on white"),
    },
}


def main(slugs, names):
    briefs = json.loads((HERE / "briefs.json").read_text())
    base = json.loads((HERE / "style.json").read_text())
    ckpt = base["model"]["checkpoint"]
    OUT.mkdir(parents=True, exist_ok=True)
    if not R.wait_up():
        sys.exit(f"ComfyUI not reachable at {R.COMFY}")

    for slug in slugs:
        b0 = briefs[slug]
        for name in names:
            spec = base["prompt"] if VARIANTS[name] is None else dict(
                base["prompt"], **VARIANTS[name])
            b = dict(b0, slug=f"{slug}-{name}",
                     prompt=compose(b0, spec), negative=base["prompt"]["negative"])
            # seed is the brief's own, so every arm lands on the same basin
            b["seed"] = b0["seed"]
            dest = OUT / f"{slug}-{name}.png"
            t0 = time.time()
            img = R.render_one(b["slug"], b, base, ckpt)
            R.fetch(img, dest)
            print(f"  {slug} [{name}] {time.time() - t0:.0f}s")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1].split(","), sys.argv[2].split(","))
