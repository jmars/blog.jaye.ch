#!/usr/bin/env bash
# tools/viz-shots.sh — screenshot every interactive figure, for a visual check.
#
# tools/viz-smoke.mjs proves a figure MOUNTS, DRAWS, RESPONDS and TEARS DOWN, and
# that its labels land inside the canvas. It cannot see whether the result LOOKS
# right — whether text is invisible, clipped or overlapping. This script closes
# that gap: it renders each figure headlessly and writes a PNG per figure, so a
# human (or a vision model) can look.
#
# It works by extracting, from each built page, the figure slot, the page's
# <style> blocks and the page's inlined engine+widget script into a small
# standalone HTML file — the pages are self-contained (no external requests), so
# that file renders exactly as the page's figure does, without needing the rest
# of the page or a scroll to reach it.
#
# Needs podman (rootless is fine). The browser image is pulled on first run.
#
#   ./build.sh && tools/viz-shots.sh            # → tools/../.viz-shots/*.png
#   OUT=/tmp/shots tools/viz-shots.sh           # choose the output dir
#   IMAGE=docker.io/zenika/alpine-chrome tools/viz-shots.sh
#
# Then look: open a PNG, or feed it to the `vision` skill.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/.viz-shots}"
IMAGE="${IMAGE:-docker.io/zenika/alpine-chrome}"
W="${W:-1000}"
H="${H:-560}"

command -v podman >/dev/null || { echo "viz-shots: podman not found" >&2; exit 1; }
mkdir -p "$OUT"; chmod 777 "$OUT"   # rootless podman writes as a mapped uid

if [ ! -d "$ROOT/dist" ]; then echo "viz-shots: no dist/ — run ./build.sh first" >&2; exit 1; fi

# slug<TAB>widget for every figure on every built page, from the manifest
pairs="$(node -e '
const fs=require("fs"),path=require("path");
const root=process.argv[1];
const m=JSON.parse(fs.readFileSync(path.join(root,"posts.json"),"utf8"));
for(const p of m.posts){
  const f=path.join(root,"dist",p.slug,"index.html");
  if(!fs.existsSync(f)) continue;
  const s=fs.readFileSync(f,"utf8");
  for(const mm of s.matchAll(/data-viz=(["'"'"'])([a-z0-9-]+)\1/g)) console.log(p.slug+"\t"+mm[2]);
}' "$ROOT")"

[ -n "$pairs" ] || { echo "viz-shots: no figures found in dist/" >&2; exit 1; }

n=0
while IFS=$'\t' read -r slug w; do
  [ -n "$w" ] || continue
  # build the standalone page for this figure
  node -e '
const fs=require("fs"),path=require("path");
const [root,slug,w,out]=process.argv.slice(1);
const src=fs.readFileSync(path.join(root,"dist",slug,"index.html"),"utf8");
const styles=[...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join("");
const fig=(src.match(new RegExp("<div class=\"viz\" data-viz=\""+w+"\">[\\s\\S]*?\\n</div>"))||[])[0];
if(!fig){ console.error("no slot for "+w); process.exit(1); }
const viz=[...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("registerViz(\x27"+w+"\x27"));
if(!viz){ console.error("no inline script for "+w); process.exit(1); }
fs.writeFileSync(out,
  "<html><head><meta charset=\"utf-8\">"+styles+
  "</head><body style=\"margin:0;padding:26px;background:#fff\">"+fig+
  "<script>"+viz+"</script></body></html>");
' "$ROOT" "$slug" "$w" "$OUT/_page_$w.html"
  podman run --rm -v "$OUT:/out:rw" "$IMAGE" \
    --no-sandbox --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=3000 --window-size="$W,$H" \
    --screenshot="/out/$slug--$w.png" "file:///out/_page_$w.html" >/dev/null 2>&1
  echo "  $slug/$w → $OUT/$slug--$w.png"
  n=$((n+1))
done <<< "$pairs"

echo "viz-shots: $n figure(s) → $OUT"
