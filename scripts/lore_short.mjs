// LORE SHORT v2 — durable, repeatable lore-micro-doc pipeline with GENUINE AI camera moves.
//  Gemini story (paced narration + per-beat SHOT type + LAYERED-DEPTH visual + depth CAMERA move)
//   → Nano Banana art (3 separated depth planes)  → ElevenLabs PER-LINE voice (for exact timing)
//   → cheap i2v camera moves (Replicate Wan 2.2 / LTX)  → ffmpeg cut ON THE BEATS, fit each shot to
//     its narration line (+breath), dissolve, title, grade. Every stage caches → resumable.
import { writeFile, readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJsonPro } from "@/lib/gemini";
import { synthNarration } from "@/lib/tts";

// ───────────────────── CONFIG (edit for any new short) ─────────────────────
const CFG = {
  slug: "starwars",
  title: "THE EMPIRE",
  kicker: "how the old order fell",
  topic: "the slow corruption and fall of a galactic Republic, a manufactured clone war, the betrayal and destruction of an order of robed guardian-knights, and the rise of the first tyrannical star-empire and its masked armored enforcer",
  narrator: "the dark Emperor of the new star-empire, recounting his own triumph in FIRST PERSON: cold, patient, intimate, quietly gloating, never breathless, like an old king telling how he truly won",
  nScenes: 9,
  artStyle: "epic cinematic concept-art ILLUSTRATION, dramatic chiaroscuro lighting, highly detailed, vast awe-inspiring scale, deep shadows with selective warm and cold light, painterly sci-fi grandeur, original universe. ABSOLUTELY NO text, no letters, no borders, no UI.",
  voiceId: "IKne3meq5aSn9XLyUdCD",
  model: "ltx",            // "wan" (Replicate Wan 2.2 i2v-fast, ~$0.10) | "ltx" (~$0.014, 2.5x faster)
  frames: 97,              // LTX native frames (~4s @24fps); 161 = longer/more elaborate travel
  upscale: "none",         // "realesrgan" (Replicate AI video upscale → 2K) | "ffmpeg" (free lanczos+unsharp) | "none"
  elaborateMoves: false,   // false = the simpler camera prompts Daniel preferred; true = CAM_MOVES catalog + strong depth
  pause: 0.45,             // breath between beats (s)
  dissolve: 0.35,          // crossfade between shots (s)
};
const TWOK = CFG.upscale !== "none";       // 2560x1440 canvas when upscaling
const OW = TWOK ? 2560 : 1920, OH = TWOK ? 1440 : 1080;
// ───────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const RUN = join(ROOT, "output", "loreshort", CFG.slug);
const WEB = "/var/www/html/loreshort";
await mkdir(RUN, { recursive: true });
await mkdir(WEB, { recursive: true });
const rd = (f) => join(RUN, f);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY", "REPLICATE_API_TOKEN"] });
const GK = process.env.GEMINI_API_KEY, RT = process.env.REPLICATE_API_TOKEN;
const log = (m) => console.error("[short]", m);
const sh = (c, a) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
const probe = (f) => new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(parseFloat(o.trim()) || 0)); });

