#!/usr/bin/env python3
# mc3d_prep.py <timeline.json> <runDir> <outDir>
# Bakes the comic into GPU-friendly assets for the 3D engine: per page an EMPTY
# texture (paper+borders), a FULL texture (paper+borders+art+bubbles), and an
# ORDER map (R = per-pixel reveal order, G = panel index) so the draw-on reveal is
# a cheap shader. Emits mc3d_meta.json (layout, per-panel timing + hand trajectory,
# page-turn schedule). Reuses the proven layout / scribe-trace / detail-map placer.
import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize
from skimage.measure import label
from scipy.spatial import cKDTree
from mc_textplace import detail_map, place_safe, _ov
from mc3d_layout import page_layout   # tiles with real aspect ratios (art generated to match → no crop)

TL = json.load(open(sys.argv[1])); RUN = sys.argv[2]; OUT = sys.argv[3]
os.makedirs(OUT, exist_ok=True)
OW, OH, FPS = int(TL["out_w"]), int(TL["out_h"]), int(TL.get("fps", 30))
EST = float(TL.get("est", 1.7)); PER_PAGE = int(TL.get("per_page", 6)); PT = float(TL.get("turn", 1.3))
panels = TL["panels"]; N = len(panels)
PAPER = (238, 230, 212); INK = (26, 24, 22)
FONT = "/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf"
MOVE, HOLD, TAIL, DRAW_FRAC = 0.55, 0.55, 2.2, 0.62


def build_layout(n):
    PW = 2000; M = int(PW * 0.035); G = int(PW * 0.02); usable = PW - 2 * M  # high-res page so zoomed panels stay sharp
    rows, remaining, ri, first = [], n, 0, True
    while remaining > 0:
        if first:
            rows.append(([(0.0, 1.0)], 1.28)); remaining -= 1; first = False
        elif remaining >= 3 and ri % 3 == 1:
            rows.append(([(0.0, 0.32), (0.34, 0.32), (0.68, 0.32)], 0.80)); remaining -= 3
        elif remaining >= 2:
            rows.append(([(0.0, 0.62), (0.645, 0.355)] if ri % 2 == 0 else [(0.0, 0.355), (0.38, 0.62)], 1.00)); remaining -= 2
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


def walk(pts):
    pts = list(map(tuple, pts)); cur = min(pts, key=lambda p: (p[1], p[0])); pts.remove(cur); o = [cur]
    while pts:
        a = np.array(pts); i = int(((a[:, 0] - cur[0]) ** 2 + (a[:, 1] - cur[1]) ** 2).argmin())
        cur = tuple(a[i]); o.append(cur); pts.pop(i)
    return o


