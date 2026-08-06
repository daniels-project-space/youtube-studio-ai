// Live smoke: render ONE LTX clip through the gpuVideo module (fal-ltx) and
// prove it comes back with a NATIVE AUDIO stream. Loads FAL_KEY from the vault.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const vaultKey = async (s, k) => {
  const r = await fetch("https://fantastic-roadrunner-485.convex.cloud/api/query", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:getOne", args: { service: s, keyName: k }, format: "json" }),
  });
  const j = await r.json(); const v = j.value;
  return v && typeof v === "object" ? v.value : v;
};
process.env.FAL_KEY = await vaultKey("fal", "FAL_KEY");
if (!process.env.FAL_KEY) throw new Error("no FAL_KEY from vault");

const { renderGpuVideo } = await import("../src/lib/gpuVideo.ts");

const res = await renderGpuVideo({
  provider: "fal-ltx",
  imageUrl: "http://87.106.233.113/lustig/hook.png",
  prompt:
    "Slow cinematic dolly-in toward the seated man; he turns to camera with a sly look; rain streaks the window; masked figures and torch beams move down the carriage behind him. Audio: rhythmic train clatter on tracks, distant muffled shouts, rain tapping the glass.",
  durationSec: 6, resolution: "1080p", audio: true,
  log: (m) => console.error("[smoke] " + m),
});
console.log("CLIP:", res.url, "| provider", res.provider, "| hasAudio(flag)", res.hasAudio, "| model", res.model);

const buf = Buffer.from(await (await fetch(res.url)).arrayBuffer());
fs.writeFileSync("/tmp/gpuvideo_smoke.mp4", buf);
const audio = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,channels", "-of", "csv=p=0", "/tmp/gpuvideo_smoke.mp4"]).toString().trim();
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", "/tmp/gpuvideo_smoke.mp4"]).toString().trim();
console.log(`SIZE ${(buf.length / 1e6).toFixed(1)}MB | DURATION ${dur}s | AUDIO STREAM: ${audio || "NONE"}`);
console.log(audio ? "###SMOKE PASS### LTX clip returned WITH native audio" : "###SMOKE WEAK### no audio stream");
process.exit(audio ? 0 : 1);
