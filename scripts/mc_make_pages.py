#!/usr/bin/env python3
# mc_make_pages.py <out.png> [panel1 panel2 ...]  -> a comic page texture (2x2),
# or a blank cream page (for the page back) when no panels are given.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]; panels = sys.argv[2:]
W, H = 1000, 1420
page = Image.new("RGB", (W, H), (236, 228, 210)); d = ImageDraw.Draw(page)
d.rectangle([10, 10, W - 10, H - 10], outline=(120, 110, 95), width=4)
if panels:
    M, G, cols, rows = 55, 28, 2, 2
    cw = (W - 2 * M - (cols - 1) * G) // cols; ch = (H - 2 * M - (rows - 1) * G) // rows
    for idx, p in enumerate(panels[:4]):
        r, c = idx // cols, idx % cols; x = M + c * (cw + G); y = M + r * (ch + G)
        im = Image.open(p).convert("RGB"); s = max(cw / im.width, ch / im.height)
        im = im.resize((int(im.width * s + 1), int(im.height * s + 1)))
        ox = (im.width - cw) // 2; oy = (im.height - ch) // 2
        page.paste(im.crop((ox, oy, ox + cw, oy + ch)), (x, y))
        d.rounded_rectangle([x, y, x + cw, y + ch], outline=(26, 24, 22), width=8)
page.save(out); print("wrote", out)
