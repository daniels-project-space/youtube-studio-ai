// LORECRAFT — a painterly first-person LORE micro-doc in the Game of Thrones
// "Histories & Lore" style, for Middle-earth. Painterly concept-art paintings +
// documotion's Remotion camera (depth_parallax → cinematic drift) under a warm
// painterly grade, with a first-person character narration. 30s test.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJsonPro } from "@/lib/gemini";
import { synthNarration } from "@/lib/tts";
import { renderDocuMotion } from "@/lib/remotionRender";

const RUN = join(process.cwd(), "output", "lorecraft", "moria");
await mkdir(RUN, { recursive: true });
const rd = (f) => join(RUN, f);
const log = (m) => console.error("[lore]", m);
await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"] });
const KEY = process.env.GEMINI_API_KEY;

const STYLE =
  "An epic fantasy HISTORY-AND-LORE illustration, hand-PAINTED concept-art / matte-painting style: rich visible " +
  "brushstrokes, ink-wash and oil texture, dramatic chiaroscuro lighting, drifting atmospheric haze and god-rays, a muted " +
  "earthy palette with a single warm GOLD accent, vast ancient scale, a clear foreground silhouette reading against a misty " +
  "receding background (deep layered depth). Cinematic 16:9. ABSOLUTELY NO text, NO words, NO letters anywhere.";

async function genPainting(prompt, out) {
  if (existsSync(out)) return;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${STYLE}\nSCENE: ${prompt}` }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json();
  const p = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
  if (!p) throw new Error("no image: " + JSON.stringify(j?.error || j).slice(0, 140));
  await writeFile(out, Buffer.from(p.inlineData.data, "base64"));
}

function sh(cmd, args) {
  return new Promise((res, rej) => { const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; c.stderr.on("data", (d) => (e += d)); c.on("close", (x) => (x === 0 ? res() : rej(new Error(`${cmd} ${x}: ${e.slice(-300)}`)))); });
}

// 1. STORY — Gemini writes the first-person narration + 4 painterly scene prompts
let plan;
if (existsSync(rd("plan.json"))) plan = JSON.parse(await readFile(rd("plan.json"), "utf8"));
else {
  plan = await geminiJsonPro({
    prompt:
      "You are writing a Lord of the Rings LORE micro-documentary in the exact spirit of the Game of Thrones 'Histories & " +
      "Lore' featurettes: a single character narrates their OWN realm's history in FIRST PERSON — proud, weary, intimate, " +
      "epic, never breathless. TOPIC: the history of KHAZAD-DÛM (Moria), narrated by a LORD OF DURIN'S FOLK. Write ~80 words " +
      "of narration as a tight arc: the glory of the kingdom under the mountain → delving ever deeper for mithril → waking a " +
      "shadow older than the world (the Balrog, Durin's Bane) → the fall, the realm become a tomb → the enduring line of " +
      "Durin. Lore-accurate. Then exactly 4 SCENE prompts, one per beat, each a vivid PAINTERLY scene description with a " +
      "CLEAR FOREGROUND subject and a misty deep background (atmospheric, cinematic, NO text). " +
      'Return STRICT JSON: {"narration":"...","title":"KHAZAD-DÛM","kicker":"the kingdom under the mountain","scenes":[{"prompt":"..."}]}',
    maxTokens: 2000, temperature: 0.7,
  });
  await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
}
log(`narration (${plan.narration.split(/\s+/).length} words); ${plan.scenes.length} scenes`);

// 2. PAINTINGS
for (let i = 0; i < plan.scenes.length; i++) { await genPainting(plan.scenes[i].prompt, rd(`scene_${i}.png`)); log(`scene ${i} ✓`); }

// 3. NARRATION (deep, weary, epic voice) + its duration
if (!existsSync(rd("narr.mp3"))) {
  const bytes = await synthNarration({ text: plan.narration, provider: "elevenlabs", elevenVoiceId: "IKne3meq5aSn9XLyUdCD" });
  await writeFile(rd("narr.mp3"), Buffer.from(bytes)); log("narration ✓");
}
const durStr = await new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", rd("narr.mp3")]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(o.trim())); });
const narrSec = Math.max(20, parseFloat(durStr) || 30);
const totalSec = narrSec + 1.4;                       // small tail
log(`narration ${narrSec.toFixed(1)}s -> video ${totalSec.toFixed(1)}s`);

// 4. SHOTS — depth_parallax (cinematic drift) over each painting, weighted equally
const FPS = 30, total = Math.round(totalSec * FPS);
const moves = ["push_in", "pan_left", "push_in", "pull_out"];
const per = Math.floor(total / plan.scenes.length);
const shots = [];
for (let i = 0; i < plan.scenes.length; i++) {
  const buf = await readFile(rd(`scene_${i}.png`));
  shots.push({
    kind: "depth_parallax",
    durationInFrames: i === plan.scenes.length - 1 ? total - per * (plan.scenes.length - 1) : per,
    camera: { move: moves[i % moves.length], intensity: "medium" },
    images: [`data:image/png;base64,${buf.toString("base64")}`],
    ...(i === 0 ? { title: plan.title, kicker: plan.kicker } : {}),
  });
}

// 5. PAINTERLY THEME (warm, textured, dwarven gold)
const THEME = {
  base: "#0a0807", paper: "#e9ddc2", ink: "#1a1410", accent: "#c89b3c", accent2: "#7a5524",
  fontDisplay: "Cinzel, serif", displayCharW: 0.62, fontLabel: "EB Garamond, serif", fontHand: "EB Garamond, serif",
  plateFilter: "contrast(1.07) saturate(0.9) brightness(0.99) sepia(0.07)", grain: 0.14, vignette: 0.66, flickerTint: "#1a1206",
};

// 6. RENDER (visual) + MUX narration
log("rendering Remotion…");
await renderDocuMotion({
  shots, theme: THEME, width: 1920, height: 1080,
  fontCss: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=EB+Garamond&display=swap",
  fontProbe: ["Cinzel", "EB Garamond", "EB Garamond"],
  outPath: rd("visual.mp4"), log,
});
log("mux narration…");
await sh("ffmpeg", ["-y", "-i", rd("visual.mp4"), "-i", rd("narr.mp3"), "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria.mp4")]);
console.log("DONE " + rd("moria.mp4"));
