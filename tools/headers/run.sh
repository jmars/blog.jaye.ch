#!/usr/bin/env bash
# tools/headers/run.sh — start ComfyUI, serving on :8188.
#
# Runs detached so render.py can drive it over HTTP and the batch can be
# interrupted and resumed without losing the loaded model. Stop it with
# tools/headers/stop.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${IMAGE:-localhost/comfyui-gfx1201}"
MODELS="${MODELS:-/var/data/workspace/viz-models}"
WORK="${WORK:-/var/data/workspace/viz}"
NAME=comfyui-headers

mkdir -p "$MODELS" "$WORK"

# Already up? Leave it alone rather than stacking a second server on the port.
if sudo -n podman container exists "$NAME" 2>/dev/null \
   && [ "$(sudo -n podman inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]; then
  echo "already running: $NAME"
  exit 0
fi
sudo -n podman rm -f "$NAME" >/dev/null 2>&1 || true

# The RDNA4 tuning knobs matter here: PYTORCH_TUNABLEOP_* picks the fastest
# GEMM kernels for gfx1201 at runtime, which is the difference between usable
# and glacial on this card. HSA_ENABLE_SDMA=0 avoids a known RDNA4 hang where a
# long batch stalls with the GPU pinned at 100%.
# --base-directory moves ComfyUI's writable state (user/, output/, input/,
# temp/) out of the image and onto the ZFS volume. Without it the server dies at
# startup with PermissionError on /opt/ComfyUI/user, because it runs as the host
# uid while the image's own tree is root-owned.
#
# --workdir matters for the same reason and is not cosmetic: TunableOp writes
# its kernel-tuning results to tunableop_results0.csv in the CURRENT DIRECTORY. With
# the image's root-owned /opt/ComfyUI as cwd that write fails ("TunableOp
# realtime append: failed to open"), so the tuning is thrown away and re-done on
# every single run — which is why the first sampling step took 430s instead of
# a few. MIOPEN_* are the same problem for MIOpen's kernel database.
mkdir -p "$WORK/comfy/miopen"
exec sudo -n podman run -d --name "$NAME" \
  --device /dev/kfd --device /dev/dri \
  --group-add "$(getent group render | cut -d: -f3)" \
  --security-opt seccomp=unconfined \
  --shm-size 16g \
  -p 127.0.0.1:8188:8188 \
  --user "$(id -u):$(id -g)" \
  --workdir /work/comfy \
  -e PYTORCH_TUNABLEOP_ENABLED=1 \
  -e PYTORCH_TUNABLEOP_TUNING_DURATION=short \
  -e MIOPEN_USER_DB_PATH=/work/comfy/miopen \
  -e MIOPEN_CUSTOM_CACHE_DIR=/work/comfy/miopen \
  -e MIOPEN_FIND_MODE=FAST \
  -e FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE \
  -e HSA_ENABLE_SDMA=0 \
  -e HF_HOME=/models/hf \
  -v "${MODELS}:/models:z" \
  -v "${WORK}:/work:z" \
  -v "${HERE}/extra_model_paths.yaml:/opt/extra_model_paths.yaml:ro" \
  "$IMAGE" \
  python3 /opt/ComfyUI/main.py --listen 0.0.0.0 --port 8188 \
    --base-directory /work/comfy \
    --cpu-vae \
    --extra-model-paths-config /opt/extra_model_paths.yaml
