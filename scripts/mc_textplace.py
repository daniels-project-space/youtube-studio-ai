#!/usr/bin/env python3
# Deterministic, pixel-grounded speech-bubble placement. Instead of asking an LLM
# to GUESS a clear-space box (imprecise → overlaps faces/objects), we measure the
# ACTUAL panel: a detail/saliency map (edge energy) marks where the content is, and
# an integral-image search finds the emptiest box of the needed size near the
# speaker. High-detail = faces/figures/props, so the bubble physically cannot land
# on important content. Fast (one numpy pass, O(candidates) search), no API.
import numpy as np
from scipy.ndimage import gaussian_filter, sobel
from PIL import Image, ImageDraw, ImageFont

FONT = (lambda: __import__("os").environ.get("MC_FONT") or next((f for f in ["src/assets/fonts/ComicNeue-Bold.otf", "/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if __import__("os").path.exists(f)), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))()


def detail_map(img):
    """img HxWx3 uint8 → normalized 0..1 importance map (edge energy, region-blurred)."""
    g = 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    mag = np.hypot(sobel(g, axis=1), sobel(g, axis=0))
    H, W = g.shape
    det = gaussian_filter(mag, sigma=max(4.0, min(H, W) * 0.022))
    # gently bias the dead-centre as "valued" so bubbles drift to margins/sky
    return det / (det.max() + 1e-6)


def bubble_size(text, box_w, box_h):
    fs = max(19, int(box_h * 0.068)); font = ImageFont.truetype(FONT, fs)
    maxw = int(box_w * 0.78); dd = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if dd.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    lh = int(fs * 1.16); tw = max(int(dd.textlength(l, font=font)) for l in lines)
    return tw + int(fs * 1.1), lh * len(lines) + int(fs * 1.1)


def best_box(det, bw, bh, mouth=None, anchor=None, pad=6):
    """Place the bubble at the LETTERER'S anchor (vision's clear spot near/above the
    speaker), nudged locally to the emptiest nearby position so it never sits on a
    face/object — keeping it close to the speaker with a short tail. Falls back to
    'just above the mouth' if no anchor is given."""
    H, W = det.shape
    bw = int(min(bw, W - 2 * pad)); bh = int(min(bh, H - 2 * pad))
    II = np.pad(det.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    area = float(bw * bh)
    def bm(x, y):
        return (II[y + bh, x + bw] - II[y, x + bw] - II[y + bh, x] + II[y, x]) / area
    mx, my = mouth if mouth else (W / 2.0, H * 0.30)
    ax, ay = anchor if anchor else (mx, my - bh * 0.9)        # default: a head-height above the mouth
    diag = (W * W + H * H) ** 0.5
    best, bs = None, 1e18
    for dy in (-0.7, -0.35, 0.0, 0.35, 0.7):                  # local search AROUND the anchor only
        for dx in (-0.7, -0.35, 0.0, 0.35, 0.7):
            x = int(min(max(ax + dx * bw - bw / 2, pad), W - bw - pad))
            y = int(min(max(ay + dy * bh - bh / 2, pad), H - bh - pad))
            d = bm(x, y)
            da = (((x + bw / 2 - ax) ** 2 + (y + bh / 2 - ay) ** 2) ** 0.5) / diag
            score = d * 7.0 + da * 7.0                        # emptiness AND staying near the anchor
            if x <= mx <= x + bw and y <= my <= y + bh:
                score += 8.0                                  # never cover the mouth
            if score < bs:
                bs, best = score, (x, y)
    return best, bm(*best)


def box_detail(det, x, y, bw, bh):
    H, W = det.shape
    x = max(0, min(int(x), W - bw)); y = max(0, min(int(y), H - bh))
    return float(det[y:y + bh, x:x + bw].mean())


def _measure(text, fs, max_w):
    font = ImageFont.truetype(FONT, fs); dd = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if dd.textlength(t, font=font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    lh = int(fs * 1.16); tw = max(int(dd.textlength(l, font=font)) for l in lines); pad = int(fs * 0.55)
    return tw + 2 * pad, lh * len(lines) + 2 * pad


def _ov(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy


def place_safe(det, faces, text, mouth=None, anchor=None, pad=6, max_w_frac=0.42):
    """PREVENTION-FIRST placement. Returns (x, y, fs, bw, bh, ok): the LARGEST readable
    bubble that fits a face-free, low-detail spot near the speaker. Faces are a HARD
    constraint (overlap => rejected). If no size fits clear of faces, ok=False (caller
    can flag for art regen) and we return the least-bad small placement."""
    H, W = det.shape
    II = np.pad(det.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    def bm(x, y, bw, bh):
        return (II[y + bh, x + bw] - II[y, x + bw] - II[y + bh, x] + II[y, x]) / float(bw * bh)
    mx, my = mouth if mouth else (W / 2.0, H * 0.3)
    diag = (W * W + H * H) ** 0.5
    mg = int(0.034 * max(W, H))                # clear GAP around faces: never touch, leave tail room
    frects = [(fx - mg, fy - mg, fw + 2 * mg, fh + 2 * mg) for (fx, fy, fw, fh) in faces]
    max_w = int(W * max_w_frac)
    fs_hi, fs_lo = max(18, int(H * 0.046)), max(14, int(H * 0.032))   # a touch smaller
    for fs in range(fs_hi, fs_lo - 1, -max(2, (fs_hi - fs_lo) // 6 or 1)):
        bw, bh = _measure(text, fs, max_w)
        if bw > W - 2 * pad or bh > H - 2 * pad:
            continue
        ax, ay = anchor if anchor else (mx, my - bh)
        step = max(8, min(bw, bh) // 3); best, bs = None, 1e18
        for y in range(pad, H - bh - pad + 1, step):
            for x in range(pad, W - bw - pad + 1, step):
                r = (x, y, bw, bh)
                if any(_ov(r, fr) > 0 for fr in frects):
                    continue                                   # HARD: never overlap a face
                cx, cy = x + bw / 2, y + bh / 2
                da = (((cx - ax) ** 2 + (cy - ay) ** 2) ** 0.5) / diag    # near the letterer's anchor (by the speaker)
                dm = (((cx - mx) ** 2 + (cy - my) ** 2) ** 0.5) / diag    # short tail to the mouth
                sc = da * 10 + dm * 4 + bm(x, y, bw, bh) * 2.5            # faces already hard-excluded → proximity leads
                if x <= mx <= x + bw and y <= my <= y + bh:
                    sc += 8
                if sc < bs:
                    bs, best = sc, (x, y)
        if best:
            return (best[0], best[1], fs, bw, bh, True)
    # nothing fits clear of faces — return smallest, least-detail spot, flagged
    bw, bh = _measure(text, fs_lo, max_w); bw, bh = min(bw, W - 2 * pad), min(bh, H - 2 * pad)
    best, bs = (pad, pad), 1e18
    for y in range(pad, H - bh - pad + 1, max(8, bh // 2)):
        for x in range(pad, W - bw - pad + 1, max(8, bw // 2)):
            d = bm(x, y, bw, bh)
            if d < bs:
                bs, best = d, (x, y)
    return (best[0], best[1], fs_lo, bw, bh, False)
