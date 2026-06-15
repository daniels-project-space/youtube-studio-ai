#!/usr/bin/env python3
# mc_key_hand.py <src.png> <out.png>  — chroma-key the green screen from the hand
# photo into a clean RGBA cutout (with green-spill removal + feathered edge).
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, binary_dilation, gaussian_filter

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
# green = clearly more green than red/blue
green = (g > 90) & (g - r > 28) & (g - b > 28)
keep = ~green
keep = binary_erosion(keep, iterations=1)          # bite into the edge to drop green fringe
keep = binary_dilation(keep, iterations=1)
alpha = gaussian_filter((keep * 255).astype(np.uint8), 0.8)
# de-spill: pull green channel down toward the r/b average where it's bloomed
rgb = np.asarray(im).astype(np.uint8).copy()
lim = ((rgb[..., 0].astype(np.int16) + rgb[..., 2].astype(np.int16)) // 2 + 12)
gch = rgb[..., 1].astype(np.int16)
rgb[..., 1] = np.where(gch > lim, lim, gch).astype(np.uint8)
Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(out)
# detect the pen NIB (tip) = the up-left-most dark/black pixels of the marker, so
# the caller can anchor the sprite there.
H, W = alpha.shape
op = alpha > 128
dark = (np.asarray(im).astype(np.int16).sum(2) < 140) & op
ys, xs = np.where(dark)
if len(xs) > 10:
    sel = np.argsort(xs + ys)[:max(8, len(xs) // 60)]
    nx, ny = float(xs[sel].mean()) / W, float(ys[sel].mean()) / H
    print(f"wrote {out} opaque={int(op.sum())} NIB nx={nx:.3f} ny={ny:.3f} center=({nx:.3f},{1 - ny:.3f})")
else:
    print(f"wrote {out} opaque={int(op.sum())} (no nib found)")
