// Carry over the v1 lofi engine: animate the still with kwaivgi/kling-v3-omni-video
// (the EXACT model autostudio used for ocean_cafe), v1 static-camera prompt + rules.
import { readFile, writeFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const STILL = process.argv[2] || "/var/www/html/lofi/beachcafe3.png";
const OUT = process.argv[3] || "/var/www/html/lofi/bc4_omni.mp4";
const DUR = Number(process.argv[4] || 10);

const img = "data:image/png;base64," + (await readFile(STILL)).toString("base64");
// v1 STATIC_CAMERA_POSITIVE + AI_VIDEO_POSITIVE (from kling_video.py) + the scene motion
const PROMPT =
  "A cozy sunny seaside coffee cafe, gentle calm lofi animation. The young anime girl is clearly ALIVE but stays IN PLACE: she gently tends her potted flowers with small soft watering motions and sways subtly — she does NOT walk, turn around, or change her pose much. The fluffy cream-and-orange cat is alive and playful but stays in place: it flicks its tail, twitches its ears and turns its head slightly. The ocean water shimmers and sparkles softly in place; cherry-blossom petals flutter gently; the little boat bobs in place; the hanging lanterns sway faintly. " +
  "The BACKGROUND stays STEADY: the sky, the clouds, and the distant island barely move at all. " +
  "static camera, locked-off shot, fixed framing, tripod shot, only subject and foreground elements animate naturally in place, background remains steady";
const NEG =
  "camera pan, camera zoom, camera dolly, camera tracking, camera shake, handheld, parallax, dolly zoom, orbiting camera, motion blur of the frame, framing drift, crop change, clouds drifting across, large fast movement, walking, turning around, character leaving frame";

const sub = await fetch("https://api.replicate.com/v1/models/kwaivgi/kling-v3-omni-video/predictions", {
  method: "POST",
  headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json", Prefer: "wait=5" },
  body: JSON.stringify({ input: { mode: "pro", start_image: img, prompt: PROMPT, duration: DUR, aspect_ratio: "16:9", generate_audio: false, negative_prompt: NEG } }),
});
let p = await sub.json();
console.error("submit", sub.status, p.status, (p.error || "") + JSON.stringify(p.detail || "").slice(0, 120));
const g = p.urls?.get; const t0 = Date.now();
while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 600000) break; }
console.error("\nfinal", p.status, "predict_time", (p.metrics || {}).predict_time);
const url = Array.isArray(p.output) ? p.output[0] : p.output;
if (!url) { console.log("NO OUTPUT", JSON.stringify(p).slice(0, 400)); process.exit(1); }
await writeFile(OUT, Buffer.from(await (await fetch(url)).arrayBuffer()));
console.log("DONE", OUT);
