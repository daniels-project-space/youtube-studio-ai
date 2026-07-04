#!/usr/bin/env python3
# mc_page_render.py <timeline.json> <runDir> <out_silent.mp4> <hand.png>
# A drawn COMIC BOOK: panels are split across PAGES (varied real-comic layouts).
# The camera zooms in and tours each page with gentle, SUB-PIXEL-smooth motion;
# the HAND DRAWS each panel in (scribe reveal on colour art) as the narration
# plays; SPEECH BUBBLES pop on cue, placed by a vision letterer into clear space
# next to the speaker's mouth (tail points at it) and off every face/hero object.
# When a page fills, it TURNS to a fresh page and keeps drawing. Audio muxed later.
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize
from skimage.measure import label
from scipy.spatial import cKDTree
from mc_textplace import detail_map, best_box   # deterministic, pixel-grounded bubble placement

TL_PATH, RUN_DIR, OUT, HAND_PATH = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
TL = json.load(open(TL_PATH))
OW, OH, FPS = int(TL["out_w"]), int(TL["out_h"]), int(TL.get("fps", 30))
EST = float(TL.get("est", 1.7))
PER_PAGE = int(TL.get("per_page", 6))
PT = float(TL.get("turn", 1.3))
panels = TL["panels"]
N = len(panels)

PAPER = (238, 230, 212); DESK = (38, 30, 26); INK = (26, 24, 22)
FONT_PATH = "/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf"
MOVE = 0.55; HOLD = 0.55; TAIL = 2.2; DRAW_FRAC = 0.62


