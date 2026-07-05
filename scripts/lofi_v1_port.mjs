// FAITHFUL PORT of the v1 lofi-generator (the engine that made ocean_cafe_v2).
//  still -> Gemini-Vision motion prompt -> kling-v3-omni-video 2x15s seamless loop -> deblur/title + music.
//  RULES (from lofi-generator/CLAUDE.md): NO crossfade, NO boomerang, NO upscale.
//  Clip A: start only -> MAX animation. Clip B: start=lastA, end=origin -> returns to start.
//  Concat A+B = 30s unit (last frame == first frame) -> stream_loop = invisible seam.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN", "GEMINI_API_KEY"] });
const RT = process.env.REPLICATE_API_TOKEN, GK = process.env.GEMINI_API_KEY;
const STILL = process.argv[2] || "/var/www/html/lofi/beachcafe3.png";
const MUSIC = "/var/www/html/lofi/oceancafe_music.mp3";
const OUT = process.argv[3] || "/var/www/html/lofi/lofi_v1port.mp4";
const W = "/tmp/lofiport"; await mkdir(W, { recursive: true });
const sh = (a) => { const r = spawnSync(a[0], a.slice(1), { encoding: "utf8" }); if (r.status !== 0) throw new Error(a[0] + " failed: " + (r.stderr || "").slice(-300)); return r; };
const ffprobeDur = (f) => parseFloat(spawnSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout.trim());

async function uploadFile(path, name) {
  const buf = await readFile(path); const form = new FormData();
  form.append("content", new Blob([buf], { type: "image/png" }), name);
  const r = await fetch("https://api.replicate.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${RT}` }, body: form });
  return (await r.json()).urls.get;
}
async function kling(input, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sub = await fetch("https://api.replicate.com/v1/models/kwaivgi/kling-v3-omni-video/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
    let p = await sub.json();
    if (sub.status === 429) { await new Promise((r) => setTimeout(r, 30000 * (attempt + 1))); continue; }
    const g = p.urls?.get; const t0 = Date.now();
    while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 6000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 900000) break; }
    const url = Array.isArray(p.output) ? p.output[0] : p.output;
    console.error(`\n${label}: ${p.status} predict=${(p.metrics || {}).predict_time}`);
    if (url) return url;
    if (attempt === 2) throw new Error(`${label} failed: ${JSON.stringify(p.error || p.status)}`);
  }
}

// 1) Gemini Vision motion prompt (v1 MOTION_PROMPT_TEMPLATE)
const TEMPLATE = `You are writing an animation prompt for an AI video model to animate this anime scene.

Focus ONLY on foreground and mid-ground elements — background trees and distant landscape should remain still (animating them looks bad). Prioritize what's close to the viewer.

Describe motion for the visible foreground elements in this order:
1. Character — breathing slowly, subtle body sway, rocking if in a boat, hands moving if writing/reading
2. Nearby plants, hanging fabric, windchime, ribbons — gentle movement in breeze
3. Lanterns, candles, lamps — warm flickering light, swinging gently on strings
4. Smoke or steam rising slowly if visible (incense, food, chimney, breath in cold air)
5. Water surface — ripples, shimmering light reflections, rain impacts if raining
6. Fog or mist — barely perceptible slow drift at ground/water level
7. Falling elements — petals, leaves, snowflakes, rain — slow and light

Use slow, weighted, physics-aware language. Nothing fast. This is a calm lofi scene. 80-100 words. Plain text only, no lists, no markdown.`;
const b64 = (await readFile(STILL)).toString("base64");
const gr = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: TEMPLATE }, { inline_data: { mime_type: "image/png", data: b64 } }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } }) })).json();
let motion = gr.candidates[0].content.parts.map((p) => p.text).join("").trim().replace(/^```[a-z]*\n?/, "").replace(/`+$/, "").trim();
console.error("MOTION PROMPT:", motion);

