"""QC instrument: how much of the ONE oxblood wash actually lands on a plate.

The house style promises exactly one red accent. The composed prompt carries the
accent clause LAST in the drop order, so if a change to the token budget silently
drops it, the plates go monochrome and nothing else would notice.
"""
from pathlib import Path
from PIL import Image

n_red = 0
rows = []
for p in sorted(Path("/headers").glob("*.png")):
    px = list(Image.open(p).convert("RGB").resize((128, 128)).getdata())
    red = sum(1 for r, g, b in px if r > 110 and r - g > 45 and r - b > 45)
    pct = 100 * red / len(px)
    rows.append((pct, p.stem))
    n_red += pct > 0.3
rows.sort(reverse=True)
print(f"plates with >0.3% red pixels: {n_red}/{len(rows)}")
print("most red:", [(s, round(v, 1)) for v, s in rows[:6]])
print("least red:", [(s, round(v, 1)) for v, s in rows[-4:]])
