#!/usr/bin/env bash
# tools/headers/ab-crosshatch.sh — one-variable A/B on the style clause.
#
# Hypothesis: the word "cross-hatching" in the style block leaks a CROSS into the
# conditioning, and SDXL's strongest attractor for "occult emblem on aged paper"
# is a crucifix — so briefs naming a vessel, a gauge or a suitcase come back as
# crosses. Arm A is the current prompts (already on disk); arm B is the same
# slugs at the same seeds with the ONLY change "cross-hatching" -> "hatching".
# Both are saved to _qc/ab-cross/ and the working tree is restored afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NC="$(cd "$HERE/../.." && pwd)/content/headers"
SLUGS="${1:?usage: ab-crosshatch.sh slug,slug,...}"
DEST="$NC/_qc/ab-cross"
mkdir -p "$DEST"

cp "$HERE/style.json" /tmp/style.json.ab
cp "$HERE/briefs.json" /tmp/briefs.json.ab
restore() { cp /tmp/style.json.ab "$HERE/style.json"; cp /tmp/briefs.json.ab "$HERE/briefs.json"; }
trap restore EXIT

for s in $(echo "$SLUGS" | tr , ' '); do
  [ -f "$NC/$s.png" ] && cp "$NC/$s.png" "$DEST/$s-A-crosshatch.png"
done

sed -i 's/cross-hatching/hatching/' "$HERE/style.json"
node "$HERE/prompts.mjs" --recompose >/dev/null
python3 "$HERE/render.py" --only "$SLUGS" --force 2>&1 | grep -E '^\s+\[' || true

for s in $(echo "$SLUGS" | tr , ' '); do
  cp "$NC/$s.png" "$DEST/$s-B-hatching.png"
done
ls "$DEST"
