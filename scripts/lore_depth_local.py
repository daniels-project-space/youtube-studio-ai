#!/usr/bin/env python3
# Local monocular depth (Depth-Anything-V2-Small) — cloud depth APIs are down.
# Outputs a grayscale depth PNG per painting (bright = near), smoothed.
import sys
from PIL import Image, ImageFilter
from transformers import pipeline

pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
for path in sys.argv[1:]:
    img = Image.open(path).convert("RGB")
    out = path.replace("scene_", "depth_")
    small = img.copy()
    small.thumbnail((896, 896))
    res = pipe(small)
    d = res["depth"].convert("L").resize(img.size, Image.BILINEAR)
    d = d.filter(ImageFilter.GaussianBlur(2.2))
    d.save(out)
    print("depth ->", out, d.size, "range", d.getextrema())
