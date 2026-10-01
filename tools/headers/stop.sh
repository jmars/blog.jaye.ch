#!/usr/bin/env bash
# tools/headers/stop.sh — stop the ComfyUI container.
set -euo pipefail
NAME=comfyui-headers
sudo -n podman rm -f "$NAME" 2>/dev/null && echo "stopped $NAME" || echo "$NAME not running"