def trace(ink):
    if int(ink.sum()) < 40:
        return None, None
    H0, W0 = ink.shape; sc = 1.0
    if max(H0, W0) > 850:                                  # cap skeleton size so the O(n^2) walk() stays fast
        sc = 850.0 / max(H0, W0)
        ink = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).resize((max(1, int(W0 * sc)), max(1, int(H0 * sc))))) > 128
    skel = skeletonize(ink); lab = label(skel, connectivity=2); comps = {}
    sy, sx = np.where(skel)
    for yy, xx in zip(sy, sx):
        comps.setdefault(int(lab[yy, xx]), []).append((int(xx), int(yy)))
    items = [c for c in comps.values() if len(c) > 3]
    if not items:
        return None, None
    items.sort(key=lambda c: (min(p[1] for p in c) // 24, min(p[0] for p in c)))
    traj = []
    for c in items:
        traj.extend(walk(c[::2] if len(c) > 1200 else c))   # subsample huge components before the O(n^2) walk
    traj = (np.array(traj, np.float32) / sc) if traj else np.zeros((0, 2), np.float32)   # scale back to full res
    return traj if len(traj) > 1 else None, None


def cover_into(img, w, h):
    iw, ih = img.size; s = max(w / iw, h / ih)
    img = img.resize((max(w, int(iw * s + 0.5)), max(h, int(ih * s + 0.5))), Image.LANCZOS)
    ox, oy = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((ox, oy, ox + w, oy + h))


def make_bubble(text, fs, maxw):
    font = ImageFont.truetype(FONT, fs); dd = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if dd.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    lh = int(fs * 1.16); tw = max(int(dd.textlength(l, font=font)) for l in lines); pad = int(fs * 0.55)
    bw, bh = tw + 2 * pad, lh * len(lines) + 2 * pad
    img = Image.new("RGBA", (bw, bh), (0, 0, 0, 0)); dr = ImageDraw.Draw(img)
    dr.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=int(fs * 0.7), fill=(255, 255, 255, 255), outline=INK, width=max(3, fs // 12))
    for k, ln in enumerate(lines):
        dr.text((pad, pad + k * lh), ln, fill=INK, font=font)
    return img


def _ray_box_entry(ox, oy, dx, dy, face):
    """t in (0,1] where the ray (ox,oy)+t*(dx,dy) first ENTERS the face box, else None."""
    fx, fy, fw, fh = face; tmin, tmax = 0.0, 1.0
    for o, d, lo, hi in ((ox, dx, fx, fx + fw), (oy, dy, fy, fy + fh)):
        if abs(d) < 1e-9:
            if o < lo or o > hi:
                return None
        else:
            t1, t2 = (lo - o) / d, (hi - o) / d
            if t1 > t2:
                t1, t2 = t2, t1
            tmin, tmax = max(tmin, t1), min(tmax, t2)
    return tmin if (tmin <= tmax and tmin > 1e-3) else None


def tail_poly(rect, mouth, face=None, gap=0):
    """Elegant slim tail: points at the speaker but STOPS at the near edge of their
    face box (never covers the face), tapers thin, and is length-capped."""
    bx, by, bw, bh = rect; cx, cy = bx + bw / 2, by + bh / 2; mx, my = mouth
    if bx <= mx <= bx + bw and by <= my <= by + bh:
        return None
    dx, dy = mx - cx, my - cy; L = math.hypot(dx, dy) or 1; ux, uy = dx / L, dy / L
    tbx = ((bx if ux < 0 else bx + bw) - cx) / ux if abs(ux) > 1e-3 else 1e9
    tby = ((by if uy < 0 else by + bh) - cy) / uy if abs(uy) > 1e-3 else 1e9
    tb = max(0.0, min(tbx, tby)); ex, ey = cx + ux * tb, cy + uy * tb     # tail base on the bubble edge
    apex = (mx, my)
    if face:
        te = _ray_box_entry(cx, cy, dx, dy, face)
        if te is not None and te < 1.0:
            apex = (cx + dx * te - ux * gap, cy + dy * te - uy * gap)     # stop just short of the face
    if math.hypot(apex[0] - ex, apex[1] - ey) > bh * 2.6:                 # cap length (no spike)
        apex = (ex + ux * bh * 2.6, ey + uy * bh * 2.6)
    wb = max(4, int(bh * 0.11))                                           # SLIM base
    return [(ex - uy * wb, ey + ux * wb), (ex + uy * wb, ey - ux * wb), apex]


# ---- schedule (global panel timing), mirrors the 2D renderer ----
nP = max(1, math.ceil(N / PER_PAGE)); base = max(1, math.ceil(N / nP))
PAGES_IDX = [list(range(s, min(s + base, N))) for s in range(0, N, base)]
seg = []; t = EST
panel_time = {}
for pi, idxs in enumerate(PAGES_IDX):
    for gi in idxs:
        panel_time[gi] = (t, panels[gi]["dur"]); t += panels[gi]["dur"]
    if pi < len(PAGES_IDX) - 1:
        seg.append(("turn", pi, t)); t += PT
total = t + TAIL

meta = {"out_w": OW, "out_h": OH, "fps": FPS, "est": EST, "turn": PT, "tail": TAIL, "move": MOVE,
        "hold": HOLD, "drawFrac": DRAW_FRAC, "total": total, "pages": []}

for pi, idxs in enumerate(PAGES_IDX):
    sub = [panels[g] for g in idxs]; n = len(sub)
    PW, PH, BOXES, _ratios = page_layout(n)
    empty = Image.new("RGB", (PW, PH), PAPER); de = ImageDraw.Draw(empty)
    de.rectangle([0, 0, PW - 1, PH - 1], outline=(120, 110, 95), width=3)
    for (x, y, w, h) in BOXES:
        de.rounded_rectangle([x, y, x + w, y + h], radius=14, outline=INK, width=7)
    full = empty.copy(); order = np.zeros((PH, PW, 3), np.uint8)  # R=order*255, G=panelIdx
    pmeta = []
    for li, p in enumerate(sub):
        x, y, w, h = BOXES[li]
        art_path = os.path.join(RUN, p["img"])
        traj_uv = []
        if os.path.exists(art_path):
            art = cover_into(Image.open(art_path).convert("RGB"), w, h)
            full.paste(art, (x, y))
            an = np.asarray(art).astype(np.int16); g = 0.299 * an[..., 0] + 0.587 * an[..., 1] + 0.114 * an[..., 2]
            traj, _ = trace(g < 145)
            if traj is None:
                o2d = np.repeat(np.linspace(0, 1, h)[:, None], w, axis=1).astype(np.float32)
                traj = np.array([[w * 0.5, 2], [w * 0.5, h - 2]], np.float32)
            else:
                yy, xx = np.mgrid[0:h, 0:w]; pts = np.column_stack([xx.ravel(), yy.ravel()]).astype(np.float32)
                _, nn = cKDTree(traj).query(pts); o2d = (nn.astype(np.float32) / max(len(traj) - 1, 1)).reshape(h, w)
            order[y:y + h, x:x + w, 0] = np.clip((0.03 + o2d * (DRAW_FRAC - 0.03)) * 255, 0, 255).astype(np.uint8)  # min>0 so nothing shows at progress 0
            order[y:y + h, x:x + w, 1] = li
            sk = max(1, len(traj) // 80)
            traj_uv = [[float((x + tx) / PW), float((y + ty) / PH)] for tx, ty in traj[::sk]]
            # bubbles — detail-map placement, baked into FULL + ORDER (pop after draw)
            det = detail_map(np.asarray(art))
            faces_px = [[int(av[0] * w), int(av[1] * h), int(av[2] * w), int(av[3] * h)] for av in p.get("avoid", [])]
            pstart, pdur = panel_time[idxs[li]]
            for b in p.get("bubbles", []):
                has = bool(b.get("mouth"))
                ml = (b["mouth"][0] * w, b["mouth"][1] * h) if has else None
                an = (b["anchor"][0] * w, b["anchor"][1] * h) if b.get("anchor") else None
                lx, ly, fs, _bw, _bh, ok = place_safe(det, faces_px, b["text"], ml, an, max_w_frac=0.42)
                body = make_bubble(b["text"], fs, int(w * 0.42))
                bw_, bh_ = body.width, body.height
                # HARD per-image check: the chosen box overlaps NO face. Log it.
                ov = sum(_ov([lx, ly, bw_, bh_], f) for f in faces_px[:len(p.get("avoid", []))])
                print(f"panel {idxs[li]}: bubble fs={fs} {bw_}x{bh_} face_overlap_px={ov} clear_fit={ok}")
                faces_px.append([lx, ly, bw_, bh_])           # co-panel: next bubble must avoid this one too
                bx, by = x + lx, y + ly
                bo = float(min(0.985, max(DRAW_FRAC + 0.06, (b.get("at", 0.0) + 0.15) / max(0.5, pdur))))
                if has:
                    mn = b["mouth"]; av_list = p.get("avoid", [])
                    spk = min(av_list, key=lambda a: (a[0] + a[2] / 2 - mn[0]) ** 2 + (a[1] + a[3] / 2 - mn[1]) ** 2) if av_list else None
                    face_px = (x + spk[0] * w, y + spk[1] * h, spk[2] * w, spk[3] * h) if spk else None
                    poly = tail_poly((bx, by, body.width, body.height), (x + mn[0] * w, y + mn[1] * h), face_px, gap=int(h * 0.012))
                    if poly:
                        td = Image.new("RGBA", (PW, PH), (0, 0, 0, 0)); ImageDraw.Draw(td).polygon(poly, fill=(255, 255, 255, 255), outline=INK)
                        full.paste(td, (0, 0), td)
                        m = np.asarray(td)[..., 3] > 0; order[m, 0] = int(bo * 255); order[m, 1] = li
                full.paste(body, (bx, by), body)
                bm = np.zeros((PH, PW), bool); bm[by:by + body.height, bx:bx + body.width] = np.asarray(body)[..., 3] > 0
                order[bm, 0] = int(bo * 255); order[bm, 1] = li
        pstart, pdur = panel_time[idxs[li]]
        pmeta.append({"box": [x, y, w, h], "traj": traj_uv, "start": pstart, "dur": pdur})
    empty.save(os.path.join(OUT, f"page{pi}_empty.png"))
    full.save(os.path.join(OUT, f"page{pi}_full.png"))
    Image.fromarray(order).save(os.path.join(OUT, f"page{pi}_order.png"))
    meta["pages"].append({"wpx": PW, "hpx": PH, "panels": pmeta,
                          "turnAt": next((s[2] for s in seg if s[0] == "turn" and s[1] == pi), None)})

json.dump(meta, open(os.path.join(OUT, "mc3d_meta.json"), "w"))
print(json.dumps({"pages": len(meta["pages"]), "total": round(total, 1), "out": OUT}))
