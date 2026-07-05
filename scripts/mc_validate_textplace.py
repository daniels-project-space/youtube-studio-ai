#!/usr/bin/env python3
# Standalone validation: for every speech bubble in the truce render, compare the
# OLD placement (the LLM vision anchor) vs the NEW deterministic detail-map box.
# Metric = mean image-detail UNDER the bubble (lower = sits on emptier space = less
# overlap with faces/objects). Emits a per-bubble table + side-by-side images
# (RED=old, GREEN=new, yellow dot=mouth). No full render needed.
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw
from mc_textplace import detail_map, bubble_size, best_box, box_detail

RUN = sys.argv[1]
OUTD = sys.argv[2] if len(sys.argv) > 2 else RUN
os.makedirs(OUTD, exist_ok=True)
plan = json.load(open(os.path.join(RUN, "plan.json")))
chars = {c["id"]: c["name"] for c in plan["characters"]}

rows = []
for i, panel in enumerate(plan["panels"]):
    pj = os.path.join(RUN, f"panel_{i}.png"); vj = os.path.join(RUN, f"vision_{i}.json")
    if not (os.path.exists(pj) and os.path.exists(vj)):
        continue
    vis = json.load(open(vj))
    if not vis.get("anchors"):
        continue
    img = np.asarray(Image.open(pj).convert("RGB")); H, W = img.shape[:2]
    det = detail_map(img)
    canvas = Image.fromarray(img.copy()); dr = ImageDraw.Draw(canvas)
    drew = False
    for li in panel["lines"]:
        cid = li["speaker"]
        if cid == "narrator" or cid not in vis["anchors"]:
            continue
        a = vis["anchors"][cid]
        text = li["text"].replace("[", "").split("]")[-1].strip() if "]" in li["text"] else li["text"]
        bw, bh = bubble_size(text, W * 0.92, H)
        bw = min(bw, int(W * 0.7)); bh = min(bh, int(H * 0.5))
        mouth = (a["mouth"][0] * W, a["mouth"][1] * H) if a.get("mouth") else None
        # OLD = vision anchor center
        old = None
        if a.get("anchor"):
            ox = int(min(max(a["anchor"][0] * W - bw / 2, 0), W - bw))
            oy = int(min(max(a["anchor"][1] * H - bh / 2, 0), H - bh))
            old = (ox, oy)
        # NEW = detail-map
        (nx, ny), nd = best_box(det, bw, bh, mouth)
        od = box_detail(det, *old, bw, bh) if old else None
        rows.append((i, chars.get(cid, cid), od, nd))
        if old:
            dr.rectangle([old[0], old[1], old[0] + bw, old[1] + bh], outline=(235, 40, 40), width=6)
        dr.rectangle([nx, ny, nx + bw, ny + bh], outline=(40, 220, 90), width=6)
        if mouth:
            dr.ellipse([mouth[0] - 9, mouth[1] - 9, mouth[0] + 9, mouth[1] + 9], fill=(255, 215, 0), outline=(0, 0, 0))
        drew = True
    if drew:
        canvas.save(os.path.join(OUTD, f"cmp_{i}.png"))

print(f"{'panel':>5}  {'speaker':<10} {'old_detail':>10} {'new_detail':>10}  {'less detail':>11}")
imp = []
for (i, nm, od, nd) in rows:
    if od is None:
        print(f"{i:>5}  {nm:<10} {'(no old)':>10} {nd:>10.3f}")
        continue
    pct = 100 * (od - nd) / max(od, 1e-6); imp.append(pct)
    print(f"{i:>5}  {nm:<10} {od:>10.3f} {nd:>10.3f}  {pct:>+10.0f}%")
if imp:
    print(f"\nNEW bubbles sit on {np.mean(imp):+.0f}% less detail on average "
          f"({sum(1 for p in imp if p > 0)}/{len(imp)} bubbles improved).")
