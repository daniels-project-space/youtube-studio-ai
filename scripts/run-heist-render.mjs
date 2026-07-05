// Victor — Great Train Robbery: render 7 scenes on TWO fal i2v models
// (LTX-2.3 Fast 1080p w/ native SFX  +  Hailuo 2.3 Fast 768p),
// generate narration (ElevenLabs), assemble two ~1-min videos with SFX+VO,
// upscale the Hailuo cut to 1080p, publish to /var/www/html/lustig/.
// Keys come from env (wrapper exports them from the Convex vault).
// SAME motion prompt per scene on both models (per Daniel's rule).
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const FAL_KEY = process.env.FAL_KEY;
const ELEVEN = process.env.ELEVENLABS_API_KEY;
if (!FAL_KEY) throw new Error("FAL_KEY missing");
const LOG = (m) => console.log(`[render] ${new Date().toISOString().slice(11,19)} ${m}`);

const PUB = "http://87.106.233.113/lustig";
const OUT = "/var/www/html/lustig";
const TMP = "/tmp/heist"; fs.mkdirSync(TMP, { recursive: true });

// scene → seed image (already on VPS, publicly fetchable by fal), motion prompt, durations
const SCENES = [
  { id: "1_hook",   img: "hook.png",   dur: 10, prompt: "Slow cinematic push-in on the seated passenger as he turns a knowing glance to camera; behind him down the swaying carriage, torch beams and hurried silhouettes move; rain flickers on the window. Subtle film grain, 35mm." },
  { id: "2_plan",   img: "scene1.png", dur: 6,  prompt: "Handheld push-in over the railway map as the host taps the route and looks up to camera; oil-lamp light flickers, men lean in around the table. Subtle film grain, 35mm." },
  { id: "3_signal", img: "scene2.png", dur: 10, prompt: "Low tracking shot along the rail at night; a gloved hand covers the signal lamp and a false red light glows; the host glances back to camera, breath in the cold air. Subtle film grain, 35mm." },
  { id: "4_storm",  img: "scene3.png", dur: 10, prompt: "Fast handheld as masked men swarm and board the diesel locomotive; the host grips the footplate handrail, adrenaline on his face, turning to camera. Subtle film grain, 35mm." },
  { id: "5_train",  img: "train.png",  dur: 6,  prompt: "Camera moves through the narrow mail carriage past scattered sacks; the host hoists a mailbag and grins to camera as torch beams sweep the walls. Subtle film grain, 35mm." },
  { id: "6_chain",  img: "scene4.png", dur: 10, prompt: "Tracking the human chain down the embankment passing mailbags to a waiting lorry; the host swings a heavy sack and laughs to camera; headlights cut the pre-dawn fog. Subtle film grain, 35mm." },
  { id: "7_loot",   img: "scene5.png", dur: 6,  prompt: "Slow push-in on stacks of banknotes on the table; the host fans a wad of cash toward camera with a smirk; men count money in lamplight. Subtle film grain, 35mm." },
];

// ~55s condensed VO built from the existing script (NOT a new script) — Victor's own lines, tightened to the 1-min slot.
const NARRATION =
  "Morning after the greatest heist in British history. A hundred and twenty mailbags of cash, and the police radio already knows our farm. I'm Victor. Let me take you back. " +
  "We picked the Glasgow to London mail train. The High Value coach. Fifteen men, one perfect trap. " +
  "You don't derail a train. You lie to it. A glove over the green signal, a battery on a false red light. It halts. " +
  "We swarm the engine and uncouple the money coach. Inside, the sacks are ours. " +
  "Thirty minutes. A human chain down the embankment. Two point six million pounds into a waiting lorry. " +
  "Back at the farm we count it, and celebrate with Monopoly, played with real money. Those fingerprints on the board? That is the slip that burns us. The perfect crime always unravels in the smallest details.";

const RUN = process.env.SMOKE ? SCENES.slice(0, 1) : SCENES;
const sh = (cmd, args, timeout = 900000) => execFileSync(cmd, args, { timeout, stdio: ["ignore", "pipe", "pipe"] });

// fal needs HTTPS or data URI (Hailuo rejects http). Downscale seed → base64 data URI (works for both models).
const seedCache = {};
function seedDataUri(img) {
  if (seedCache[img]) return seedCache[img];
  const jpg = `${TMP}/seed_${img.replace(/\W/g, "_")}.jpg`;
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/${img}`, "-vf", "scale=1280:-2", "-q:v", "4", jpg]);
  const b64 = fs.readFileSync(jpg).toString("base64");
  return (seedCache[img] = `data:image/jpeg;base64,${b64}`);
}

async function falRender(model, body, label) {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const sub = await submit.json();
  if (!submit.ok) throw new Error(`${label} submit ${submit.status}: ${JSON.stringify(sub).slice(0,200)}`);
  const statusUrl = sub.status_url; const respUrl = sub.response_url;
  LOG(`${label} queued ${sub.request_id}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 900000) {
    await new Promise((r) => setTimeout(r, 6000));
    const s = await (await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })).json();
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.error) throw new Error(`${label} failed: ${JSON.stringify(s).slice(0,200)}`);
  }
  const res = await (await fetch(respUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })).json();
  const url = res?.video?.url;
  if (!url) throw new Error(`${label} no video url: ${JSON.stringify(res).slice(0,200)}`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const out = `${TMP}/${label}.mp4`;
  fs.writeFileSync(out, buf);
  LOG(`${label} done ${(buf.length/1e6).toFixed(1)}MB`);
  return out;
}

