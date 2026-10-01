#!/usr/bin/env bash
# tools/headers/rolls.sh — render N seed re-rolls of a slug set as QC CANDIDATES,
# leaving the tree and the manifest exactly as they were.
#
# render.py records its picks in renders.json; using it directly to explore rolls
# would overwrite hand-picked reroll values with whatever was rendered last. So
# the briefs/renders pair is saved and restored around the sweep, and the
# candidates land in content/headers/_qc/rolls/<slug>-r<N>.png.
#
#   tools/headers/rolls.sh "the-costume,safeguards" 1,2,3
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NC="$ROOT/content/headers"
DEST="$NC/_qc/rolls"
SLUGS="${1:?usage: rolls.sh slug,slug,... 1,2,3}"
ROLLS="${2:?usage: rolls.sh slug,slug,... 1,2,3}"
mkdir -p "$DEST"

cp "$HERE/renders.json" /tmp/renders.json.rolls
restore() { cp /tmp/renders.json.rolls "$HERE/renders.json"; }
trap restore EXIT

for s in $(echo "$SLUGS" | tr , ' '); do
  cp "$NC/$s.png" "$DEST/$s-current.png"
done

for n in $(echo "$ROLLS" | tr , ' '); do
  echo "--- roll $n"
  python3 "$HERE/render.py" --reroll "$n" --only "$SLUGS" --force 2>&1 | grep -E '^\s+\[' || true
  for s in $(echo "$SLUGS" | tr , ' '); do
    cp "$NC/$s.png" "$DEST/$s-r$n.png"
  done
done
ls "$DEST"
