#!/usr/bin/env bash
# tools/headers/postprocess.sh — stage 3: derive the 1200x630 og crops.
#
# No GPU here, so this does NOT go through gpu.sh: cropping needs Pillow (which
# only the image has) and nothing else. The repo's own content/headers is bind
# mounted, so the crops land back in the source tree where the build reads them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${IMAGE:-localhost/comfyui-gfx1201}"

exec sudo -n podman run --rm \
  --user "$(id -u):$(id -g)" \
  -v "${ROOT}/content/headers:/headers:z" \
  -v "${HERE}:/scripts:ro" \
  "$IMAGE" python3 /scripts/postprocess.py "$@"
