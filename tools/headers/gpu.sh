#!/usr/bin/env bash
# tools/headers/gpu.sh — run a command in the ROCm ComfyUI container with the
# RX 9070 (gfx1201) passed through.
#
# ROOTFUL podman, deliberately. Rootless podman cannot hand a container the
# host's render/video gid: the host's gid 488 is outside jaye's subgid range
# (165536:65536), so /dev/kfd appears inside as nobody:nogroup, `--group-add
# keep-groups` does not propagate, and numeric gids get re-mapped into the
# subgid range. The result is "Unable to open /dev/kfd read-write: Permission
# denied". `--userns=keep-id` would map it correctly but forces a full 21GB
# ID-mapped copy of the image, because ZFS has no idmapped-mount support.
# Running rootful sidesteps all of it; a rootful process has DAC override over
# the device nodes.
#
# jaye must still be in the video and render groups for the HOST side to work
# (usermod -aG video,render jaye); inside the container the devices are owned by
# nobody:nogroup and access comes from the rootful process, not the group.
#
#   tools/headers/gpu.sh <command> [args...]
#   NO_GPU=1 tools/headers/gpu.sh <command>     # CPU only
set -euo pipefail

IMAGE="${IMAGE:-localhost/comfyui-gfx1201}"
MODELS="${MODELS:-/var/data/workspace/viz-models}"
WORK="${WORK:-/var/data/workspace/viz}"

mkdir -p "$MODELS" "$WORK"

dev_args=(--device /dev/kfd --device /dev/dri)
[ "${NO_GPU:-0}" = "1" ] && dev_args=()

# The device nodes are owned by root:<render gid> with mode 0660. Running the
# container as the host user (so outputs are not root-owned) therefore needs the
# render gid added EXPLICITLY — rootful podman has no user namespace, so this is
# the host's real gid and the group actually matches. `keep-groups` is the
# rootless mechanism and does nothing here.
RENDER_GID="$(getent group render | cut -d: -f3)"

exec sudo -n podman run --rm \
  "${dev_args[@]}" \
  --group-add "${RENDER_GID}" \
  --security-opt seccomp=unconfined \
  --shm-size 8g \
  --user "$(id -u):$(id -g)" \
  --workdir /work \
  -v "${MODELS}:/models:z" \
  -v "${WORK}:/work:z" \
  "$IMAGE" "$@"
