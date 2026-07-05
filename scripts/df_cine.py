#!/usr/bin/env python3
"""LORECRAFT cinematic DepthFlow driver — a large, elegant non-looping camera move
(slow push-in + gentle arc + growing parallax) with DOF, vignette and warm grade,
using DepthFlow's ray-marched 2.5D parallax + auto-inpainting. One clip per painting."""
import math, sys
from attrs import define, field
from depthflow.scene import DepthScene

def smooth(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)

@define
class Cine(DepthScene):
    cdir: float = field(default=1.0)
    cheight: float = field(default=0.45)
    cpush: float = field(default=0.20)   # zoom-in amount
    carc: float = field(default=0.33)    # lateral arc amplitude
    cdof: float = field(default=0.30)

    def update(self):
        t = self.tau
        e = smooth(t)
        self.state.focus = 0.25
        self.state.steady = 0.32
        self.state.isometric = 0.10
        self.state.height = self.cheight + 0.14 * e          # parallax grows as we push in
        self.state.zoom = 1.00 - self.cpush * e              # slow push-in
        self.state.dolly = 0.50 * e
        self.state.offset = (self.carc * (e - 0.5) * 2.0 * self.cdir, 0.07 * math.sin(t * math.pi))
        # depth of field: soften the far depths (keep subject sharp)
        self.state.blur.intensity = self.cdof
        self.state.blur.start = 0.0
        self.state.blur.end = 0.30
        # cinematic finish
        self.state.vignette.intensity = 0.32
        self.state.vignette.decay = 18.0
        self.state.color.sepia = 7.0
        self.state.color.contrast = 106.0
        self.state.color.saturation = 95.0

# argv: image depth out time dir height push arc dof  [w h fps ssaa]
a = sys.argv
img, dep, out, tsec, cdir = a[1], a[2], a[3], float(a[4]), float(a[5])
cheight = float(a[6]) if len(a) > 6 else 0.45
cpush   = float(a[7]) if len(a) > 7 else 0.20
carc    = float(a[8]) if len(a) > 8 else 0.33
cdof    = float(a[9]) if len(a) > 9 else 0.30
W   = int(a[10]) if len(a) > 10 else 1920
H   = int(a[11]) if len(a) > 11 else 1080
FPS = int(a[12]) if len(a) > 12 else 30
SS  = float(a[13]) if len(a) > 13 else 1.2

scene = Cine(backend="headless", cdir=cdir, cheight=cheight, cpush=cpush, carc=carc, cdof=cdof)
scene.ffmpeg.h264(preset="medium")
scene.input(image=img, depth=dep)
scene.main(output=out, time=tsec, fps=FPS, width=W, height=H, ssaa=SS, quality=85)
print("DONE", out)
