#!/usr/bin/env python3
"""Slice the CLEAN background (no figures, so nothing tears) into N depth planes for a rich
multi-layer pull-back. bg0 = full opaque base (always fills frame); bg1..bg{N-1} = depth bands.
argv: bg bg_depth outdir N"""
import sys
import numpy as np
from PIL import Image, ImageFilter

bg = Image.open(sys.argv[1]).convert("RGB")
bg = bg.resize((1500, round(1500 * bg.size[1] / bg.size[0])))   # keep texture memory sane with many layers
d = np.asarray(Image.open(sys.argv[2]).convert("L").resize(bg.size)).astype(np.float32) / 255.0
outdir = sys.argv[3]
N = int(sys.argv[4])

def ss(lo, hi, x):
    t = np.clip((x - lo) / max(1e-4, hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

bg.convert("RGBA").save(f"{outdir}/bg0.png")          # opaque base, fills the frame
edges = np.linspace(0.0, 1.0, N)
for i in range(1, N):
    lo, hi = edges[i - 1], edges[i]
    a = ss(lo, lo + 0.05, d) * (1 - ss(hi - 0.05, hi, d))
    al = Image.fromarray((np.clip(a, 0, 1) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(4))
    im = bg.convert("RGBA"); im.putalpha(al); im.save(f"{outdir}/bg{i}.png")
print("DONE bgslices", N)
