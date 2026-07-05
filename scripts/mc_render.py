#!/usr/bin/env python3
# mc_render.py <timeline.json> <runDir> <out.mp4>
# Deterministic motion-comic camera: an eased Ken-Burns viewport (push/pull/pan)
# over each panel for its audio duration, hard-cut with a short white flash.
# Frames are PIPED straight to ffmpeg (no PNGs on disk) and resampled BILINEAR,
# so it stays fast even on a loaded box.
import sys
import os
import json
import subprocess
import numpy as np
from PIL import Image

timeline_path, run_dir, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
TL = json.load(open(timeline_path))
W, H, FPS = TL["width"], TL["height"], TL.get("fps", 30)
panels = TL["panels"]


def smoothstep(t):
    return t * t * (3 - 2 * t)


def cam_keys(kind):
    z0, z1, sx, sy, ex, ey = 1.06, 1.06, 0.5, 0.5, 0.5, 0.5
    if kind == "push_in":
        z0, z1 = 1.02, 1.18
    elif kind == "pull_out":
        z0, z1 = 1.18, 1.02
    elif kind == "pan_left":
        z0 = z1 = 1.12; sx, ex = 0.62, 0.38
    elif kind == "pan_right":
        z0 = z1 = 1.12; sx, ex = 0.38, 0.62
    elif kind == "pan_up":
        z0 = z1 = 1.12; sy, ey = 0.62, 0.40
    elif kind == "static":
        z0, z1 = 1.04, 1.08
    return z0, z1, sx, sy, ex, ey


def cover(im, w, h):
    iw, ih = im.size
    s = max(w / iw, h / ih)
    return im.resize((max(w, int(iw * s + 0.5)), max(h, int(ih * s + 0.5))), Image.BILINEAR)


def viewport(base, z, cx, cy):
    bw, bh = base.size
    vw, vh = W / z, H / z
    px, py = cx * bw, cy * bh
    x0 = min(max(px - vw / 2, 0), bw - vw)
    y0 = min(max(py - vh / 2, 0), bh - vh)
    crop = base.crop((int(x0), int(y0), int(x0 + vw), int(y0 + vh)))
    return crop.resize((W, H), Image.BILINEAR)


ff = subprocess.Popen(
    ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
     "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", out_path],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

total = 0
for pi, p in enumerate(panels):
    img_path = os.path.join(run_dir, p["img"])
    if not os.path.exists(img_path):
        continue
    im = Image.open(img_path).convert("RGB")
    base = cover(im, int(W * 1.25), int(H * 1.25))
    z0, z1, sx, sy, ex, ey = cam_keys(p.get("camera", "push_in"))
    nf = max(1, int(round(float(p["dur"]) * FPS)))
    for k in range(nf):
        t = smoothstep(k / max(1, nf - 1))
        frame = viewport(base, z0 + (z1 - z0) * t, sx + (ex - sx) * t, sy + (ey - sy) * t)
        if pi > 0 and k < 3:  # white flash on cut
            arr = np.asarray(frame).astype(np.float32)
            arr += (255 - arr) * (0.5 * (3 - k) / 3)
            ff.stdin.write(arr.clip(0, 255).astype(np.uint8).tobytes())
        else:
            ff.stdin.write(frame.tobytes())
    total += nf
    print(f"panel {pi}: {nf} frames ({p.get('camera')})", flush=True)

ff.stdin.close()
ff.wait()
print(f"wrote {out_path} ({total} frames)", flush=True)