// small concurrency pool
async function pool(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e) }; LOG(`ERR ${e}`); } }
  });
  await Promise.all(workers);
  return out;
}

// ---- 1. render both models (parallel) ----
LOG("submitting 14 fal jobs (7 LTX + 7 Hailuo)…");
const jobs = [];
for (const s of RUN) {
  jobs.push({ kind: "ltx", s });
  jobs.push({ kind: "hailuo", s });
}
const results = await pool(jobs, 6, async (j) => {
  const imageUrl = seedDataUri(j.s.img);
  if (j.kind === "ltx") {
    return { kind: "ltx", id: j.s.id, path: await falRender(
      "fal-ai/ltx-2.3/image-to-video/fast",
      { image_url: imageUrl, prompt: j.s.prompt, duration: j.s.dur, resolution: "1080p", fps: 25, generate_audio: true },
      `ltx_${j.s.id}`) };
  } else {
    const hd = j.s.dur >= 10 ? "10" : "6";
    return { kind: "hailuo", id: j.s.id, path: await falRender(
      "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video",
      { image_url: imageUrl, prompt: j.s.prompt, duration: hd, prompt_optimizer: true },
      `hailuo_${j.s.id}`) };
  }
});
const ltx = RUN.map((s) => results.find((r) => r && r.kind === "ltx" && r.id === s.id)).map((r) => r && r.path).filter(Boolean);
const hai = RUN.map((s) => results.find((r) => r && r.kind === "hailuo" && r.id === s.id)).map((r) => r && r.path).filter(Boolean);
LOG(`clips: LTX ${ltx.length}/${RUN.length}  Hailuo ${hai.length}/${RUN.length}`);
if (process.env.SMOKE) { console.log("###SMOKE_DONE###", JSON.stringify({ ltx, hai })); process.exit(ltx.length && hai.length ? 0 : 1); }
if (ltx.length < 7 || hai.length < 7) LOG("WARNING: some clips missing — assembling what we have");

// ---- 2. narration (ElevenLabs via project module, REST fallback) ----
const narrMp3 = `${TMP}/narr.mp3`;
try {
  const { synthNarration } = await import("../src/lib/tts.ts");
  const bytes = await synthNarration({ text: NARRATION, provider: "elevenlabs", elevenVoiceId: "JBFqnCBsd6RMkjVDRZzb", speed: 0.96 });
  fs.writeFileSync(narrMp3, Buffer.from(bytes));
  LOG("narration via module synthNarration");
} catch (e) {
  LOG(`module TTS failed (${String(e).slice(0,90)}); REST fallback`);
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128", {
    method: "POST", headers: { "xi-api-key": ELEVEN, "Content-Type": "application/json" },
    body: JSON.stringify({ text: NARRATION, model_id: "eleven_multilingual_v2" }),
  });
  if (!r.ok) throw new Error(`TTS REST ${r.status}: ${(await r.text()).slice(0,150)}`);
  fs.writeFileSync(narrMp3, Buffer.from(await r.arrayBuffer()));
  LOG("narration via REST fallback");
}

// ---- 3. assemble ----
const listFile = (paths, name) => { const f = `${TMP}/${name}.txt`; fs.writeFileSync(f, paths.map((p) => `file '${p}'`).join("\n")); return f; };

// LTX: concat preserving native SFX audio
const ltxConcat = `${TMP}/ltx_concat.mp4`;
sh("ffmpeg", ["-y","-f","concat","-safe","0","-i",listFile(ltx,"ltx_list"),"-c:v","libx264","-crf","19","-preset","medium","-pix_fmt","yuv420p","-r","25","-c:a","aac","-b:a","192k",ltxConcat]);
// extract SFX bed
const sfx = `${TMP}/sfx.m4a`;
sh("ffmpeg", ["-y","-i",ltxConcat,"-vn","-c:a","aac","-b:a","192k",sfx]);
// mix: SFX bed ducked under narration
const mix = `${TMP}/mix.m4a`;
sh("ffmpeg", ["-y","-i",sfx,"-i",narrMp3,"-filter_complex","[0:a]volume=0.32[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]","-map","[a]","-c:a","aac","-b:a","192k",mix]);
// LTX final = LTX video + mixed audio
const ltxFinal = `${TMP}/ltx_final.mp4`;
sh("ffmpeg", ["-y","-i",ltxConcat,"-i",mix,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",ltxFinal]);
LOG("LTX final assembled");

// Hailuo: concat + upscale 768p→1080p (lanczos), then same mixed audio
const haiConcat = `${TMP}/hai_1080.mp4`;
sh("ffmpeg", ["-y","-f","concat","-safe","0","-i",listFile(hai,"hai_list"),"-vf","scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1","-c:v","libx264","-crf","19","-preset","medium","-pix_fmt","yuv420p","-r","25","-an",haiConcat]);
const haiFinal = `${TMP}/hailuo_final.mp4`;
sh("ffmpeg", ["-y","-i",haiConcat,"-i",mix,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",haiFinal]);
LOG("Hailuo final assembled (768p→1080p lanczos)");

// ---- 4. publish ----
fs.copyFileSync(ltxFinal, `${OUT}/heist_ltx23_1080.mp4`);
fs.copyFileSync(haiFinal, `${OUT}/heist_hailuo23_1080.mp4`);
const dur = (p) => { try { return sh("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",p]).toString().trim(); } catch { return "?"; } };
console.log("###DONE###");
console.log("LTX  :", `${PUB}/heist_ltx23_1080.mp4`, dur(ltxFinal)+"s");
console.log("HAILUO:", `${PUB}/heist_hailuo23_1080.mp4`, dur(haiFinal)+"s");
