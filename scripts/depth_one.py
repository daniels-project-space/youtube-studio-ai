import sys, torch
torch.cuda.is_available = lambda: False
import numpy as np
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
hf="depth-anything/Depth-Anything-V2-Small-hf"
proc=AutoImageProcessor.from_pretrained(hf); model=AutoModelForDepthEstimation.from_pretrained(hf).eval()
img=Image.open(sys.argv[1]).convert("RGB")
inp=proc(images=img,return_tensors="pt")
with torch.no_grad(): out=model(**inp)
d=out.predicted_depth[0].cpu().numpy().astype("float32"); d=(d-d.min())/(d.max()-d.min()+1e-6)
Image.fromarray((d*255).astype("uint8")).resize(img.size).save(sys.argv[2]); print("depth done")