// 1 ── STORY ────────────────────────────────────────────────────────────────
let plan;
if (existsSync(rd("plan.json"))) plan = JSON.parse(await readFile(rd("plan.json"), "utf8"));
else {
  for (let attempt = 0; attempt < 3; attempt++) {
  plan = await geminiJsonPro({
    prompt:
      `Write a lore micro-documentary in the EXACT spirit of the Game of Thrones "Histories & Lore" featurettes: a single ` +
      `figure narrates history in FIRST PERSON — proud, intimate, epic, measured, never breathless, with DRAMATIC PACING ` +
      `(mix short punchy lines with a few longer ones; let it breathe). NARRATOR: ${CFG.narrator}. TOPIC: ${CFG.topic}. ` +
      `Compose a tight narration ARC across EXACTLY ${CFG.nScenes} beats that BUILDS: a calm opening, rising dread, a climax, a cold resolution. ` +
      `Return STRICT JSON {"scenes":[{...}]} with EXACTLY ${CFG.nScenes} scene objects IN ORDER, each with: ` +
      `"line" = that beat's spoken narration sentence (vary length 6–22 words for rhythm); ` +
      `"shot" = the cinematic SHOT TYPE, chosen for rhythm and to vary across beats: one of "wide establishing", "sweeping aerial", "slow low-angle hero", "intimate close", "dramatic reveal", "looming over-the-shoulder", "vast vista"; ` +
      `"visual" = a vivid description of that moment composed in THREE SEPARATED DEPTH PLANES — a distinct CLOSE FOREGROUND element, a clear MIDGROUND subject, and a DEEP receding BACKGROUND — so a moving camera reveals strong parallax depth; atmospheric, dramatic; use ONLY generic original NON-trademarked terms (no franchise/brand/character names, no graphic gore); ` +
      `"camera" = ONE cinematic camera move that TRAVELS THROUGH THE DEPTH for this shot (e.g. "slow dolly push-in past the foreground toward X, revealing the depth", "crane up and back to unveil the vast Y behind", "track laterally past the foreground W as the background slides"). Vary the moves. ` +
      `The "scenes" array MUST contain EXACTLY ${CFG.nScenes} complete objects — do not stop early, do not summarise. Keep each "visual" to ~40 words.`,
    maxTokens: 28000, temperature: 0.75,
  });
  if (plan?.scenes?.length >= CFG.nScenes) break;
  log(`story attempt ${attempt + 1}: got ${plan?.scenes?.length || 0}/${CFG.nScenes} beats, retrying`);
  }
  if (!plan?.scenes || plan.scenes.length < CFG.nScenes) throw new Error(`story only produced ${plan?.scenes?.length || 0} beats`);
  await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
}
const scenes = plan.scenes.slice(0, CFG.nScenes);
log(`story: ${scenes.length} beats`);

