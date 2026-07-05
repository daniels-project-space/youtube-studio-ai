// Faithful v1 lofi pipeline + SKY-MOTION GATE (basis for the standalone golden module).
//   Flux 1.1 Pro Ultra still -> DETAILED Gemini-Vision motion prompt -> kling-v3-omni-video 2x15s
//   seamless loop (A max-anim + B returns to origin, concat = last==first) -> deblur/title + music.
//   RULES: no crossfade, no boomerang, no upscale. Every stage cached -> resumable.
//   NEW: birds present in the still + a forced sky-motion clause + a gate that MEASURES upper-sky
//        motion after Clip A and regenerates with escalating prompts until clouds+birds clearly move.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN", "GEMINI_API_KEY"] });
const RT = process.env.REPLICATE_API_TOKEN, GK = process.env.GEMINI_API_KEY;

const CFG = {
  slug: "seaside_birds",
  channel: "Seaside Cafe",
  title: "lofi to relax & study",
  music: "/var/www/html/lofi/oceancafe_music.mp3",
  // SKY crop for the motion gate: top 34% height, right 70% width (excludes the top-left tree foliage)
  skyCrop: "crop=in_w*0.70:in_h*0.34:in_w*0.30:0",
  skyMin: 3.0,        // required avg sky-band frame-diff YAVG (baseline weak clouds ~1.5; birds+drift -> 4-8)
  skyTries: 3,
  scene:
    "Hand-painted Studio Ghibli anime lofi illustration, bright cheerful sunny afternoon, warm golden light, vivid blue sky with big soft billowing white clouds AND a few small distant birds gliding high across the open sky. A cozy wooden seaside cafe terrace built on a deck over a calm sparkling turquoise bay. A cute young anime girl with a brown ponytail in a soft yellow sundress and a small apron stands watering a row of hanging flower baskets and potted plants with a little watering can, smiling gently. A fluffy orange-and-white cat with a big bushy tail lounges curled on a cushioned wooden chair beside her. A small round wooden table holds a steaming cup of coffee and an open book. A striped parasol, hanging paper lanterns, a blossoming cherry tree leaning over the deck shedding a few petals, white sailboats drifting on the bay, a lush green island on the horizon. Wide cozy cinematic composition, wholesome, vibrant, calm lofi mood. No text, no letters, no signs, no watermark.",
};
const W = `/tmp/lofi_${CFG.slug}`; await mkdir(W, { recursive: true });
const WEB = "/var/www/html/lofi";
const sh = (a) => { const r = spawnSync(a[0], a.slice(1), { encoding: "utf8" }); if (r.status !== 0) throw new Error(a[0] + " failed: " + (r.stderr || "").slice(-300)); return r; };
const ffdur = (f) => parseFloat(spawnSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());

async function uploadFile(path, name) {
  const buf = await readFile(path); const form = new FormData();
  form.append("content", new Blob([buf], { type: "image/png" }), name);
  const r = await fetch("https://api.replicate.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${RT}` }, body: form });
  return (await r.json()).urls.get;
}
async function poll(p) { const g = p.urls?.get; const t0 = Date.now(); while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 6000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 900000) break; } return p; }
async function replicate(model, input, label) {
  for (let a = 0; a < 3; a++) {
    const sub = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
    if (sub.status === 429) { await new Promise((r) => setTimeout(r, 30000 * (a + 1))); continue; }
    let p = await poll(await sub.json());
    const url = Array.isArray(p.output) ? p.output[0] : p.output;
    console.error(`\n${label}: ${p.status} predict=${(p.metrics || {}).predict_time}`);
    if (url) return url;
    if (a === 2) throw new Error(`${label} failed: ${JSON.stringify(p.error || p.status).slice(0, 200)}`);
  }
}

// SKY-MOTION GATE: sample upper-sky band across the clip, measure consecutive frame-diff luminance.
function measureSky(clip) {
  const ts = [1, 4, 7, 10, 13], frames = ts.map((t) => { const f = `${W}/sky_${t}.png`; sh(["ffmpeg", "-y", "-loglevel", "error", "-ss", String(t), "-i", clip, "-vframes", "1", "-vf", CFG.skyCrop, f]); return f; });
  const vals = [];
  for (let i = 1; i < frames.length; i++) {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "info", "-i", frames[i - 1], "-i", frames[i], "-filter_complex", "[0][1]blend=all_mode=difference,signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" });
    const m = (r.stderr || "").match(/signalstats\.YAVG=([0-9.]+)/);
    if (m) vals.push(parseFloat(m[1]));
  }
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  return { avg, vals };
}

