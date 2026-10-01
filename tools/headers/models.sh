#!/usr/bin/env bash
# tools/headers/models.sh — fetch the checkpoints the header renderer needs.
#
# Weights are large and must NOT live in the repo or on the 20G btrfs root, so
# they go to the ZFS pool. The directory layout is ComfyUI's own, so the models
# dir can be bind-mounted straight into the container.
#
#   tools/headers/models.sh            # fetch anything missing
#   tools/headers/models.sh --list     # show what would be fetched
set -euo pipefail

MODELS="${MODELS:-/var/data/workspace/viz-models}"
HF="${HF:-https://huggingface.co}"

# name|subdir|huggingface repo|filename
CATALOGUE=$(cat <<'EOF'
sd_xl_base_1.0|checkpoints|stabilityai/stable-diffusion-xl-base-1.0|sd_xl_base_1.0.safetensors
EOF
)

if [ "${1:-}" = "--list" ]; then
  echo "$CATALOGUE" | while IFS='|' read -r name sub dir file; do
    printf '%-22s %-12s %s/%s\n' "$name" "$sub" "$dir" "$file"
  done
  exit 0
fi

command -v curl >/dev/null || { echo "curl not found" >&2; exit 1; }

echo "$CATALOGUE" | while IFS='|' read -r _name sub dir file; do
  [ -n "$_name" ] || continue
  out="$MODELS/$sub/$file"
  mkdir -p "$MODELS/$sub"
  if [ -f "$out" ]; then
    printf 'have  %s (%s)\n' "$file" "$(du -h "$out" | cut -f1)"
    continue
  fi
  printf 'fetch %s\n' "$file"
  # -C - resumes a partial download, so a killed run costs only bandwidth, not
  # the whole file. The .part suffix keeps an incomplete file from ever being
  # picked up by the renderer.
  curl -fL --retry 5 --retry-delay 5 -C - -o "$out.part" "$HF/$dir/resolve/main/$file"
  mv "$out.part" "$out"
  printf 'done  %s (%s)\n' "$file" "$(du -h "$out" | cut -f1)"
done
