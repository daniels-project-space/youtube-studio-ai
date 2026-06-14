#!/usr/bin/env python3
# Layered narration-synced whiteboard scribe. Each panel = a stack of LAYERS
# (composed art scenes + marker-font labels), drawn ONE AT A TIME in cue order,
# each with a minimum draw time (no pops), speed ~ ink amount, idle gaps between,
# and a guaranteed HOLD before the panel cuts. No segmentation. Muxes narration.
import sys, os, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize
from skimage.measure import label
from skimage.segmentation import clear_border
from scipy.spatial import cKDTree

TL = json.load(open(sys.argv[1])); OUT = sys.argv[2]; HAND_PATH = sys.argv[3]
DIR = TL["dir"]; FPS = int(TL.get("fps", 25))
W = int(os.environ.get("WB_W", TL.get("width", 1920))); H = int(os.environ.get("WB_H", TL.get("height", 1080)))
PRE = float(TL.get("prerollSec", 2.6))
FRAME_PRE = min(1.2, PRE * 0.5)                          # frame draws first, then the header
BOARD = (243, 241, 235); FRAME_COLOR = (62, 62, 68)
# pacing knobs (env-tunable)
MIN_DRAW = float(os.environ.get("WB_MIN_DRAW", 0.9))      # s — no element pops
MAX_DRAW = float(os.environ.get("WB_MAX_DRAW", 3.2))      # s
HOLD     = float(os.environ.get("WB_HOLD", 1.6))          # s — safety buffer before a panel clears
SPEED    = float(os.environ.get("WB_SPEED", 1400)) * (W * H) / (1280 * 720)  # ink px/s, scaled to resolution
FLOOR    = 0.5                                            # s — hard floor if a panel is overcrowded
MARKER = "public/fonts/PermanentMarker.ttf"
if not os.path.exists(MARKER): MARKER = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def frame_mask():
    m = Image.new("L", (W, H), 0); mg = int(W * 0.016); rad = int(W * 0.024); wd = max(4, int(W * 0.0042))
    ImageDraw.Draw(m).rounded_rectangle([mg, mg, W - 1 - mg, H - 1 - mg], radius=rad, outline=255, width=wd)
    return np.asarray(m) > 0
FRAME = frame_mask()

def walk(pts):
    pts = list(map(tuple, pts)); cur = min(pts, key=lambda p: (p[1], p[0])); pts.remove(cur); order = [cur]
    while pts:
        a = np.array(pts); i = int(((a[:, 0] - cur[0]) ** 2 + (a[:, 1] - cur[1]) ** 2).argmin())
        cur = tuple(a[i]); order.append(cur); pts.pop(i)
    return order

def trace(mask, reading=False):
    iy, ix = np.where(mask)
    if not len(iy): return iy, ix, np.zeros(0, np.float32), np.zeros((1, 2))
    skel = skeletonize(mask); lab = label(skel, connectivity=2); comps = {}
    sy, sx = np.where(skel)
    for y, x in zip(sy, sx): comps.setdefault(int(lab[y, x]), []).append((int(x), int(y)))
    items = list(comps.values())
    if reading:                                          # WORDS: left-to-right reading order, line by line
        hs = [max(p[1] for p in c) - min(p[1] for p in c) + 1 for c in items]
        lh = max(1.0, float(np.median(hs))) if hs else 1.0
        items.sort(key=lambda c: (round((sum(p[1] for p in c) / len(c)) / (lh * 0.9)), min(p[0] for p in c)))
    else:                                                # ART: top-to-bottom
        items.sort(key=lambda c: (min(p[1] for p in c), min(p[0] for p in c)))
    traj = []
    for c in items: traj.extend(walk(c))
    traj = np.array(traj) if traj else np.zeros((1, 2))
    if len(traj) > 1:
        _, nn = cKDTree(traj).query(np.column_stack([ix, iy])); order = nn.astype(np.float32) / max(len(traj) - 1, 1)
    else: order = np.zeros(len(iy), np.float32)
    return iy, ix, order, traj

# hand sprite + auto nib
HH = int(H * 0.64); hand = Image.open(HAND_PATH).convert("RGB"); hand = hand.resize((int(hand.width * HH / hand.height), HH))
ha = np.asarray(hand).astype(np.int16)
alpha = (~((ha[..., 1] > 100) & (ha[..., 0] < 120) & (ha[..., 2] < 120))).astype(np.uint8) * 255
hand_img = Image.fromarray(np.dstack([np.asarray(hand).astype(np.uint8), alpha]), "RGBA")
hgray = 0.299 * ha[..., 0] + 0.587 * ha[..., 1] + 0.114 * ha[..., 2]
my, mx = np.where((alpha > 0) & (hgray < 70))
if len(mx) > 20: nib = np.argsort(mx + my)[:15]; TIPX, TIPY = int(mx[nib].mean()), int(my[nib].mean())
else: TIPX, TIPY = int(hand_img.width * 0.32), int(hand_img.height * 0.09)

