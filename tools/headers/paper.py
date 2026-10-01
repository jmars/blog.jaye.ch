"""QC instrument: paper-tone fidelity across a harvested batch.

The house palette's ground is `paper` #fbfaf7 (bone, warm). A plate that came
back neutral-grey reads as a different print, so measure it instead of eyeballing
IT: sample the brightest quartile of the frame (the paper, not the ink) and
report its R-B spread. Run via postprocess.sh-style container invocation.
"""
import sys
from pathlib import Path

from PIL import Image

HEADERS = Path("/headers")
COOL = 6.0  # R-B below this is visibly neutral-grey paper, not bone


def main():
    rows = []
    for p in sorted(HEADERS.glob("*.png")):
        px = list(Image.open(p).convert("RGB").resize((64, 64)).getdata())
        paper = sorted(px, key=sum)[int(len(px) * 0.75):]
        r = sum(c[0] for c in paper) / len(paper)
        b = sum(c[2] for c in paper) / len(paper)
        rows.append((r - b, r, b, p.stem))
    rows.sort()
    print(f"{'R-B':>5} {'paperR':>7} {'paperB':>7}  slug")
    for w, r, b, s in rows:
        print(f"{w:5.1f} {r:7.1f} {b:7.1f}  {s}{'  <-- COOL' if w < COOL else ''}")
    ws = [x[0] for x in rows]
    print(f"\nmean R-B {sum(ws) / len(ws):.1f}  median {ws[len(ws) // 2]:.1f}  "
          f"min {ws[0]:.1f}")
    cool = [x for x in rows if x[0] < COOL]
    print(f"cool plates (paper R-B < {COOL}): {len(cool)}/{len(rows)}")
    if len(sys.argv) > 1 and sys.argv[1] == "--only-cool":
        print(" ".join(x[3] for x in cool))


if __name__ == "__main__":
    main()