// 2 ── ART (layered depth, parallel) ────────────────────────────────────────
async function genArt(i) {
  const out = rd(`scene_${i}.png`);
  if (existsSync(out)) return;
  const text = `${scenes[i].shot ? scenes[i].shot.toUpperCase() + " SHOT. " : ""}${CFG.artStyle}\nCompose in THREE clear depth layers (close foreground / midground subject / deep background). SCENE: ${scenes[i].visual}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GK}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) { log(`scene ${i} art FAILED: ${JSON.stringify(j?.candidates?.[0]?.finishReason || j?.error || j).slice(0, 100)}`); return; }
  await writeFile(out, Buffer.from(p.inlineData.data, "base64")); log(`art ${i} ✓`);
}
await Promise.all(scenes.map((_, i) => genArt(i)));

// 3 ── PER-LINE NARRATION (for exact timing) ────────────────────────────────
const lineDur = [];
for (let i = 0; i < scenes.length; i++) {
  const f = rd(`line_${i}.mp3`);
  if (!existsSync(f)) { const b = await synthNarration({ text: scenes[i].line, provider: "elevenlabs", elevenVoiceId: CFG.voiceId }); await writeFile(f, Buffer.from(b)); }
  lineDur[i] = await probe(f);
}
log(`lines: ${lineDur.map((d) => d.toFixed(1)).join(", ")}s  total≈${(lineDur.reduce((a, b) => a + b, 0) + scenes.length * CFG.pause).toFixed(0)}s`);

// 4 ── CAMERA MOVES (cheap i2v) ─────────────────────────────────────────────
// elaborate, distinct cinematic moves cycled per beat — each drives a different kind of 3D travel
const CAM_MOVES = [
  "A slow majestic CRANE DESCENT from high above, the camera booming down past a towering foreground element and sweeping deep into the scene",
  "A powerful DOLLY PUSH straight forward THROUGH the frame, near foreground shapes rushing past the lens as the camera plunges toward the distant background",
  "A grand PULL-BACK reveal, the foreground sweeping up huge and close in front of the lens while layer after layer of the deep background unfolds behind it",
  "A sweeping ORBIT arcing sideways around the central subject, foreground and background sliding apart with strong parallax",
  "A low gliding TRACK forward weaving past tall foreground silhouettes that part to reveal the vista beyond",
  "A rising BOOM up and over a near foreground obstacle, then tilting down to reveal the scene stretching far into the distance",
  "A steady descending CRANE that drops the camera down through stacked layers of depth, foreground passing close overhead",
  "A slow lateral TRUCK gliding across the scene, near foreground elements streaking past fast while the far background drifts slowly",
  "A cinematic FLY-THROUGH gliding between foreground pillars and shapes, deep into the receding space, vanishing point opening up ahead",
];
const DEPTH_HOLD = " Reveal MANY overlapping depth layers — distinct foreground occluders close to the lens, several midground planes, and a deep receding background — with strong volumetric parallax so every layer moves at its own rate and planes slide past one another. Cinematic, smooth, continuous motion; ONLY the camera moves through real 3D space; keep the exact art style and content; no cuts, no morphing, no new objects.";
const DEPTH_SIMPLE = " Reveal strong parallax depth between the foreground, midground and background. Keep the exact same art style and content; ONLY the camera moves smoothly through real 3D space. Slow, cinematic, no cuts, no morphing, no new objects.";
async function repI2V(i) {
  if (existsSync(rd(`clip_${i}.mp4`))) return;
  await copyFile(rd(`scene_${i}.png`), join(WEB, `${CFG.slug}_${i}.png`));
  const imageUrl = `http://87.106.233.113/loreshort/${CFG.slug}_${i}.png`;
  const prompt = CFG.elaborateMoves
    ? `${CAM_MOVES[i % CAM_MOVES.length]}. ${scenes[i].camera}.${DEPTH_HOLD}`
    : `${scenes[i].camera}.${DEPTH_SIMPLE}`;
  // LTX-distilled is a community model → versioned /v1/predictions; Wan i2v-fast is official → /v1/models/.../predictions
  const LTX_VERSION = "e7f2778ec419047c564a6620b2d9bf7d6c64673411bf2ae13e628ee2b2c0b5b1"; // ltx-video-0.9.7-distilled
  const endpoint = CFG.model === "ltx"
    ? "https://api.replicate.com/v1/predictions"
    : "https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions";
  const input = CFG.model === "ltx"
    ? { image: imageUrl, prompt, resolution: 720, aspect_ratio: "16:9", num_frames: CFG.frames }
    : { image: imageUrl, prompt, resolution: "720p", num_frames: 81 };
  const body = CFG.model === "ltx" ? { version: LTX_VERSION, input } : { input };
  const sub = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = await sub.json(); const getUrl = j.urls?.get; const t0 = Date.now();
  while (getUrl && (j.status === "starting" || j.status === "processing")) {
    await new Promise((r) => setTimeout(r, 5000));
    j = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json();
    if (Date.now() - t0 > 540000) break;
  }
  const url = Array.isArray(j.output) ? j.output[0] : j.output;
  if (!url) throw new Error(`scene ${i} i2v failed: ${JSON.stringify(j).slice(0, 200)}`);
  await writeFile(rd(`clip_${i}.mp4`), Buffer.from(await (await fetch(url)).arrayBuffer()));
  log(`clip ${i} ✓`);
}
for (let i = 0; i < scenes.length; i++) await repI2V(i);

// 4b ── 2K UPSCALE (cheap AI): Replicate real-esrgan-video per clip → ~2560-wide ────────────
const ESRGAN_VER = "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775"; // lucataco/real-esrgan-video
// resilient fetch — the VPS DNS/network flakes (EAI_AGAIN); retry with backoff so a blip can't kill a long run
async function rfetch(url, opts, tries = 6) {
  for (let a = 0; ; a++) {
    try { return await fetch(url, opts); }
    catch (e) { if (a >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 4000 * (a + 1))); }
  }
}
async function upscaleClip(i) {
  if (CFG.upscale !== "realesrgan" || existsSync(rd(`up_${i}.mp4`))) return;
  await copyFile(rd(`clip_${i}.mp4`), join(WEB, `${CFG.slug}_clip_${i}.mp4`));
  const vurl = `http://87.106.233.113/loreshort/${CFG.slug}_clip_${i}.mp4`;
  const sub = await rfetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: ESRGAN_VER, input: { video_path: vurl, model: "RealESRGAN_x4plus", resolution: "2k" } }) });
  let j = await sub.json(); const getUrl = j.urls?.get; const t0 = Date.now();
  while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); j = await (await rfetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 600000) break; }
  const url = Array.isArray(j.output) ? j.output[0] : j.output;
  if (!url) throw new Error(`scene ${i} upscale failed: ${JSON.stringify(j).slice(0, 200)}`);
  await writeFile(rd(`up_${i}.mp4`), Buffer.from(await (await rfetch(url)).arrayBuffer()));
  log(`upscale ${i} ✓`);
}
for (let i = 0; i < scenes.length; i++) await upscaleClip(i);
const vid = (i) => (CFG.upscale === "realesrgan" ? rd(`up_${i}.mp4`) : rd(`clip_${i}.mp4`));

