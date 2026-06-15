#!/usr/bin/env python3
# mc_crop_panels.py <mc3d_meta.json> <outdir>  — crop each panel (with its baked
# bubble) out of the page textures, for the vision validator to inspect.
import sys, json, os
from PIL import Image
meta = json.load(open(sys.argv[1])); outd = sys.argv[2]
rundir = os.path.dirname(os.path.abspath(sys.argv[1]))
os.makedirs(outd, exist_ok=True)
manifest = []
for pi, pg in enumerate(meta["pages"]):
    full = Image.open(os.path.join(rundir, f"page{pi}_full.png")).convert("RGB")
    for li, pm in enumerate(pg["panels"]):
        x, y, w, h = pm["box"]
        fn = f"crop_{pi}_{li}.png"
        full.crop((x, y, x + w, y + h)).save(os.path.join(outd, fn))
        manifest.append({"pi": pi, "li": li, "file": fn})
json.dump(manifest, open(os.path.join(outd, "crops.json"), "w"))
print(len(manifest), "crops ->", outd)
