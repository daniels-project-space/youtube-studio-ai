// Live smoke for the salad-ltx provider: loads Salad + R2 config from the vault,
// verifies the container's ComfyUI has the LTX nodes, then renders one i2v clip.
import fs from "node:fs";
const V = "https://fantastic-roadrunner-485.convex.cloud/api";
const vault = async (s, k) => {
  const r = await fetch(`${V}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "secrets:getOne", args: { service: s, keyName: k }, format: "json" }) });
  const j = await r.json(); const v = j.value; return v && typeof v === "object" ? v.value : v;
};
for (const k of ["SALAD_API_KEY", "SALAD_LTX_GATEWAY", "SALAD_R2_BUCKET", "SALAD_R2_ENDPOINT", "SALAD_R2_PREFIX"]) {
  process.env[k] = await vault("salad", k);
}
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36";
const gw = process.env.SALAD_LTX_GATEWAY.replace(/\/+$/, "");
const H = { "Salad-Api-Key": process.env.SALAD_API_KEY, "User-Agent": UA, "content-type": "application/json" };

// 1) verify the LTX nodes exist on the live container
const oi = await fetch(`${gw}/object_info`, { headers: H });
if (oi.ok) {
  const info = await oi.json();
  const want = ["CheckpointLoaderSimple", "CLIPLoader", "LTXVConditioning", "LTXVImgToVideo", "EmptyLTXVLatentVideo", "LTXVScheduler", "SamplerCustom", "VAEDecode", "VHS_VideoCombine"];
  const missing = want.filter((n) => !(n in info));
  console.log("node check — missing:", missing.length ? missing : "none");
} else {
  console.log("object_info ->", oi.status, "(container may still be loading models)");
}

// 2) render one i2v clip
const { renderGpuVideo } = await import("../src/lib/gpuVideo.ts");
try {
  const res = await renderGpuVideo({
    provider: "salad-ltx",
    imageUrl: "http://87.106.233.113/lustig/hook.png",
    prompt: "the man turns his head toward the camera with a sly look; rain streaks the window; subtle handheld drift; cinematic film grain",
    durationSec: 6, resolution: "720p",
    log: (m) => console.error("[smoke] " + m),
  });
  console.log("###SALAD RENDER OK###", JSON.stringify(res));
} catch (e) {
  console.log("###SALAD RENDER ERR###", String(e).slice(0, 400));
  process.exit(1);
}
