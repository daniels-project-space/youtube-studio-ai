import torch
torch.cuda.is_available = lambda: False
torch.cuda.device_count = lambda: 0
import numpy as np
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
hf = "depth-anything/Depth-Anything-V2-Small-hf"
proc = AutoImageProcessor.from_pretrained(hf)
model = AutoModelForDepthEstimation.from_pretrained(hf).eval()
import sys; d0 = "output/lorecraft/moria"
for i in range(4):
    img = Image.open(f"{d0}/bg_{i}.png").convert("RGB")
    inp = proc(images=img, return_tensors="pt")
    with torch.no_grad():
        out = model(**inp)
    dd = out.predicted_depth[0].cpu().numpy().astype("float32")
    dd = (dd - dd.min())/(dd.max()-dd.min()+1e-6)
    Image.fromarray((dd*255).astype("uint8")).resize(img.size).save(f"{d0}/bgdepth_{i}.png")
    print("done", i, flush=True)
print("ALL DONE", flush=True)
