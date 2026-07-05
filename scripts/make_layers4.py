#!/usr/bin/env python3
"""Cut a scene into N WHOLE depth-band layers using thresholds chosen at the GAPS between
objects, so each object stays entirely on one layer (no tearing). argv: orig depth outdir
"tA,tB,tC" (high->low) [xmax]. Outputs L3 (nearest) .. L1; the clean fresh back.png is the far layer."""
import sys
import numpy as np
from PIL import Image, ImageFilter

orig = Image.open(sys.argv[1]).convert("RGB")
orig = orig.resize((1500, round(1500 * orig.size[1] / orig.size[0])))   # match bg slices, save memory
d = np.asarray(Image.open(sys.argv[2]).convert("L").resize(orig.size)).astype(np.float32) / 255.0
outdir = sys.argv[3]
ths = [float(x) for x in sys.argv[4].split(",")]            # e.g. "0.70,0.45,0.25"
xmax = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
H, W = d.shape
xx = np.tile(np.linspace(0, 1, W)[None, :], (H, 1))

def ss(lo, hi, x):
    t = np.clip((x - lo) / max(1e-4, hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

xm = 1 - ss(xmax, min(1.0, xmax + 0.06), xx) if xmax < 0.999 else np.ones_like(d)

def save(alpha, name):
    a = Image.fromarray((np.clip(alpha * xm, 0, 1) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(3))
    im = orig.convert("RGBA"); im.putalpha(a); im.save(f"{outdir}/{name}.png")

f = 0.05
save(ss(ths[0], ths[0] + f, d), "L3")                                       # nearest object
save(ss(ths[1], ths[1] + f, d) * (1 - ss(ths[0], ths[0] + f, d)), "L2")     # next
save(ss(ths[2], ths[2] + f, d) * (1 - ss(ths[1], ths[1] + f, d)), "L1")     # mid architecture
print("DONE layers4", outdir)
