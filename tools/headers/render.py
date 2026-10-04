#!/usr/bin/env python3
"""tools/headers/render.py — stage 2: run each brief through ComfyUI.

Talks to a running ComfyUI server over its HTTP API (no python deps, so it runs
from the host as well as inside the container). One SDXL text-to-image graph,
the same graph for every post — everything that varies is already in the prompt
and the seed that prompts.mjs produced.

The seed is fixed per slug, so a post renders the same frame every time and a
regeneration is a real comparison rather than a new roll.

Resumable: the manifest is written after EVERY image, and a slug whose brief and
settings are unchanged is skipped, so an interrupted batch costs only what was
still in flight.

    python3 tools/headers/render.py                # start ComfyUI if needed, render, stop it
    python3 tools/headers/render.py --keep         # ... but leave ComfyUI running after
    python3 tools/headers/render.py --only <slug>
    python3 tools/headers/render.py --force

If ComfyUI is not already reachable, render.py launches it (run.sh) and owns it:
it stops the container when the batch ends so an idle server is not left pinning
VRAM. A server that was already up when render.py started is left running.

--backend seedream swaps the local SDXL graph for a hosted ByteDance Seedream
call (DeepInfra's partner endpoint, through the proxy that holds the key), so it
starts no container and takes no seed — the server picks one.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
# Second backend. The partner inference endpoint is not the OpenAI-compatible
# one: it takes an explicit WxH size (the OpenAI route rejects size tiers) and
# returns temporary URLs rather than inline bytes. The proxy box holds the
# DeepInfra key, so requests from this host need no auth header of their own.
DEEPINFRA_URL = os.environ.get("DEEPINFRA_URL", "http://10.0.0.1:8322")
SEEDREAM_MODEL = os.environ.get("SEEDREAM_MODEL", "ByteDance/Seedream-5.0-Pro")
OUT = ROOT / "content" / "headers"
MANIFEST = HERE / "renders.json"

# Sampling settings are part of the house style and live in style.json; these
# are the fallbacks if the render block is absent.
DEFAULTS = {"steps": 30, "cfg": 6.5, "sampler": "dpmpp_2m", "scheduler": "karras"}


def post(path, payload, timeout=60):
    req = urllib.request.Request(
        COMFY + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def get(path, timeout=60):
    with urllib.request.urlopen(COMFY + path, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def wait_up(deadline=180):
    """ComfyUI takes a while to import torch and build its node graph."""
    t0 = time.time()
    while time.time() - t0 < deadline:
        try:
            get("/system_stats", timeout=5)
            return True
        except Exception:
            time.sleep(3)
    return False


def comfy_up():
    """Is a ComfyUI already reachable at COMFY? One quick probe, no waiting."""
    try:
        get("/system_stats", timeout=5)
        return True
    except Exception:
        return False


def reroll_of(renders, slug):
    """The seed offset already recorded for a slug, so a full sweep does not
    silently undo a frame that was hand-picked with --reroll."""
    return renders.get(slug, {}).get("reroll", 0)


def workflow(brief, style, ckpt):
    c = style["composition"]
    r = style.get("render", DEFAULTS)
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": c["width"], "height": c["height"], "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": brief["prompt"], "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": brief["negative"], "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": brief["seed"] % (2 ** 31), "steps": r["steps"],
                         "cfg": r["cfg"], "sampler_name": r["sampler"],
                         "scheduler": r["scheduler"], "denoise": 1.0,
                         "model": ["4", 0], "positive": ["6", 0],
                         "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"filename_prefix": f"hdr/{brief['slug']}", "images": ["8", 0]}},
    }


def render_one(slug, brief, style, ckpt):
    """Submit one job and block until the image is written."""
    pid = post("/prompt", {"prompt": workflow(brief, style, ckpt)})["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < 1800:                      # generous: CPU offload is slow
        hist = get(f"/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error" or not status.get("completed", True):
                raise RuntimeError(f"comfy error: {json.dumps(status)[:400]}")
            images = [i for o in entry.get("outputs", {}).values() for i in o.get("images", [])]
            if images:
                return images[0]
            raise RuntimeError("job finished with no image")
        time.sleep(2)
    raise TimeoutError("render timed out after 30min")


def fetch(image, dest):
    q = urllib.parse.urlencode(
        {"filename": image["filename"], "subfolder": image.get("subfolder", ""),
         "type": image.get("type", "output")})
    with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as r:
        dest.write_bytes(r.read())


def seedream_render(brief, style, dest):
    """One hosted Seedream call, image written to dest.

    Returns the seed the server chose: the request has no field for one, so a
    Seedream frame is not reproducible the way an SDXL one is. Seedream also has
    no negative prompt — brief['negative'] is deliberately not sent, since a
    banished term handed to this model comes back as a posited object.
    """
    c = style["composition"]
    payload = {
        # The seedream prompt is composed for the no-negative, long-instruction
        # model; the stored prompt is the SDXL keyword assembly, which Seedream
        # reads as a list of nouns in the wrong order.
        "prompt": brief.get("seedream_prompt") or brief["prompt"],
        # An explicit WxH from style.json, not a '1K'/'2K' tier: the tiers keep
        # their own aspect (2K costs more) and would override the house ratio.
        "size": f"{c['width']}x{c['height']}",
        "output_format": "png",
        "optimize_prompt_mode": "standard",
    }
    req = urllib.request.Request(
        f"{DEEPINFRA_URL}/v1/inference/{SEEDREAM_MODEL}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    # ~60s measured; 300s so a queued request is not aborted at the proxy.
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        # str(HTTPError) omits the body, which is where the endpoint's own
        # validation message lives.
        raise RuntimeError(
            f"seedream http {e.code}: {e.read()[:400].decode(errors='replace')}") from None
    images = body.get("images") or []
    if not images:
        raise RuntimeError(f"seedream returned no image: {json.dumps(body)[:400]}")
    # Temporary signed URL (~24h), not bytes: download it now or lose the frame.
    try:
        with urllib.request.urlopen(images[0], timeout=300) as r:
            dest.write_bytes(r.read())
    except urllib.error.HTTPError as e:
        # same as the inference call: str(HTTPError) omits the body, and an
        # expired signed URL is just a bare 403 without it.
        raise RuntimeError(
            f"seedream download http {e.code}: {e.read()[:400].decode(errors='replace')}"
        ) from None
    return body.get("seed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append",
                    help="restrict to these slugs; repeatable, or comma-separated")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--reroll", type=int,
                    help="offset the per-slug seed (N*7919); re-rolls a stray while "
                         "staying reproducible")
    ap.add_argument("--start", action="store_true",
                    help="accepted for compatibility; starting ComfyUI when "
                         "needed is now the default")
    ap.add_argument("--keep", action="store_true",
                    help="leave ComfyUI running after the batch (old behaviour)")
    ap.add_argument("--adopt", action="store_true",
                    help="record the PNGs already on disk as current, without "
                         "rendering — for when files were restored or hand-picked")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--backend", choices=("sdxl", "seedream"), default="sdxl",
                    help="sdxl (default) renders locally through ComfyUI; "
                         "seedream calls the hosted ByteDance model instead")
    args = ap.parse_args()

    if args.backend == "seedream" and args.reroll is not None:
        print("  --reroll has no effect on seedream: the server chooses the seed")

    style = json.loads((HERE / "style.json").read_text())
    briefs = json.loads((HERE / "briefs.json").read_text())
    ckpt = style["model"]["checkpoint"]
    renders = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    only = [s for a in (args.only or []) for s in a.split(",") if s]
    slugs = only or sorted(briefs)
    if args.limit:
        slugs = slugs[: args.limit]
    OUT.mkdir(parents=True, exist_ok=True)

    todo = []
    for slug in slugs:
        if slug not in briefs:
            print(f"  no brief for {slug}, skipping")
            continue
        b = dict(briefs[slug], slug=slug)
        # A stray gets a second roll, not a second prompt: the brief was right,
        # the sampler picked a bad basin. A reroll that is not asked for is
        # reused from the manifest, so a later full sweep does not silently
        # undo a hand-picked frame.
        reroll = args.reroll if args.reroll is not None else reroll_of(renders, slug)
        b["seed"] = b["seed"] + reroll * 7919
        # The prompt and the seed are in the key: editing the prompt anywhere
        # upstream must invalidate the render, or a stale PNG silently survives
        # a style change (which is exactly what happened to this batch).
        # The key also carries the backend, so an SDXL PNG and a Seedream PNG
        # for the same slug cannot be mistaken for each other. Seedream hashes
        # the prompt alone: we do not send the negative, and the seed is the
        # server's, so hashing either would invalidate a cached PNG for a change
        # that never reached the model.
        if args.backend == "seedream":
            sig = b.get("seedream_prompt") or b["prompt"]
            # style.seedream.version, not style.version: tuning the seedream
            # layer must invalidate seedream renders without touching any SDXL key.
            sd_version = (style.get("seedream") or {}).get("version") or style.get("version")
            ident = f"seedream|{SEEDREAM_MODEL}|{sd_version}"
        else:
            sig = f"{b['prompt']}|{b['negative']}|{b['seed']}"
            ident = f"{style['model']['checkpoint']}|{style.get('version')}"
        key = (f"{b['input_hash']}|{ident}"
               f"|{hashlib.sha256(sig.encode()).hexdigest()[:12]}")
        dest = OUT / f"{slug}.png"
        if not args.force and renders.get(slug, {}).get("key") == key and dest.exists():
            continue
        todo.append((slug, b, key, dest))

    target = (COMFY if args.backend == "sdxl"
              else f"{DEEPINFRA_URL}/v1/inference/{SEEDREAM_MODEL}")
    print(f"{len(slugs)} posts, {len(todo)} to render via {target}")

    # Empty work is a no-op: never start a container (or stop one) for nothing.
    if not todo and not args.adopt:
        return

    if args.adopt:
        # The PNG on disk is the deliverable and the manifest is its cache. When
        # a frame was hand-picked or restored from a backup, the honest move is
        # to record what is actually there rather than re-render to make the
        # bookkeeping true.
        n = 0
        for slug, b, key, dest in todo:
            if not dest.exists():
                print(f"  no {dest.name} on disk, cannot adopt")
                continue
            # Adopting records a PNG we did not render. On seedream there is no
            # seed to attribute at all, so the entry must not borrow SDXL's
            # per-slug seed and claim a frame we never had a say in.
            meta = ({"seed": None, "seed_source": "unreported", "backend": "seedream",
                     "model": SEEDREAM_MODEL} if args.backend == "seedream" else
                    {"seed": b["seed"] % (2 ** 31), "reroll": reroll_of(renders, slug)})
            renders[slug] = {"key": key, "file": str(dest.relative_to(ROOT)),
                             "emblem": b.get("emblem"), "adopted": True, **meta}
            n += 1
        MANIFEST.write_text(json.dumps(renders, indent=2, sort_keys=True) + "\n")
        print(f"adopted {n} existing renders")
        return

    started_us = False
    try:
        # Seedream is a remote call: it has no container to start, wait for, or
        # stop, and touching one would pin VRAM for a batch that never uses it.
        if args.backend == "sdxl" and not comfy_up():
            print("starting ComfyUI...")
            # see run.sh — the container is rootful, which is what grants /dev/kfd
            subprocess.Popen([str(HERE / "run.sh")])
            started_us = True
            if not wait_up():
                sys.exit(f"ComfyUI not reachable at {COMFY}")

        done = failed = 0
        for slug, b, key, dest in todo:
            t0 = time.time()
            try:
                if args.backend == "seedream":
                    # The seed is provenance here, not a setting: nothing in the
                    # request fixes it, so it is recorded as the server's — and
                    # as unreported when the response carries none, which the
                    # live endpoint has done even though out_schema requires it.
                    seed = seedream_render(b, style, dest)
                    meta = {"seed": seed,
                            "seed_source": "server" if seed is not None else "unreported",
                            "backend": "seedream", "model": SEEDREAM_MODEL}
                else:
                    fetch(render_one(slug, b, style, ckpt), dest)
                    meta = {"seed": b["seed"] % (2 ** 31), "reroll": reroll}
                renders[slug] = {"key": key, "file": str(dest.relative_to(ROOT)),
                                 "emblem": b.get("emblem"),
                                 "seconds": round(time.time() - t0, 1), **meta}
                done += 1
                print(f"  [{done + failed}/{len(todo)}] {slug}  {time.time() - t0:.0f}s  "
                      f"({b.get('emblem')})")
            except Exception as e:
                failed += 1
                renders.setdefault(slug, {})["error"] = str(e)[:300]
                print(f"  [{done + failed}/{len(todo)}] FAILED {slug}: {e}")
            # written every iteration: a killed batch keeps what it earned
            MANIFEST.write_text(json.dumps(renders, indent=2, sort_keys=True) + "\n")

        print(f"rendered {done}, failed {failed} -> {OUT}")

        # Stage 3: derive the social card from what was just rendered. Pillow only
        # exists in the container, so this shells out rather than importing.
        if done:
            here = Path(__file__).resolve().parent
            subprocess.run(
                [str(here / "postprocess.sh")] + [s for s, *_ in todo],
                check=False,
            )
    finally:
        # Stop only what we started: an idle server holds VRAM for nothing, but
        # one that was already running belongs to whoever launched it. --keep
        # opts back into leaving it up. finally, so a render failure, an
        # unhandled exception, or Ctrl-C still tears it down.
        if args.backend == "sdxl" and started_us and not args.keep:
            print("stopping ComfyUI...")
            subprocess.run([str(HERE / "stop.sh")], check=False)

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (only needed by fetch)
    main()