def smoothstep(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return [a[k] + (b[k] - a[k]) * t for k in range(len(a))]


def walk(pts):
    pts = list(map(tuple, pts)); cur = min(pts, key=lambda p: (p[1], p[0])); pts.remove(cur); order = [cur]
    while pts:
        a = np.array(pts); i = int(((a[:, 0] - cur[0]) ** 2 + (a[:, 1] - cur[1]) ** 2).argmin())
        cur = tuple(a[i]); order.append(cur); pts.pop(i)
    return order


def skeleton_traj(ink):
    if int(ink.sum()) < 40:
        return None
    skel = skeletonize(ink); lab = label(skel, connectivity=2); comps = {}
    sy, sx = np.where(skel)
    for y, x in zip(sy, sx):
        comps.setdefault(int(lab[y, x]), []).append((int(x), int(y)))
    items = [c for c in comps.values() if len(c) > 3]
    if not items:
        return None
    items.sort(key=lambda c: (min(p[1] for p in c) // 24, min(p[0] for p in c)))
    traj = []
    for c in items:
        traj.extend(walk(c))
    return np.array(traj, dtype=np.float32) if len(traj) > 1 else None


def build_layout(n):
    PW = 1500; M = int(PW * 0.035); G = int(PW * 0.02); usable = PW - 2 * M
    rows, remaining, ri, first = [], n, 0, True
    while remaining > 0:
        if first:
            rows.append(([(0.0, 1.0)], 1.28)); remaining -= 1; first = False
        elif remaining >= 3 and ri % 3 == 1:
            rows.append(([(0.0, 0.32), (0.34, 0.32), (0.68, 0.32)], 0.80)); remaining -= 3
        elif remaining >= 2:
            if ri % 2 == 0:
                rows.append(([(0.0, 0.62), (0.645, 0.355)], 1.00)); remaining -= 2
            else:
                rows.append(([(0.0, 0.355), (0.38, 0.62)], 1.00)); remaining -= 2
        else:
            rows.append(([(0.0, 1.0)], 1.10)); remaining -= 1
        ri += 1
    base_h = int(PW * 0.30); boxes, y = [], M
    for (cols, rel) in rows:
        rh = int(base_h * rel)
        for (xf, wf) in cols:
            boxes.append([M + int(xf * usable), y, int(wf * usable), rh])
        y += rh + G
    return PW, y - G + M, boxes[:n]


# ---------------- hand sprite ----------------
hand_src = Image.open(HAND_PATH).convert("RGB")
ha = np.asarray(hand_src).astype(np.int16)
alpha = (~((ha[..., 1] > 100) & (ha[..., 0] < 120) & (ha[..., 2] < 120))).astype(np.uint8) * 255


def hand_for(box_h):
    hh = int(box_h * 0.74); img = hand_src.resize((int(hand_src.width * hh / hand_src.height), hh))
    al = Image.fromarray(alpha).resize(img.size); rgba = Image.merge("RGBA", (*img.split(), al))
    g = np.asarray(img.convert("L")); my, mx = np.where((np.asarray(al) > 0) & (g < 70))
    if len(mx) > 20:
        nib = np.argsort(mx + my)[:15]; tipx, tipy = int(mx[nib].mean()), int(my[nib].mean())
    else:
        tipx, tipy = int(rgba.width * 0.32), int(rgba.height * 0.09)
    return rgba, tipx, tipy


def cover_into(img, w, h):
    iw, ih = img.size; s = max(w / iw, h / ih)
    img = img.resize((max(w, int(iw * s + 0.5)), max(h, int(ih * s + 0.5))), Image.LANCZOS)
    ox, oy = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((ox, oy, ox + w, oy + h))


# ---------------- bubbles ----------------
def make_bubble(text, box_w, box_h):
    fs = max(19, int(box_h * 0.068)); font = ImageFont.truetype(FONT_PATH, fs)
    maxw = int(box_w * 0.78); dd = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    words, lines, cur = text.split(), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if dd.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = wd
    if cur:
        lines.append(cur)
    lh = int(fs * 1.16); tw = max(int(dd.textlength(ln, font=font)) for ln in lines); th = lh * len(lines)
    pad = int(fs * 0.55); bw, bh = tw + 2 * pad, th + 2 * pad
    img = Image.new("RGBA", (bw, bh), (0, 0, 0, 0)); dr = ImageDraw.Draw(img)
    dr.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=int(fs * 0.7), fill=(255, 255, 255, 236), outline=INK, width=max(3, fs // 12))
    for k, ln in enumerate(lines):
        dr.text((pad, pad + k * lh), ln, fill=INK, font=font)
    return img


def rect_overlap(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy


def place_bubble(anchor, mouth, bw, bh, box, avoid, pad=8):
    bx0, by0, bw0, bh0 = box; ax, ay = anchor; mx, my = mouth
    best, bestscore = None, 1e18
    for dx in (0.0, -0.12, 0.12, -0.26, 0.26, -0.4, 0.4):
        for dy in (0.0, -0.1, 0.1, -0.22, 0.22):
            x = min(max(ax + dx * bw0 - bw / 2, bx0 + pad), bx0 + bw0 - bw - pad)
            y = min(max(ay + dy * bh0 - bh / 2, by0 + pad), by0 + bh0 - bh - pad)
            r = (x, y, bw, bh); score = sum(rect_overlap(r, a) for a in avoid) * 3.0
            if x <= mx <= x + bw and y <= my <= y + bh:
                score += bw * bh
            score += 0.0009 * ((x + bw / 2 - ax) ** 2 + (y + bh / 2 - ay) ** 2)
            if score < bestscore:
                bestscore, best = score, (x, y)
    return best


def draw_tail(draw, rect, mouth):
    bx, by, bw, bh = rect; cx, cy = bx + bw / 2, by + bh / 2; mxp, myp = mouth
    if bx <= mxp <= bx + bw and by <= myp <= by + bh:
        return
    dx, dy = mxp - cx, myp - cy; L = math.hypot(dx, dy) or 1; ux, uy = dx / L, dy / L
    tx = ((bx if ux < 0 else bx + bw) - cx) / ux if abs(ux) > 1e-3 else 1e9
    ty = ((by if uy < 0 else by + bh) - cy) / uy if abs(uy) > 1e-3 else 1e9
    t = max(0.0, min(tx, ty)); ex, ey = cx + ux * t, cy + uy * t
    wb = max(7, int(bh * 0.2)); b1 = (ex - uy * wb, ey + ux * wb); b2 = (ex + uy * wb, ey - ux * wb)
    draw.polygon([b1, b2, (mxp, myp)], fill=(255, 255, 255, 236), outline=INK)


# ---------------- build one PAGE (its own paper canvas, panes, bubbles) ----------------
def build_page(subset):
    n = len(subset); PW, PH, BOXES = build_layout(n)
    WDW, WDH = int(PW * 1.20), int(PH * 1.08); PX, PY = (WDW - PW) // 2, (WDH - PH) // 2
    world = np.empty((WDH, WDW, 3), np.uint8); world[:] = DESK; world[PY:PY + PH, PX:PX + PW] = PAPER
    wp = Image.fromarray(world); dd = ImageDraw.Draw(wp)
    dd.rectangle([PX, PY, PX + PW - 1, PY + PH - 1], outline=(120, 110, 95), width=3)
    for (x, y, w, h) in BOXES:
        dd.rounded_rectangle([PX + x, PY + y, PX + x + w, PY + y + h], radius=14, outline=INK, width=7)
    world = np.asarray(wp).copy()
    panes, bubraw = [], []
    for li, p in enumerate(subset):
        x, y, w, h = BOXES[li]; art_path = os.path.join(RUN_DIR, p["img"])
        if not os.path.exists(art_path):
            panes.append(None); continue
        art = np.asarray(cover_into(Image.open(art_path).convert("RGB"), w, h)).astype(np.uint8)
        g = 0.299 * art[..., 0] + 0.587 * art[..., 1] + 0.114 * art[..., 2]; traj = skeleton_traj(g < 145)
        if traj is None:
            order2d = np.repeat(np.linspace(0, 1, h)[:, None], w, axis=1).astype(np.float32)
            traj = np.array([[w * 0.5, 2], [w * 0.5, h - 2]], np.float32)
        else:
            yy, xx = np.mgrid[0:h, 0:w]; pts = np.column_stack([xx.ravel(), yy.ravel()]).astype(np.float32)
            _, nn = cKDTree(traj).query(pts); order2d = (nn.astype(np.float32) / max(len(traj) - 1, 1)).reshape(h, w)
        hand_rgba, tipx, tipy = hand_for(h)
        panes.append({"box": (x, y, w, h), "art": art, "order2d": order2d, "traj": traj, "hand": hand_rgba, "tipx": tipx, "tipy": tipy})
        det = detail_map(art) if p.get("bubbles") else None   # one edge-energy map per panel
        for b in p.get("bubbles", []):
            body = make_bubble(b["text"], w, h)
            has = bool(b.get("mouth"))
            ml = (b["mouth"][0] * w, b["mouth"][1] * h) if has else None
            (lx, ly), _ = best_box(det, body.width, body.height, ml)   # emptiest box near the mouth
            det[max(0, ly):ly + body.height, max(0, lx):lx + body.width] = 1.0   # mark taken so co-panel bubbles avoid it
            bx, by = PX + x + lx, PY + y + ly
            mouth = (PX + x + (b["mouth"][0] * w if has else 0.5 * w), PY + y + (b["mouth"][1] * h if has else 0.18 * h))
            bubraw.append((li, body, bx, by, mouth, has, float(b.get("at", 0.0))))
    return {"panels": subset, "PW": PW, "PH": PH, "BOXES": BOXES, "WDW": WDW, "WDH": WDH,
            "PX": PX, "PY": PY, "world": world, "panes": panes, "bubraw": bubraw, "bubbles": []}


# split panels into balanced pages
nP = max(1, math.ceil(N / PER_PAGE)); base = max(1, math.ceil(N / nP))
PAGES = [build_page(panels[s:s + base]) for s in range(0, N, base)]


# ---------------- camera (per page) ----------------
def frame_top(pg):
    vw = pg["PW"] * 1.05; vh = vw * OH / OW
    return [pg["PX"] + pg["PW"] / 2.0, pg["PY"] + vh / 2.0, vh]


def frame_box(pg, i):
    x, y, w, h = pg["BOXES"][i]
    return [pg["PX"] + x + w / 2.0, pg["PY"] + y + h / 2.0, max(h / 0.82, (w / 0.82) * OH / OW)]


def viewport_f(cam, WDW, WDH):
    cx, cy, vh = cam; vw = vh * OW / OH
    vw = min(vw, float(WDW)); vh = min(vh, float(WDH))
    x0 = min(max(cx - vw / 2, 0.0), WDW - vw); y0 = min(max(cy - vh / 2, 0.0), WDH - vh)
    return x0, y0, vw, vh


def render_page_frame(pg, cam, hand_pt=None, active=None, t=0.0):
    WDW, WDH = pg["WDW"], pg["WDH"]
    x0f, y0f, vw, vh = viewport_f(cam, WDW, WDH)
    ix0, iy0 = int(math.floor(x0f)), int(math.floor(y0f))
    ix1, iy1 = min(WDW, int(math.ceil(x0f + vw)) + 1), min(WDH, int(math.ceil(y0f + vh)) + 1)
    ix0, iy0 = max(0, ix0), max(0, iy0)
    crop = Image.fromarray(pg["world"][iy0:iy1, ix0:ix1]); draw = ImageDraw.Draw(crop)
    if hand_pt is not None and active is not None:
        hh = active["hand"]; crop.paste(hh, (int(hand_pt[0] - ix0 - active["tipx"]), int(hand_pt[1] - iy0 - active["tipy"])), hh)
    for (bt, body, bx, by, mouth, has) in pg["bubbles"]:
        if t >= bt:
            if has:
                draw_tail(draw, (bx - ix0, by - iy0, body.width, body.height), (mouth[0] - ix0, mouth[1] - iy0))
            crop.paste(body, (int(bx - ix0), int(by - iy0)), body)
    sub = (x0f - ix0, y0f - iy0, x0f - ix0 + vw, y0f - iy0 + vh)
    return crop.resize((OW, OH), Image.BILINEAR, box=sub)


def page_turn(Pold, Pnew, q):
    """Old page pivots at the left spine and foreshortens to the left, revealing
    the fresh page beneath; a cast shadow + bright fold edge sell the turn."""
    out = np.asarray(Pnew).copy()
    w = max(1, int(round(OW * (1.0 - q))))
    squ = np.asarray(Pold.resize((w, OH), Image.LANCZOS)).astype(np.int16)
    squ -= np.tile(np.linspace(0, 70, w).astype(np.int16), (OH, 1))[..., None]   # darken toward fold
    out[:, :w] = np.clip(squ, 0, 255).astype(np.uint8)
    sw = min(90, OW - w)
    if sw > 2:
        sh = np.linspace(120, 0, sw).astype(np.int16)
        out[:, w:w + sw] = np.clip(out[:, w:w + sw].astype(np.int16) - sh[None, :, None], 0, 255).astype(np.uint8)
    img = Image.fromarray(out); ImageDraw.Draw(img).line([(w, 0), (w, OH)], fill=(250, 246, 238), width=4)
    return img


# ---------------- schedule (segments) ----------------
segments = []; t = 0.0
segments.append(("est", 0, None, 0.0, EST)); t = EST
for pi, pg in enumerate(PAGES):
    for li, panel in enumerate(pg["panels"]):
        st = t; segments.append(("panel", pi, li, st, st + panel["dur"])); t += panel["dur"]
        for (bli, body, bx, by, mouth, has, at_rel) in pg["bubraw"]:
            if bli == li:
                pg["bubbles"].append((st + at_rel + 0.12, body, bx, by, mouth, has))
    if pi < len(PAGES) - 1:
        segments.append(("turn", pi, None, t, t + PT)); t += PT
segments.append(("tail", len(PAGES) - 1, None, t, t + TAIL)); t += TAIL
total = t; nframes = int(total * FPS)

est_from = frame_top(PAGES[0]); est_from = [est_from[0], est_from[1], est_from[2] * 1.12]
BR = lambda c, tt: (c[0] + 2.4 * math.sin(tt * 0.42 + 1.3), c[1] + 1.9 * math.sin(tt * 0.34 + 0.4), c[2])

ff = subprocess.Popen(
    ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}", "-r", str(FPS),
     "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", OUT],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for f in range(nframes):
    t = f / FPS; seg = segments[-1]
    for s in segments:
        if s[3] <= t < s[4]:
            seg = s; break
    kind, pi, li, st, en = seg
    if kind == "est":
        pg = PAGES[0]; cam = lerp(est_from, frame_top(pg), smoothstep((t - st) / max(0.1, en - st)))
        frame = render_page_frame(pg, list(BR(cam, t)), None, None, t)
    elif kind == "panel":
        pg = PAGES[pi]; panel = pg["panels"][li]; pane = pg["panes"][li]; local = t - st; hand_pt = None; active = None
        f_to = frame_box(pg, li)
        if local < MOVE:
            f_from = frame_box(pg, li - 1) if li > 0 and pg["panes"][li - 1] else frame_top(pg)
            cam = lerp(f_from, f_to, smoothstep(local / MOVE))
        else:
            hf = min(1.0, (local - MOVE) / max(0.1, panel["dur"] - MOVE))
            cam = [f_to[0], f_to[1] - 0.012 * f_to[2] * hf, f_to[2] * (1 - 0.045 * hf)]
        if pane is not None:
            draw_span = max(0.45, (panel["dur"] - MOVE - HOLD) * DRAW_FRAC); prog = (local - MOVE) / draw_span
            if prog > 0:
                prog = min(prog, 1.0); x, y, w, h = pane["box"]; mask = pane["order2d"] <= prog
                pg["world"][pg["PY"] + y:pg["PY"] + y + h, pg["PX"] + x:pg["PX"] + x + w][mask] = pane["art"][mask]
                if prog < 1.0:
                    k = min(int(prog * len(pane["traj"])), len(pane["traj"]) - 1)
                    hand_pt = (pg["PX"] + x + pane["traj"][k, 0], pg["PY"] + y + pane["traj"][k, 1]); active = pane
        frame = render_page_frame(pg, list(BR(cam, t)), hand_pt, active, t)
    elif kind == "turn":
        q = smoothstep((t - st) / max(0.1, en - st))
        pold = render_page_frame(PAGES[pi], frame_top(PAGES[pi]), None, None, t)
        pnew = render_page_frame(PAGES[pi + 1], frame_top(PAGES[pi + 1]), None, None, t)
        frame = page_turn(pold, pnew, q)
    else:  # tail
        pg = PAGES[pi]; last = frame_box(pg, len(pg["panels"]) - 1) if pg["panes"][-1] else frame_top(pg)
        cam = lerp(last, [last[0], last[1], last[2] * 1.45], smoothstep((t - st) / max(0.1, en - st)))
        frame = render_page_frame(pg, list(BR(cam, t)), None, None, t)
    ff.stdin.write(frame.tobytes())

ff.stdin.close(); ff.wait()
print(json.dumps({"out": OUT, "frames": nframes, "dur": round(total, 1), "pages": len(PAGES)}))
