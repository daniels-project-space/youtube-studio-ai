// FORDLANDIA FULL — add NARRATION + MUSIC to the existing documotion (documentary
// pipeline) visual render. Reuses output/documotion/fordlandia-v2/final.mp4 (the
// latest documentary-path render); the plan's per-shot narration is empty on this
// older render, so we WRITE the VO from the plan's beats, TTS it, generate a Suno
// underscore, and mux (VO + ducked music + loudnorm). documotion stays visual-only.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJsonPro } from "../src/lib/gemini.ts";
import { synthNarration } from "../src/lib/tts.ts";
import { generateSuno } from "../src/lib/music.ts";

const log = (m) => console.error(`[ford-full] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "SUNO_API_KEY"] });

const RUN = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "fordlandia-v2");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const sh = (a) => new Promise((res, rej) => { const p = spawn(FFMPEG, a, { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (c) => (c === 0 ? res() : rej(new Error(e.slice(-400))))); });
const dur = (f) => new Promise((res, rej) => { const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", () => res(parseFloat(o.trim()))); p.on("error", rej); });

// 1. VISUAL BODY — the existing documentary-path render (verified provenance).
const body = join(RUN, "final.mp4");
if (!existsSync(body)) throw new Error(`no documentary render at ${body}`);
const plan = JSON.parse(await readFile(join(RUN, "plan.json"), "utf8"));
const D = await dur(body);
log(`documentary body ${D.toFixed(1)}s — "${plan.title}" (documotion path)`);

// 2. NARRATION — write the VO from the plan's beats (this render predates the
// planner's per-shot narration), fitted to the video length.
const beats = plan.shots.map((s) => s.beat).filter(Boolean);
const words = Math.round(D * 2.35);
const g = await geminiJsonPro({
  prompt:
    `Write flowing cinematic DOCUMENTARY NARRATION for a ${Math.round(D)}-second history video about Fordlandia — Henry Ford's failed jungle rubber city in the Amazon. ` +
    `Follow these ${beats.length} visual beats IN ORDER as one cohesive spoken piece (NO headings, NO shot labels, NO numbering):\n` +
    beats.map((b, i) => `${i + 1}. ${b}`).join("\n") +
    `\n\nAbout ${words} words so it fits ~${Math.round(D)} seconds of measured, warm narrator-teacher delivery. Vivid and factual, a quiet irony on the final beat. Return STRICT JSON {"narration":string}.`,
  maxTokens: 1200,
  temperature: 0.6,
  log,
});
const narration = (g.narration || "").trim();
if (!narration) throw new Error("narration generation returned empty");
log(`narration: ${narration.split(/\s+/).length} words`);
const narrPath = join(RUN, "narration.mp3");
let nb;
try {
  nb = await synthNarration({ text: narration, provider: "elevenlabs" }); // George — warm documentary storyteller
} catch (e) {
  log(`elevenlabs failed (${e.message}) — Fish fallback`);
  nb = await synthNarration({ text: narration, niche: "history", speed: 0.97 });
}
await writeFile(narrPath, nb);
const narrDur = await dur(narrPath);
log(`narration audio ${narrDur.toFixed(1)}s`);

// 3. MUSIC — warm reflective history-doc underscore (Suno, instrumental).
const musicPath = join(RUN, "music.wav");
if (!existsSync(musicPath)) {
  const m = await generateSuno({
    prompt: "warm reflective orchestral documentary underscore, soft strings and piano, contemplative and faintly melancholic, cinematic history documentary, instrumental, no vocals",
    title: "Fordlandia",
    wantClips: 1,
    preferWav: true,
  });
  const r = await fetch(m.url);
  await writeFile(musicPath, Buffer.from(await r.arrayBuffer()));
  log(`music ${m.provider} ${m.jobId}`);
} else {
  log("reusing cached music.wav");
}

// 4. MUX — VO + sidechain-ducked music, loudnorm, onto the body (robbery-full flow).
const full = join(RUN, "fordlandia_full.mp4");
await sh([
  "-y", "-i", body, "-i", narrPath, "-i", musicPath,
  "-filter_complex",
  `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=300:all=1,apad,asplit=2[nar][narkey];` +
  `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2147483647,atrim=0:${D.toFixed(2)},volume=0.4,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, D - 3).toFixed(2)}:d=3[mus];` +
  `[mus][narkey]sidechaincompress=threshold=0.05:ratio=12:attack=15:release=380[musd];` +
  `[nar][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", D.toFixed(2), full,
]);
log(`muxed → ${full}`);
console.log(JSON.stringify({ video: full, durationSec: D, narrationWords: narration.split(/\s+/).length, narration }, null, 2));
