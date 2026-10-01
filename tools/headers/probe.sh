#!/usr/bin/env bash
# tools/headers/probe.sh — the gate the whole pipeline rests on: is the RX 9070
# actually usable by PyTorch inside the container?
#
# Run it through the wrapper:   tools/headers/gpu.sh /opt/probe.sh
#
# It checks three separate things, because they fail independently and only the
# third one actually matters:
#   1. the device nodes were passed through,
#   2. ROCm can open /dev/kfd (a permissions problem, not a hardware one),
#   3. the PyTorch wheel was compiled WITH gfx1201 kernels — the check that
#      catches AMD's CDNA-only builds, which pass (1) and (2) and then fail on
#      every kernel launch.
set -uo pipefail
rc=0

echo "=== 1. devices passed through ==="
ls -l /dev/kfd /dev/dri/renderD* 2>&1 || rc=1

echo "=== 2. can ROCm open /dev/kfd ==="
if (exec 3<>/dev/kfd) 2>/dev/null; then
  echo "ok: /dev/kfd is readable+writable"
else
  echo "FAIL: /dev/kfd not openable (rootless podman cannot grant the host render gid; use rootful)"
  rc=1
fi

echo "=== 3. PyTorch arch support ==="
python3 - <<'PY'
import sys
try:
    import torch
except Exception as e:
    print("FAIL: torch import:", e); sys.exit(1)

print("torch        ", torch.__version__)
print("hip          ", getattr(torch.version, "hip", None))

flags = ""
try:
    flags = torch._C._cuda_getArchFlags()
except Exception as e:
    print("arch flags   unavailable:", e)
print("arch flags   ", flags)

if "gfx120" in flags or "gfx1201" in flags:
    print("ok: wheel has gfx1201 (RDNA4) kernels")
elif flags:
    print(f"FAIL: wheel is built for [{flags}] only — no gfx1201. "
          "This is an Instinct/CDNA build; every kernel launch will fail.")
    sys.exit(1)
else:
    print("WARN: no arch flags reported; cannot confirm gfx1201 statically")

print("available    ", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device       ", torch.cuda.get_device_name(0))
    try:
        a = torch.randn(512, 512, device="cuda")
        b = a @ a
        torch.cuda.synchronize()
        print("matmul       ok", tuple(b.shape), float(b.sum()))
    except Exception as e:
        print("FAIL matmul  ", e); sys.exit(1)
else:
    print("FAIL: torch.cuda.is_available() is False")
    sys.exit(1)
PY
[ $? -ne 0 ] && rc=1

echo "=== done (rc=$rc) ==="
exit $rc