// 1) Flux 1.1 Pro Ultra still (NO width/height — aspect_ratio only)
const still = `${W}/still.png`;
if (!existsSync(still)) {
  const url = await replicate("black-forest-labs/flux-1.1-pro-ultra", { prompt: CFG.scene, aspect_ratio: "16:9", output_format: "png", safety_tolerance: 6 }, "Flux");
  await writeFile(still, Buffer.from(await (await fetch(url)).arrayBuffer()));
}
await writeFile(`${WEB}/${CFG.slug}_still.png`, await readFile(still));

// 2) DETAILED Gemini-Vision motion prompt
const TEMPLATE = `You are writing a DETAILED animation prompt for an AI video model to bring this cozy anime lofi scene to life with rich, layered, continuous looping motion. Be specific and vivid about EACH visible element you actually see — name them.

Describe gentle continuous motion for, in order of prominence:
1. THE SKY — the clouds must DRIFT clearly and visibly across the sky in a steady direction, billowing and slowly reshaping as they move (NOT frozen, NOT imperceptible — clearly moving). Any birds GLIDE and gently flap as they fly across the open sky, crossing the frame. The sky should read as alive and constantly moving.
2. THE CHARACTER — give her a clear, natural TASK she performs in a calm repeating loop (watering the plants and tilting the can, sweeping, wiping the counter, arranging cups or flowers, reading and slowly turning a page, sipping from a cup) PLUS slow breathing, a soft body sway, and small natural hand movements. Be specific about her hands and what she is doing.
3. THE CAT or pet — clearly alive: its fluffy TAIL slowly waving and swishing back and forth, ears twitching, head turning to look around, a slow blink, an occasional stretch or shift of weight.
4. Foreground plants, flowers, hanging baskets, fabric, awning, parasol, windchimes, ribbons — swaying and rustling softly in a gentle breeze.
5. THE TREE — its leaves and slender branches swaying gently in a light wind (subtle, the foliage moves, not the trunk); a few petals or leaves loosening and drifting.
6. Lanterns, candles, lamps, fairy lights — warm light gently flickering, lanterns swinging slightly on their strings.
7. Steam or smoke — rising slowly and curling from any hot drink, food, or chimney.
8. The WATER — surface rippling, sunlight shimmering and sparkling on it, small waves rolling to shore, any boat bobbing gently.
9. Falling petals, leaves, or pollen — drifting down slowly and lightly.

Use slow, weighted, physics-aware language. Everything calm, smooth and continuous — nothing fast or jerky. This is a cozy lofi loop. Be detailed and specific to THIS image. 130-160 words. Plain text only, no lists, no markdown.`;
const b64 = (await readFile(still)).toString("base64");
const gr = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: TEMPLATE }, { inline_data: { mime_type: "image/png", data: b64 } }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } }) })).json();
const motion = gr.candidates[0].content.parts.map((p) => p.text).join("").trim().replace(/^```[a-z]*\n?/, "").replace(/`+$/, "").trim();
console.error("MOTION PROMPT:", motion);

// Escalating sky-motion directives appended to the prompt (forced, deterministic — not reliant on Gemini)
const SKY_ESC = [
  " Across the open sky the white clouds drift steadily and visibly from one side to the other, their billowing shapes slowly swelling and morphing as they move; several small birds glide and gently flap across the sky, crossing through the frame. The sky is clearly alive with constant continuous movement.",
  " IMPORTANT: the clouds must move a LOT — drifting clearly and unmistakably across the sky and continuously reshaping; MULTIPLE small birds actively fly, glide and flap across the open sky, crossing the whole frame. The sky is busy with visible motion at all times.",
  " CRITICAL: maximum visible sky motion — large billowing clouds sweep boldly across the sky while a whole flock of birds flies and flaps energetically across the frame from one side to the other. The entire sky is in constant strong motion throughout.",
];

// 3) Clip A — start only, MAX animation (15s) WITH SKY-MOTION GATE (regenerate until sky clearly moves)
const clipA = `${W}/clipA.mp4`;
let skyScore;
if (existsSync(clipA)) {
  skyScore = measureSky(clipA);
  console.error(`SKY MOTION (cached clipA): avg=${skyScore.avg.toFixed(2)} pairs=${skyScore.vals.map((v) => v.toFixed(1)).join(",")}`);
} else {
  const imgUrl = await uploadFile(still, "image.png");
  let best = { avg: -1 }, bestBuf = null;
  for (let t = 0; t < CFG.skyTries; t++) {
    const prompt = motion + SKY_ESC[Math.min(t, SKY_ESC.length - 1)];
    const aUrl = await replicate("kwaivgi/kling-v3-omni-video", { mode: "pro", start_image: imgUrl, prompt, duration: 15, aspect_ratio: "16:9", generate_audio: false }, `ClipA try${t}`);
    await writeFile(clipA, Buffer.from(await (await fetch(aUrl)).arrayBuffer()));
    const s = measureSky(clipA);
    console.error(`SKY MOTION try${t}: avg=${s.avg.toFixed(2)} (min ${CFG.skyMin}) pairs=${s.vals.map((v) => v.toFixed(1)).join(",")}`);
    if (s.avg > best.avg) { best = s; bestBuf = await readFile(clipA); }
    if (s.avg >= CFG.skyMin) { console.error(`SKY GATE PASS on try${t}`); break; }
    console.error(t < CFG.skyTries - 1 ? "SKY GATE FAIL — regenerating clipA with stronger sky motion" : "SKY GATE: tries exhausted, keeping best clipA");
  }
  if (bestBuf) await writeFile(clipA, bestBuf); // ensure the best take is on disk
  skyScore = best;
}

