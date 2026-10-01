#!/usr/bin/env bash
# tools/headers/ab-neg.sh — one-variable A/B: does an appended NEGATIVE clause
# kill a specific attractor without changing anything else?
#
# Arm A is the current prompt (already on disk). Arm B is the same slugs at the
# same seeds and the same positive prompt, with ONLY the negative extended. The
# tree is restored afterwards, so an inconclusive result costs nothing.
#
#   tools/headers/ab-neg.sh the-breakthrough,the-differential "crucifix, cross"
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NC="$(cd "$HERE/../.." && pwd)/content/headers"
SLUGS="${1:?usage: ab-neg.sh slug,slug,... \"negative appendix\"}"
APPEND="${2:?usage: ab-neg.sh slug,slug,... \"negative appendix\"}"
DEST="$NC/_qc/ab-neg"
mkdir -p "$DEST"

cp "$HERE/style.json" /tmp/style.json.abn
cp "$HERE/briefs.json" /tmp/briefs.json.abn
trap 'cp /tmp/style.json.abn "$HERE/style.json"; cp /tmp/briefs.json.abn "$HERE/briefs.json"' EXIT

for s in $(echo "$SLUGS" | tr , ' '); do
  [ -f "$NC/$s.png" ] && cp "$NC/$s.png" "$DEST/$s-A-base.png"
done

python3 - "$HERE/style.json" "$APPEND" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["prompt"]["negative"] += ", " + sys.argv[2]
json.dump(d, open(p, "w"), indent=2)
print("negative now:", d["prompt"]["negative"][-140:])
PY
node "$HERE/prompts.mjs" --recompose >/dev/null
python3 "$HERE/render.py" --only "$SLUGS" --force 2>&1 | grep -E '^\s+\[' || true

for s in $(echo "$SLUGS" | tr , ' '); do
  cp "$NC/$s.png" "$DEST/$s-B-neg.png"
done
ls "$DEST"
