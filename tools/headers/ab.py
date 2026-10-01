#!/usr/bin/env python3
"""tools/headers/ab.py — A/B probe for a single question: is the gestural hand
(the Shinkawa half of the style) being drowned out by the prompt's own wording?

Renders the SAME brief at the SAME seed under two prompt arrangements:

  A  baseline — the live composition from prompts.mjs (hand clause mid-prompt)
  B  hand-first — the gestural clause moved to the front, repeated, and the
     engraving vocabulary the LLM volunteered ("engraved line", "like a plate")
     stripped out of the subject text

If B shows gesture where A shows only even technical linework, the hand was
losing a CONTEST, not failing a capability. That is a prompt-assembly bug and
fixable. If both look identical, SDXL base simply cannot hold it and the answer
is a LoRA.

Writes /var/data/workspace/viz/ab/<slug>-{a,b}.png.
"""
import json, sys, time, urllib.request, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMFY = "http://127.0.0.1:8188"
OUT = Path("/var/data/workspace/viz/ab")

style = json.loads((HERE / "style.json").read_text())
briefs = json.loads((HERE / "briefs.json").read_text())

# The gestural half, stated as what it IS rather than as one clause in a list.
GESTURE = ("loose sumi-e brush pen sketch, bold dry-brush strokes with visible "
           "speed, heavy black ink masses, extreme black-and-white contrast, "
           "sharp angular silhouette, ragged brush edges, splatter and drips, "
           "large areas of pure white paper, unfinished and confident")

# Vocabulary that pulls toward technical engraving. Stripped in variant B.
ENGRAVING = ["dense engraved line", "engraved like a plate", "engraved",
             "dense engraved", "fine engraved", "drawn in dense"]


def strip_engraving(text: str) -> str:
    for term in ENGRAVING:
        text = text.replace(term, "")
    return " ".join(text.split())


def variants(slug):
    b = briefs[slug]
    subject = ", ".join([b["emblem"]] + list(b.get("symbols", [])))
    neg = b["negative"]
    a = b["prompt"]
    b_prompt = ", ".join([
        style["prompt"]["prefix"],
        GESTURE,                      # hand FIRST, not buried mid-list
        strip_engraving(subject),
        strip_engraving(b["composition"]),
        GESTURE,                      # and repeated at the end
        f"single oxblood red accent on {b['accent']}",
        "no border, no frame",
    ]).replace(", ,", ",")
    return {"a": a, "b": b_prompt}, neg, b["seed"]


def submit(prompt, neg, seed):
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": style["model"]["checkpoint"]}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": style["composition"]["width"],
                         "height": style["composition"]["height"], "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": seed % (2 ** 31), "steps": 30, "cfg": 6.5,
                         "sampler_name": "dpmpp_2m", "scheduler": "karras",
                         "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0],
                         "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ab/x", "images": ["8", 0]}},
    }
    req = urllib.request.Request(COMFY + "/prompt",
                                 data=json.dumps({"prompt": wf}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["prompt_id"]


def wait(pid, timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=30) as r:
            h = json.loads(r.read() or b"{}")
        if pid in h:
            for o in h[pid].get("outputs", {}).values():
                for i in o.get("images", []):
                    return i
            raise RuntimeError("no image")
        time.sleep(2)
    raise TimeoutError(pid)


def fetch(img, dest):
    q = urllib.parse.urlencode({"filename": img["filename"],
                                "subfolder": img.get("subfolder", ""),
                                "type": img.get("type", "output")})
    with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as r:
        dest.write_bytes(r.read())


if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "meditation-harm"
    OUT.mkdir(parents=True, exist_ok=True)
    prompts, neg, seed = variants(slug)
    for name, p in prompts.items():
        t0 = time.time()
        img = wait(submit(p, neg, seed))
        dest = OUT / f"{slug}-{name}.png"
        fetch(img, dest)
        print(f"{name}: {dest.name}  {time.time() - t0:.0f}s  ({len(p.split())} words)")
    print("A words:", len(prompts['a'].split()), "| B words:", len(prompts['b'].split()))
