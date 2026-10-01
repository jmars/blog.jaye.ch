# tools/headers/Dockerfile — ComfyUI on ROCm for the RX 9070 (gfx1201, RDNA4).
#
# WHY THIS IS HAND-BUILT. AMD publishes a prebuilt `rocm/comfyui` image, but it
# is a CDNA (Instinct) build: inside it, `torch._C._cuda_getArchFlags()` returns
# `gfx942 gfx950` (MI300/MI350) with no gfx1201 kernels, so the RX 9070 is
# detected and then every kernel launch fails. RDNA4 needs per-arch wheels, and
# AMD publishes them at the TheRock index below.
#
# The library and runtime are wheels, not packages, so the host stays untouched
# (it is openSUSE MicroOS — immutable anyway) and the container carries its own
# ROCm. Only the kernel driver (amdgpu + /dev/kfd) comes from the host.
#
# Built with ROOTFUL podman: rootless podman cannot hand a container the host's
# render/video gid, so /dev/kfd opens read-only ("root is not member of
# nogroup"). See gpu.sh for the invocation and the full note.

FROM docker.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    PYTORCH_TUNABLEOP_ENABLED=1 \
    PYTORCH_TUNABLEOP_TUNING_DURATION=short \
    FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE

# libgl1/libglib2.0-0 are needed by opencv, which ComfyUI imports even for
# image-only workflows; without them the server dies at startup on an import.
# libatomic1 is required by torch's HIP extension — the TheRock wheel links
# against it and the base image does not ship it, so `import torch` fails with
# "libatomic.so.1: cannot open shared object file".
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-pip \
      git curl ca-certificates ffmpeg libgl1 libglib2.0-0 libatomic1 \
 && rm -rf /var/lib/apt/lists/* \
 && python3.12 -m venv /opt/venv

ENV PATH=/opt/venv/bin:$PATH \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ROCm runtime + PyTorch, from AMD's TheRock per-arch index for gfx120X.
#
# Do NOT add the `rocm[libraries]` extra. It resolves to the entire ROCm SDK —
# devel tools, profilers and every library — and the build ballooned past 60GB
# and an hour without finishing. Plain `torch` pulls exactly what inference
# needs and nothing else: rocm-sdk-core (393MB) + rocm-sdk-libraries-gfx120X-all
# (738MB) + torch (332MB) + triton (329MB) — about 1.8GB of downloads, and the
# only ROCm that ends up in the image is the part torch actually links against.
RUN pip install --no-cache-dir \
      --index-url https://rocm.nightlies.amd.com/v2/gfx120X-all/ \
      torch torchvision triton

# ComfyUI itself. Its requirements pin torch, which the block above already
# satisfied from the ROCm index — installing them again would replace it with a
# CPU wheel, so torch is filtered out. Everything else is genuinely needed.
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI /opt/ComfyUI \
 && grep -viE '^\s*(torch|torchvision|torchaudio)\b' /opt/ComfyUI/requirements.txt > /tmp/req.txt \
 && pip install --no-cache-dir -r /tmp/req.txt

# ComfyUI's own model dirs point at the bind-mounted ZFS volume, so weights are
# never baked into the image.
RUN mkdir -p /models/checkpoints /models/vae /models/loras /models/hf

WORKDIR /opt/ComfyUI
EXPOSE 8188

# Self-check: fails loudly if the GPU is not visible or the wheel lacks gfx1201,
# rather than surfacing much later as a stalled render.
COPY probe.sh /opt/probe.sh
RUN chmod +x /opt/probe.sh

CMD ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
