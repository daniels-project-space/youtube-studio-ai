#!/usr/bin/env python3
"""Cut the foreground subject onto its own RGBA layer using the depth map.
alpha = feathered threshold on depth (near = subject). argv: orig depth out [lo hi blur]"""
import sys
from PIL import Image, ImageFilter
import numpy as np

orig = Image.open(sys.argv[1]).convert("RGB")
depth = Image.open(sys.argv[2]).convert("L").resize(orig.size)
out = sys.argv[3]
lo = float(sys.argv[4]) if len(sys.argv) > 4 else 0.55
hi = float(sys.argv[5]) if len(sys.argv) > 5 else 0.72
blur = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0

d = np.asarray(depth).astype(np.float32) / 255.0
a = np.clip((d - lo) / max(1e-3, (hi - lo)), 0, 1)
a = a * a * (3 - 2 * a)                       # smoothstep
alpha = Image.fromarray((a * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(blur))
rgba = orig.convert("RGBA")
rgba.putalpha(alpha)
rgba.save(out)
print("DONE", out)