// 4) Clip B — start=last frame of A, end=origin -> returns to start
const clipB = `${W}/clipB.mp4`;
if (!existsSync(clipB)) {
  sh(["ffmpeg", "-y", "-i", clipA, "-vframes", "1", "-q:v", "2", `${W}/origin.png`]);
  sh(["ffmpeg", "-y", "-sseof", "-0.1", "-i", clipA, "-vframes", "1", "-q:v", "2", `${W}/last.png`]);
  const originUrl = await uploadFile(`${W}/origin.png`, "origin.png");
  const lastUrl = await uploadFile(`${W}/last.png`, "last.png");
  const returnPrompt = motion + " The clouds gently drift back and the birds glide back across the sky as everything settles smoothly to the original resting position, very smooth continuous looping motion that returns to the start.";
  const bUrl = await replicate("kwaivgi/kling-v3-omni-video", { mode: "pro", start_image: lastUrl, end_image: originUrl, prompt: returnPrompt, duration: 15, aspect_ratio: "16:9", generate_audio: false }, "ClipB");
  await writeFile(clipB, Buffer.from(await (await fetch(bUrl)).arrayBuffer()));
}
// 5) concat A+B -> 30s unit (last==first)
const unit = `${W}/unit30.mp4`;
if (!existsSync(unit)) {
  sh(["ffmpeg", "-y", "-i", clipA, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "24", `${W}/a.mp4`]);
  sh(["ffmpeg", "-y", "-i", clipB, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "24", `${W}/b.mp4`]);
  await writeFile(`${W}/concat.txt`, `file '${W}/a.mp4'\nfile '${W}/b.mp4'\n`);
  sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", `${W}/concat.txt`, "-c", "copy", unit]);
}
console.error("30s seamless unit:", ffdur(unit), "s");
console.error(`SKY MOTION final: avg=${skyScore.avg.toFixed(2)} (min ${CFG.skyMin}) -> ${skyScore.avg >= CFG.skyMin ? "PASS" : "BELOW TARGET"}`);

// 6) video_builder: stream_loop + 20-step deblur + title + music (NO upscale)
const OUT = `${WEB}/${CFG.slug}.mp4`;
const aud = String(ffdur(CFG.music));
const wd = 1920, hg = 1080, fsBig = Math.round(wd * 0.042), fsSm = Math.round(wd * 0.021), yN = Math.round(hg * 0.46), yT = Math.round(hg * 0.545);
const deblur = Array.from({ length: 20 }, (_, i) => `gblur=sigma=${20 - i}:enable='between(t\\,${(i * 0.4).toFixed(1)}\\,${((i + 1) * 0.4).toFixed(1)})'`).join(",");
const aN = `if(lt(t\\,0.5)\\,0\\,if(lt(t\\,2.0)\\,(t-0.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const aT = `if(lt(t\\,1.5)\\,0\\,if(lt(t\\,3.0)\\,(t-1.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const vf = [`scale=${wd}:${hg}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${wd}:${hg}`, `unsharp=9:9:1.5:5:5:0.6`, deblur, "fade=t=in:st=0:d=2.0",
  `drawtext=fontfile='${FB}':text='${CFG.channel}':fontsize=${fsBig}:fontcolor=white:alpha='${aN}':x=(w-text_w)/2:y=${yN}`,
  `drawtext=fontfile='${FR}':text='${CFG.title}':fontsize=${fsSm}:fontcolor=C8C8D2:alpha='${aT}':x=(w-text_w)/2:y=${yT}`].join(",");
sh(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", unit, "-i", CFG.music, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "320k", "-pix_fmt", "yuv420p", "-vf", vf, "-t", aud, "-shortest", "-movflags", "+faststart", OUT]);
console.log("DONE", OUT, ffdur(OUT), "s");
