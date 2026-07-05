import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
// 1) the old failed prediction
const old = await (await fetch("https://api.replicate.com/v1/predictions/cty7navqhsrne0cywnc9bmdpmm", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("OLD pred status:", old.status, "| error:", old.error);
console.log("OLD logs tail:", (old.logs || "").slice(-300));
// 2) is the clip web-accessible?
const head = await fetch("http://87.106.233.113/loreshort/starwars_clip_7.mp4", { method: "HEAD" });
console.log("clip7 web:", head.status, head.headers.get("content-length"), head.headers.get("content-type"));
// 3) re-submit fresh and watch the real status/error
const VER = "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775";
const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: VER, input: { video_path: "http://87.106.233.113/loreshort/starwars_clip_7.mp4", model: "RealESRGAN_x4plus", resolution: "2k" } }) });
let j = await sub.json(); console.log("RESUB:", sub.status, j.status, j.id);
const getUrl = j.urls?.get; const t0 = Date.now();
while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); j = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 600000) break; }
console.log("\nRESUB final:", j.status, "| error:", j.error, "| predict_time:", (j.metrics || {}).predict_time);
console.log("RESUB logs tail:", (j.logs || "").slice(-300));
const url = Array.isArray(j.output) ? j.output[0] : j.output;
if (url) { const { writeFile } = await import("node:fs/promises"); await writeFile("/home/ubuntu/youtube-studio-ai/output/loreshort/starwars/up_7.mp4", Buffer.from(await (await fetch(url)).arrayBuffer())); console.log("SAVED up_7.mp4"); }