// 5 ── EDIT: fit each shot to its line (+breath), cut on beats, dissolve, title, grade ──
const SCALER = CFG.upscale === "ffmpeg" ? ":flags=lanczos" : "";
const SHARP = CFG.upscale === "ffmpeg" ? ",unsharp=5:5:0.8:5:5:0.0" : "";
for (let i = 0; i < scenes.length; i++) {
  const disp = lineDur[i] + CFG.pause;                                   // this shot's screen time
  const nat = await probe(vid(i)) || 5;
  const factor = Math.min(2.2, Math.max(0.45, disp / nat));              // speed the camera move to fit the line
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", vid(i), "-vf",
    `setpts=${factor.toFixed(4)}*PTS,scale=${OW}:${OH}:force_original_aspect_ratio=increase${SCALER},crop=${OW}:${OH},fps=24${SHARP}`,
    "-t", disp.toFixed(3), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", rd(`fit_${i}.mp4`)]);
  // per-beat audio = the line then a breath of silence, padded to the shot length
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd(`line_${i}.mp3`), "-af", `apad=pad_dur=${(CFG.pause + 0.3).toFixed(2)}`, "-t", disp.toFixed(3), "-ar", "48000", "-ac", "2", "-c:a", "aac", rd(`a_${i}.m4a`)]);
}
// concat video with short dissolves (xfade chain)
const offs = []; let acc = 0;
for (let i = 0; i < scenes.length; i++) { const disp = lineDur[i] + CFG.pause; if (i > 0) offs.push(acc - CFG.dissolve); acc += disp - (i > 0 ? CFG.dissolve : 0); }
let fc = "", prev = "0:v";
for (let i = 1; i < scenes.length; i++) { const lbl = i === scenes.length - 1 ? "vx" : `x${i}`; fc += `[${prev}][${i}:v]xfade=transition=fade:duration=${CFG.dissolve}:offset=${offs[i - 1].toFixed(3)}[${lbl}];`; prev = lbl; }
fc += `[${prev}]eq=contrast=1.05:saturation=1.03,vignette=PI/7,noise=alls=4:allf=t[v]`;
const vin = scenes.flatMap((_, i) => ["-i", rd(`fit_${i}.mp4`)]);
await sh("ffmpeg", ["-y", "-loglevel", "error", ...vin, "-filter_complex", fc, "-map", "[v]", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual.mp4")]);
// concat audio (hard, no overlap — beats already include the breath)
await writeFile(rd("aconcat.txt"), scenes.map((_, i) => `file '${rd(`a_${i}.m4a`)}'`).join("\n"));
await sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", rd("aconcat.txt"), "-c:a", "aac", rd("audio.m4a")]);
// title
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.8),0,if(lt(t,1.8),(t-0.8),if(lt(t,4.2),1,if(lt(t,5.2),1-(t-4.2),0))))'";
const T = CFG.title.replace(/[':]/g, ""), K = CFG.kicker.replace(/[':]/g, "");
const sc = OH / 1080, fz1 = Math.round(124 * sc), fz2 = Math.round(48 * sc), ky = Math.round(154 * sc); // scale title to canvas
const vf = [`drawtext=fontfile=${F_SC}:text='${T}':fontcolor=0xEAD9B0:fontsize=${fz1}:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0x000000C0:shadowx=0:shadowy=2:${A}`, `drawtext=fontfile=${F_IT}:text='${K}':fontcolor=0xD9C8A2:fontsize=${fz2}:x=(w-text_w)/2:y=h*0.40+${ky}:borderw=2:bordercolor=0x000000B0:${A}`].join(",");
await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("visual.mp4"), "-vf", `${vf},fade=t=out:st=${(acc - 1).toFixed(2)}:d=1`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled.mp4")]);
await sh("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("titled.mp4"), "-i", rd("audio.m4a"), "-filter_complex", "[1:a]adelay=120|120[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("final.mp4")]);
await copyFile(rd("final.mp4"), join(WEB, `${CFG.slug}.mp4`));
console.log("DONE " + join(WEB, `${CFG.slug}.mp4`));
