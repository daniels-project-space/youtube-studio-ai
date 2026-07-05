#!/usr/bin/env python3
"""Decompose one scene+depth into 3 COMPLETE multiplane layers:
  front = everything nearer than t1 (whole foreground figures/elements — kept WHOLE so they don't tear)
  mid   = the depth band [t2,t1] (mid architecture)
  back  = the original with the (depth>t2) region heavily blurred away, so the far background is clean
          and the foreground figures don't ghost.
argv: orig depth outdir t1 t2 [feather blur]"""
import sys
import numpy as np
from PIL import Image, ImageFilter

orig = Image.open(sys.argv[1]).convert("RGB")
depth = Image.open(sys.argv[2]).convert("L").resize(orig.size)
outdir = sys.argv[3]
t1 = float(sys.argv[4]); t2 = float(sys.argv[5])
feather = float(sys.argv[6]) if len(sys.argv) > 6 else 3.0
blur = float(sys.argv[7]) if len(sys.argv) > 7 else 38.0
xmax = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0   # front/mid kept only where normalized x < xmax

d = np.asarray(depth).astype(np.float32) / 255.0
H, W = d.shape
xx = np.tile(np.linspace(0, 1, W)[None, :], (H, 1))

def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / max(1e-4, hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cutout(alpha_arr, name):
    a = Image.fromarray((np.clip(alpha_arr, 0, 1) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(feather))
    im = orig.convert("RGBA"); im.putalpha(a); im.save(f"{outdir}/{name}.png")

# optional spatial mask: keep front/mid only to the LEFT of xmax (excludes e.g. a back-subject on the right)
xm = 1 - smoothstep(xmax, min(1.0, xmax + 0.06), xx) if xmax < 0.999 else np.ones_like(d)
# front: everything nearer than t1 (whole)
cutout(smoothstep(t1, t1 + 0.05, d) * xm, "front")
# mid: band [t2, t1]
cutout(smoothstep(t2, t2 + 0.05, d) * (1 - smoothstep(t1, t1 + 0.05, d)) * xm, "mid")
# back: original, foreground region (depth>t2) replaced by a heavy blur of itself → soft far backdrop
blurred = orig.filter(ImageFilter.GaussianBlur(blur))
mask = smoothstep(t2 - 0.04, t2 + 0.06, d)               # 1 where foreground, 0 where far
m3 = np.repeat(mask[:, :, None], 3, axis=2)
back = (np.asarray(orig).astype(np.float32) * (1 - m3) + np.asarray(blurred).astype(np.float32) * m3).astype("uint8")
Image.fromarray(back).save(f"{outdir}/back_blur.png")   # fallback only; the fresh clean back.png is preferred
print("DONE layers", outdir)
