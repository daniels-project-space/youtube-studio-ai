import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const IMG_SRC = process.argv[2] || "output/loreshort/lotr/scene_0.png";
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", IMG_SRC, "-vf", "scale=1280:-2", "-q:v", "3", "/tmp/bake.jpg"]);
const img = "data:image/jpeg;base64," + (await readFile("/tmp/bake.jpg")).toString("base64");
const PROMPT = "The blacksmith swings his hammer down onto the glowing ring on the anvil, his arm and body driving the blow; bright sparks and embers fly, fire flickers; slow cinematic push-in revealing parallax depth. Keep the watercolour and pencil art style; only natural motion and the camera move, no morphing.";
const NEG = "static, frozen, warping, morphing, deformed, distorted, text, watermark";
const MODELS = [
  { name: "ltx-distilled", slug: "lightricks/ltx-video-0.9.7-distilled", build: (res) => ({ image: img, prompt: PROMPT, resolution: 720, aspect_ratio: "16:9", num_frames: 97, negative_prompt: NEG }) },
  { name: "wan22-fast", slug: "wan-video/wan-2.2-i2v-fast", build: (res) => ({ image: img, prompt: PROMPT, resolution: res || "720p", num_frames: 81 }) },
  { name: "wan22-a14b", slug: "wan-video/wan-2.2-i2v-a14b", build: (res) => ({ image: img, prompt: PROMPT, resolution: res || "720p", num_frames: 81 }) },
  { name: "seedance-lite", slug: "bytedance/seedance-1-lite", build: (res) => ({ image: img, prompt: PROMPT, duration: 5, resolution: res || "720p", aspect_ratio: "16:9" }) },
  { name: "hailuo-02", slug: "minimax/hailuo-02", build: (res) => ({ first_frame_image: img, prompt: PROMPT, duration: 6, resolution: res || "768P" }) },
];
async function verRes(slug) {
  const j = await (await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: { Authorization: `Bearer ${RT}` } })).json();
  const schemas = j?.latest_version?.openapi_schema?.components?.schemas || {};
  const rp = schemas?.Input?.properties?.resolution;
  let en = rp?.enum;
  if (!en && rp?.allOf?.[0]?.$ref) en = schemas[rp.allOf[0].$ref.split("/").pop()]?.enum;
  if (!en && rp?.$ref) en = schemas[rp.$ref.split("/").pop()]?.enum;
  return { version: j.latest_version.id, res: en ? (en.find((x) => /720/.test(String(x))) || en[Math.floor(en.length / 2)]) : null };
}
async function run(m) {
  try {
    const { version, res } = await verRes(m.slug);
    const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version, input: m.build(res) }) });
    let p = await sub.json();
    if (sub.status >= 400) { console.log(`${m.name}: SUBMIT ${sub.status} ${JSON.stringify(p.detail || p).slice(0, 130)}`); return; }
    const g = p.urls?.get; const t0 = Date.now();
    while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 360000) break; }
    const url = Array.isArray(p.output) ? p.output[0] : p.output;
    const pt = (p.metrics || {}).predict_time;
    if (!url) { console.log(`${m.name}: ${p.status} NO-OUT ${JSON.stringify(p.error || "").slice(0, 90)} (res=${res})`); return; }
    await writeFile(`/var/www/html/loreshort/bake_${m.name}.mp4`, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log(`${m.name}: OK predict=${pt}s res=${res}`);
  } catch (e) { console.log(`${m.name}: ERR ${String(e).slice(0, 90)}`); }
}
await Promise.all(MODELS.map(run));
console.log("BAKEOFF DONE");
