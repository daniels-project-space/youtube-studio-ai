#!/usr/bin/env python3
"""Castle 1-minute-shot replication via DepthFlow: a big ZOOM-OUT reveal with strong
parallax so the FOREGROUND GRASS (near in the depth map) sweeps/recedes in front of the
warrior and castle as the camera pulls way back. Physically-correct ray-march, auto-inpaint."""
import math, sys
from attrs import define
from depthflow.scene import DepthScene

def smooth(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)

@define
class Castle(DepthScene):
    def update(self):
        t = self.tau; e = smooth(t)
        self.state.height = 0.62          # strong parallax → grass pops in FRONT
        self.state.steady = 0.30
        self.state.focus = 0.15
        self.state.isometric = 0.0
        self.state.zoom = 0.55 + 0.47 * e   # big ZOOM-OUT (tight 0.55 → wide 1.02) = reveal, much travel
        self.state.dolly = 0.8 * (1.0 - e)  # extra dolly travel at the start
        self.state.offset = (0.10 * math.sin(t * math.pi) - 0.05, 0.04 * e)
        # light DOF on the deep background, soft vignette, warm engraving tone
        self.state.blur.intensity = 0.18
        self.state.blur.start = 0.0
        self.state.blur.end = 0.20
        self.state.vignette.intensity = 0.24
        self.state.color.sepia = 5.0
        self.state.color.contrast = 104.0

img, dep, out, tsec = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
W = int(sys.argv[5]) if len(sys.argv) > 5 else 1280
H = int(sys.argv[6]) if len(sys.argv) > 6 else 720
FPS = int(sys.argv[7]) if len(sys.argv) > 7 else 24
scene = Castle(backend="headless")
scene.ffmpeg.h264(preset="medium")
scene.input(image=img, depth=dep)
scene.main(output=out, time=tsec, fps=FPS, width=W, height=H, ssaa=1.2, quality=85)
print("DONE", out)
