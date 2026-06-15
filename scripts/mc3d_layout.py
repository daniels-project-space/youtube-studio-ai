#!/usr/bin/env python3
# Shared comic-page layout where every TILE uses a real image aspect ratio (so art
# is generated at exactly that ratio — no cropping, no cut-off heads, and face
# coords match what's displayed). Importable by mc3d_prep + runnable standalone to
# emit a global panel-index -> aspect-ratio map for the regen step.
import sys, json, math

PW = 2000
M = int(PW * 0.035)   # outer margin
G = int(PW * 0.02)    # gutter


def page_layout(n):
    """Return (PW, PH, boxes[[x,y,w,h]], ratios[str]) for one page of n panels.
    Rows: a 16:9 splash, then 1:1 squares (3-up) / 4:3 pairs / 16:9 singles."""
    usable = PW - 2 * M
    boxes, ratios, y, rem, ri = [], [], M, n, 0
    while rem > 0:
        if ri == 0 or rem == 1:                                  # wide 16:9
            w = usable; h = int(round(w * 9 / 16))
            boxes.append([M, y, w, h]); ratios.append("16:9"); y += h + G; rem -= 1
        elif rem >= 3:                                            # 3 squares
            cw = (usable - 2 * G) // 3; ch = cw
            for c in range(3):
                boxes.append([M + c * (cw + G), y, cw, ch]); ratios.append("1:1")
            y += ch + G; rem -= 3
        else:                                                    # 4:3 pair
            cw = (usable - G) // 2; ch = int(round(cw * 3 / 4))
            for c in range(2):
                boxes.append([M + c * (cw + G), y, cw, ch]); ratios.append("4:3")
            y += ch + G; rem -= 2
        ri += 1
    return PW, y - G + M, boxes[:n], ratios[:n]


if __name__ == "__main__":
    TL = json.load(open(sys.argv[1])); out = sys.argv[2]
    PER_PAGE = int(TL.get("per_page", 6)); N = len(TL["panels"])
    nP = max(1, math.ceil(N / PER_PAGE)); base = max(1, math.ceil(N / nP))
    pages = [list(range(s, min(s + base, N))) for s in range(0, N, base)]
    amap = {}
    for idxs in pages:
        _, _, _, ratios = page_layout(len(idxs))
        for li, gi in enumerate(idxs):
            amap[str(gi)] = ratios[li]
    json.dump(amap, open(out, "w")); print(json.dumps(amap))
