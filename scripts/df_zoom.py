#!/usr/bin/env python3
"""Generalized DepthFlow zoom-out reveal (the castle technique) for any scene+depth:
start tight on the subject, pull WAY back, foreground element sweeps/parallaxes IN FRONT
as the background is revealed. Strong parallax, auto-inpaint. argv: img depth out tsec dir [w h fps]"""
import math, sys
from attrs import define, field
from depthflow.scene import DepthScene

def smooth(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)

@define
class Zoom(DepthScene):
    cdir: float = field(default=1.0)
    def update(self):
        t = self.tau; e = smooth(t)
        self.state.height = 0.60
        self.state.steady = 0.30
        self.state.focus = 0.15
        self.state.isometric = 0.0
        self.state.zoom = 0.56 + 0.46 * e          # big zoom-OUT reveal (tight -> wide)
        self.state.dolly = 0.8 * (1.0 - e)         # extra travel early
        self.state.offset = (self.cdir * (0.09 * math.sin(t * math.pi) - 0.04), 0.04 * e)
        self.state.blur.intensity = 0.16
        self.state.blur.start = 0.0
        self.state.blur.end = 0.18
        self.state.vignette.intensity = 0.22
        self.state.color.sepia = 4.0
        self.state.color.contrast = 104.0

img, dep, out, tsec, cdir = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
W = int(sys.argv[6]) if len(sys.argv) > 6 else 1280
H = int(sys.argv[7]) if len(sys.argv) > 7 else 720
FPS = int(sys.argv[8]) if len(sys.argv) > 8 else 24
scene = Zoom(backend="headless", cdir=cdir)
scene.ffmpeg.h264(preset="medium")
scene.input(image=img, depth=dep)
scene.main(output=out, time=tsec, fps=FPS, width=W, height=H, ssaa=1.2, quality=85)
print("DONE", out)
