#!/usr/bin/env python3
# True whiteboard write-on: trace the actual ink into a pen trajectory (skeleton,
# ordered stroke-by-stroke) and reveal the REAL pixels as the hand passes over
# them. No vectorizer, no video model. Deterministic, $0 credits.
import sys, os, json, subprocess
import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize
from skimage.measure import label
from skimage.segmentation import clear_border

still_path, out_path, hand_path = sys.argv[1], sys.argv[2], sys.argv[3]
duration = float(sys.argv[4]); fps = int(sys.argv[5])
# frame_mode: "draw" = hand draws the board outline first (use on panel 0);
# "static" = the frame is already there as a persistent frame (panels 1+);
# "none" = no frame.
frame_mode = sys.argv[6] if len(sys.argv) > 6 else "static"
W, H = 1280, 720
BOARD = (243, 241, 235)
FRAME_COLOR = (62, 62, 68)

def frame_mask(w, h):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([20, 20, w - 21, h - 21], radius=30, outline=255, width=5)
    return np.asarray(m) > 0
FRAME = frame_mask(W, H)

img = np.asarray(Image.open(still_path).convert("RGB").resize((W, H))).astype(np.int16)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
gray = 0.299 * r + 0.587 * g + 0.114 * b
black = gray < 170
red = (r > 110) & (g < 110) & (b < 110)
ink = black | red                                   # the marks to "draw"
ink = clear_border(ink)                             # drop the still's own frame / outer shadow
if frame_mode == "draw":                            # panel 0: the pen draws the board outline first
    ink = ink | FRAME
    img[FRAME] = np.array(FRAME_COLOR)

# 1. skeleton → 1px centerlines = the pen path
skel = skeletonize(ink)
lab = label(skel, connectivity=2)

def walk(pts):
    """Greedy nearest-neighbour walk from the topmost-leftmost point."""
    pts = list(map(tuple, pts))
    cur = min(pts, key=lambda p: (p[1], p[0]))
    pts.remove(cur); order = [cur]
    while pts:
        a = np.array(pts)
        i = int(((a[:, 0] - cur[0]) ** 2 + (a[:, 1] - cur[1]) ** 2).argmin())
        cur = tuple(a[i]); order.append(cur); pts.pop(i)
    return order

# 2. one ordered trajectory: each connected stroke drawn fully, strokes top→bottom
comps = {}
ys, xs = np.where(skel)
for y, x in zip(ys, xs):
    comps.setdefault(int(lab[y, x]), []).append((int(x), int(y)))
ordered_comps = sorted(comps.values(), key=lambda c: (min(p[1] for p in c), min(p[0] for p in c)))
traj = []
for c in ordered_comps:
    traj.extend(walk(c))
traj = np.array(traj)                                # N x 2 (x,y), pen path
N = len(traj)

# 3. every ink pixel gets the trajectory index of its nearest pen point → reveal order
try:
    from scipy.spatial import cKDTree
    iy, ix = np.where(ink)
    _, nn = cKDTree(traj).query(np.column_stack([ix, iy]), k=1)
except Exception:
    iy, ix = np.where(ink); nn = np.zeros(len(iy))
order_norm = nn.astype(np.float32) / max(N - 1, 1)

# 4. hand sprite (green-keyed → alpha)
hand = Image.open(hand_path).convert("RGB")
hand = hand.resize((int(hand.width * 480 / hand.height), 480))
ha = np.asarray(hand).astype(np.int16)
alpha = (~((ha[..., 1] > 100) & (ha[..., 0] < 120) & (ha[..., 2] < 120))).astype(np.uint8) * 255
hand_img = Image.fromarray(np.dstack([np.asarray(hand).astype(np.uint8), alpha]), "RGBA")
# auto-locate the marker NIB: darkest (marker) pixels, extreme toward upper-left
hgray = 0.299 * ha[..., 0] + 0.587 * ha[..., 1] + 0.114 * ha[..., 2]
marker = (alpha > 0) & (hgray < 70)
my, mx = np.where(marker)
if len(mx) > 20:
    nib = np.argsort(mx + my)[:15]                  # 15 most upper-left marker pixels
    TIPX, TIPY = int(mx[nib].mean()), int(my[nib].mean())
else:
    TIPX, TIPY = int(hand_img.width * 0.32), int(hand_img.height * 0.09)

# 5. render frames: reveal ink up to progress p, hand pinned to the live pen point
frames = out_path + "_frames"; os.makedirs(frames, exist_ok=True)
nf = int(duration * fps)
base = np.empty((H, W, 3), np.uint8); base[:] = BOARD
if frame_mode == "static":                          # panels 1+: persistent frame, already there
    base[FRAME] = FRAME_COLOR
for f in range(nf):
    p = (f + 1) / nf
    canvas = base.copy()
    show = order_norm <= p
    canvas[iy[show], ix[show]] = img[iy[show], ix[show]].astype(np.uint8)
    frame = Image.fromarray(canvas, "RGB")
    k = min(int(p * N), N - 1)
    frame.paste(hand_img, (int(traj[k, 0]) - TIPX, int(traj[k, 1]) - TIPY), hand_img)
    frame.save(os.path.join(frames, f"{f:04d}.png"))

subprocess.run(["ffmpeg", "-y", "-framerate", str(fps), "-i", os.path.join(frames, "%04d.png"),
                "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", out_path], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(json.dumps({"out": out_path, "frames": nf, "trajPts": int(N)}))
