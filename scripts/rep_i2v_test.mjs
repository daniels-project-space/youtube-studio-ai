import { writeFile, copyFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(()=>{}, { required: ["REPLICATE_API_TOKEN"] });
const TOK = process.env.REPLICATE_API_TOKEN;
await copyFile("output/lorecraft/moria2/scene_0c.png", "/var/www/html/lorecraft/rep0.png");
const prompt = "Cinematic shot. The camera slowly glides forward and cranes upward through the vast dwarven hall of Khazad-dum, the great carved stone columns passing with deep 3D parallax, atmospheric haze, drifting embers. Keep the pen-and-ink engraving cross-hatch art style. Slow, smooth, only the camera moves, no cuts.";
const sub = await fetch("https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions", {
  method: "POST", headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
  body: JSON.stringify({ input: { image: "http://87.106.233.113/lorecraft/rep0.png", prompt, resolution: "720p", num_frames: 81 } }),
});
let j = await sub.json();
console.error("submit", sub.status, j.status || JSON.stringify(j).slice(0,300));
const getUrl = j.urls && j.urls.get;
const t0 = Date.now();
while (getUrl && (j.status === "starting" || j.status === "processing")) {
  await new Promise(r => setTimeout(r, 5000));
  j = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${TOK}` } })).json();
  process.stderr.write(`.${j.status}`);
  if ((Date.now()-t0) > 480000) break;
}
console.error("\nfinal", j.status, "metrics", JSON.stringify(j.metrics||{}));
const out = Array.isArray(j.output) ? j.output[0] : j.output;
if (!out) { console.error("NO OUTPUT", JSON.stringify(j).slice(0,400)); process.exit(1); }
const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
await writeFile("output/lorecraft/moria2/rep0.mp4", buf);
await copyFile("output/lorecraft/moria2/rep0.mp4", "/var/www/html/lorecraft/rep0.mp4");
console.log("DONE", out, buf.length, "predict_time", (j.metrics||{}).predict_time);