// 2) Clip A — start only, MAX animation
const imgUrl = await uploadFile(STILL, "image.png");
const aUrl = await kling({ mode: "pro", start_image: imgUrl, prompt: motion, duration: 15, aspect_ratio: "16:9", generate_audio: false }, "ClipA");
const clipA = `${W}/clipA.mp4`; await writeFile(clipA, Buffer.from(await (await fetch(aUrl)).arrayBuffer()));

// 3) extract origin (first) + last frame of A, upload
sh(["ffmpeg", "-y", "-i", clipA, "-vframes", "1", "-q:v", "2", `${W}/origin.png`]);
sh(["ffmpeg", "-y", "-sseof", "-0.1", "-i", clipA, "-vframes", "1", "-q:v", "2", `${W}/last.png`]);
const originUrl = await uploadFile(`${W}/origin.png`, "origin.png");
const lastUrl = await uploadFile(`${W}/last.png`, "last.png");

// 4) Clip B — start=last, end=origin -> returns to start
const returnPrompt = motion + " Gently and naturally settling back to the original resting position, very smooth continuous motion.";
const bUrl = await kling({ mode: "pro", start_image: lastUrl, end_image: originUrl, prompt: returnPrompt, duration: 15, aspect_ratio: "16:9", generate_audio: false }, "ClipB");
const clipB = `${W}/clipB.mp4`; await writeFile(clipB, Buffer.from(await (await fetch(bUrl)).arrayBuffer()));

// 5) re-encode both to matching fmt, concat A+B -> 30s unit (last==first)
sh(["ffmpeg", "-y", "-i", clipA, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "24", `${W}/a.mp4`]);
sh(["ffmpeg", "-y", "-i", clipB, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "24", `${W}/b.mp4`]);
await writeFile(`${W}/concat.txt`, `file '${W}/a.mp4'\nfile '${W}/b.mp4'\n`);
sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", `${W}/concat.txt`, "-c", "copy", `${W}/unit30.mp4`]);
console.error("30s seamless unit:", ffprobeDur(`${W}/unit30.mp4`), "s");

// 6) video_builder: stream_loop unit + 20-step deblur + title overlay + music (NO upscale)
const aud = ffprobeDur(MUSIC).toString();
const wdt = 1920, hgt = 1080, chName = "Seaside Cafe", title = "lofi to relax & study";
const fsBig = Math.round(wdt * 0.042), fsSmall = Math.round(wdt * 0.021), yName = Math.round(hgt * 0.46), yTitle = Math.round(hgt * 0.545);
const deblur = Array.from({ length: 20 }, (_, i) => `gblur=sigma=${20 - i}:enable='between(t\\,${(i * 0.4).toFixed(1)}\\,${((i + 1) * 0.4).toFixed(1)})'`).join(",");
const aN = `if(lt(t\\,0.5)\\,0\\,if(lt(t\\,2.0)\\,(t-0.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const aT = `if(lt(t\\,1.5)\\,0\\,if(lt(t\\,3.0)\\,(t-1.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const vf = [
  `scale=${wdt}:${hgt}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${wdt}:${hgt}`, `unsharp=9:9:1.5:5:5:0.6`, deblur, "fade=t=in:st=0:d=2.0",
  `drawtext=fontfile='${FB}':text='${chName}':fontsize=${fsBig}:fontcolor=white:alpha='${aN}':x=(w-text_w)/2:y=${yName}`,
  `drawtext=fontfile='${FR}':text='${title}':fontsize=${fsSmall}:fontcolor=C8C8D2:alpha='${aT}':x=(w-text_w)/2:y=${yTitle}`,
].join(",");
sh(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", `${W}/unit30.mp4`, "-i", MUSIC, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "320k", "-pix_fmt", "yuv420p", "-vf", vf, "-t", aud, "-shortest", "-movflags", "+faststart", OUT]);
console.log("DONE", OUT, ffprobeDur(OUT), "s");