def box_px(box):
    x, y, w, h = box
    return int(x * W), int(y * H), max(8, int(w * W)), max(8, int(h * H))

def raster_art(path, box):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]; gray = 0.299 * r + 0.587 * g + 0.114 * b
    # NO clear_border here: layered art is on pure white (no frame) and routinely
    # spans edge-to-edge — clear_border would delete those figures (= half-drawn scenes).
    ink = (gray < 170) | ((r > 110) & (g < 110) & (b < 110))
    ys, xs = np.where(ink)
    if not len(xs): return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    ci = ink[y0:y1 + 1, x0:x1 + 1]; cr = im[y0:y1 + 1, x0:x1 + 1].astype(np.uint8)
    BX, BY, BW, BH = box_px(box); ch, cw = ci.shape
    s = min(BW / cw, BH / ch); nw, nh = max(1, int(cw * s)), max(1, int(ch * s))
    ink_r = np.asarray(Image.fromarray((ci * 255).astype(np.uint8)).resize((nw, nh), Image.NEAREST)) > 128
    rgb_r = np.asarray(Image.fromarray(cr).resize((nw, nh), Image.LANCZOS))
    ox = min(max(0, BX + (BW - nw) // 2), W - nw); oy = min(max(0, BY + (BH - nh) // 2), H - nh)
    m = np.zeros((H, W), bool); m[oy:oy + nh, ox:ox + nw] = ink_r
    col = np.zeros((H, W, 3), np.uint8); col[oy:oy + nh, ox:ox + nw] = rgb_r
    return m, col

def raster_label(text, box, color):
    BX, BY, BW, BH = box_px(box)
    fs = BH
    while fs > 10:
        font = ImageFont.truetype(MARKER, fs); d0 = ImageDraw.Draw(Image.new("L", (1, 1)))
        l, t, rr, bb = d0.textbbox((0, 0), text, font=font)
        if (rr - l) <= BW and (bb - t) <= BH: break
        fs -= 2
    font = ImageFont.truetype(MARKER, max(12, fs)); img = Image.new("L", (W, H), 0); d = ImageDraw.Draw(img)
    l, t, rr, bb = d.textbbox((0, 0), text, font=font); tw, th = rr - l, bb - t
    tx = min(max(0, BX + (BW - tw) // 2 - l), W - tw - 1); ty = min(max(0, BY + (BH - th) // 2 - t), H - th - 1)
    d.text((tx, ty), text, fill=255, font=font)
    m = np.asarray(img) > 128
    rgb = (185, 32, 32) if color == "red" else (40, 40, 46)
    col = np.zeros((H, W, 3), np.uint8); col[m] = rgb
    return m, col

def fit_panel_boxes(layers, grow=1.22, x0=0.045, y0=0.175, x1=0.955, y1=0.96, max_scale=1.4):
    """Better use of space: enlarge each drawing a bit, then scale the whole
    panel layout to fill the board (only expand), then clamp into bounds."""
    have = [l for l in layers if l.get("box") and len(l["box"]) == 4]
    if not have:
        return
    for l in have:                                       # 1) grow each element about its own center
        b = l["box"]; cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
        nw, nh = b[2] * grow, b[3] * grow
        l["box"] = [cx - nw / 2, cy - nh / 2, nw, nh]
    bs = [l["box"] for l in have]                         # 2) scale layout to fill the board
    ux0 = min(b[0] for b in bs); uy0 = min(b[1] for b in bs)
    ux1 = max(b[0] + b[2] for b in bs); uy1 = max(b[1] + b[3] for b in bs)
    uw = max(1e-3, ux1 - ux0); uh = max(1e-3, uy1 - uy0)
    s = max(1.0, min((x1 - x0) / uw, (y1 - y0) / uh, max_scale))
    nw, nh = uw * s, uh * s
    ox = x0 + ((x1 - x0) - nw) / 2; oy = y0 + ((y1 - y0) - nh) / 2
    for l in have:
        b = l["box"]
        nb = [ox + (b[0] - ux0) * s, oy + (b[1] - uy0) * s, b[2] * s, b[3] * s]
        nb[0] = min(max(nb[0], x0), x1 - 0.03); nb[1] = min(max(nb[1], y0), y1 - 0.03)
        nb[2] = min(nb[2], x1 - nb[0]); nb[3] = min(nb[3], y1 - nb[1])
        l["box"] = nb

def build_panel(p):
    fit_panel_boxes(p["layers"])
    layers = []
    for l in p["layers"]:
        res = raster_art(os.path.join(DIR, l["art"]), l["box"]) if l["kind"] == "art" and l.get("art") else \
              raster_label(l.get("text", ""), l["box"], l.get("color", "black")) if l["kind"] == "label" and l.get("text") else None
        if res is None: continue
        m, col = res; iy, ix, order, traj = trace(m, reading=(l["kind"] == "label"))
        if not len(iy): continue
        layers.append({"kind": l["kind"], "iy": iy, "ix": ix, "order": order, "traj": traj, "col": col[iy, ix], "ink": int(len(iy)), "cue": l["cueStartMs"]})
    layers.sort(key=lambda L: L["cue"])
    # SERIALIZED one-hand schedule with min-draw + hold buffer
    pend = p["endMs"]; pstart = p["startMs"]; avail = pend - HOLD * 1000
    for L in layers:                                     # labels/dates draw a bit faster than art scenes
        if L["kind"] == "label": L["draw"] = min(1.4, max(0.5, L["ink"] / (SPEED * 1.7))) * 1000
        else: L["draw"] = min(MAX_DRAW, max(MIN_DRAW, L["ink"] / SPEED)) * 1000
    prev = pstart                                            # try cue-aligned with idle gaps
    for L in layers: L["start"] = max(prev, L["cue"]); prev = L["start"] + L["draw"]
    if prev > avail:                                         # too long: pack tight
        prev = pstart
        for L in layers: L["start"] = prev; prev = L["start"] + L["draw"]
        if prev > avail:                                     # still long: scale draws down
            tot = sum(L["draw"] for L in layers); f = max(0.01, (avail - pstart) / max(1, tot)); prev = pstart
            for L in layers:
                L["draw"] = max(FLOOR * 1000, L["draw"] * f); L["start"] = prev; prev = L["start"] + L["draw"]
    return layers

PCACHE = {}
def panel_layers(p):
    if p["idx"] not in PCACHE: PCACHE[p["idx"]] = build_panel(p)
    return PCACHE[p["idx"]]

fy, fx, forder, ftraj = trace(FRAME)
# persistent HEADER (the topic) — drawn once in the intro, then static for the whole video
HEADER = TL.get("header")
if HEADER:
    hm, hc = raster_label(HEADER, TL.get("headerBox", [0.16, 0.035, 0.68, 0.092]), "black")
    hiy, hix, horder, htraj = trace(hm, reading=True); hcol = hc[hiy, hix]
panels = TL["panels"]; audio_end = TL.get("audioEndMs", 60000); tail = TL.get("tailMs", 1800)
total = PRE + (audio_end + tail) / 1000.0; nframes = int(total * FPS)
frames = OUT + "_frames"; os.makedirs(frames, exist_ok=True)

for f in range(nframes):
    t = f / FPS; canvas = np.empty((H, W, 3), np.uint8); canvas[:] = BOARD; hand_pt = None
    if t < PRE:
        fr = min(t / FRAME_PRE, 1.0); show = forder <= fr; canvas[fy[show], fx[show]] = FRAME_COLOR
        if fr < 1.0:
            k = min(int(fr * len(ftraj)), len(ftraj) - 1); hand_pt = (ftraj[k, 0], ftraj[k, 1])
        if HEADER and t >= FRAME_PRE:                      # header draws after the frame
            hr = min((t - FRAME_PRE) / max(0.1, PRE - FRAME_PRE), 1.0); show = horder <= hr
            canvas[hiy[show], hix[show]] = hcol[show]
            if hr < 1.0 and len(htraj) > 1:
                k = min(int(hr * len(htraj)), len(htraj) - 1); hand_pt = (htraj[k, 0], htraj[k, 1])
    else:
        canvas[FRAME] = FRAME_COLOR
        if HEADER: canvas[hiy, hix] = hcol               # persistent header
        ms = (t - PRE) * 1000.0
        ap = next((p for p in panels if p["startMs"] <= ms < p["endMs"]), None)
        if ap is None and ms >= panels[-1]["startMs"]: ap = panels[-1]
        if ap is not None:
            for L in panel_layers(ap):
                prog = (ms - L["start"]) / L["draw"]
                if prog <= 0: continue
                prog = min(prog, 1.0); show = L["order"] <= prog
                canvas[L["iy"][show], L["ix"][show]] = L["col"][show]
                if prog < 1.0 and len(L["traj"]) > 1:
                    k = min(int(prog * len(L["traj"])), len(L["traj"]) - 1); hand_pt = (L["traj"][k, 0], L["traj"][k, 1])
    frame = Image.fromarray(canvas, "RGB")
    if hand_pt is not None: frame.paste(hand_img, (int(hand_pt[0]) - TIPX, int(hand_pt[1]) - TIPY), hand_img)
    frame.save(os.path.join(frames, f"{f:05d}.png"))

pre_ms = int(PRE * 1000)
subprocess.run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(frames, "%05d.png"),
                "-i", os.path.join(DIR, TL["audio"]),
                "-filter_complex", f"[1:a]adelay={pre_ms}|{pre_ms},apad[a]", "-map", "0:v", "-map", "[a]",
                "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                "-t", f"{total:.2f}", OUT], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(json.dumps({"out": OUT, "frames": nframes, "dur": round(total, 1)}))
