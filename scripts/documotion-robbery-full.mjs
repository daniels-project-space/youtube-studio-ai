// ROBBERY FULL DELIVERABLE — composes the modules around the documotion visual
// body: VISUAL (craftDocuMotion) + NARRATION (Gemini VO → ElevenLabs) + MUSIC
// (Suno, ducked) muxed, plus a GOLDEN thumbnail (banana) and a GOLDEN title
// (metacraft). documotion itself stays visual-only; this script assembles.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuMotion } from "../src/lib/documotion.ts";
import { geminiJson } from "../src/lib/gemini.ts";
import { synthNarration } from "../src/lib/tts.ts";
import { generateSuno } from "../src/lib/music.ts";
import { craftMetadata } from "../src/lib/metacraft.ts";
import { buildThumbBrief, bananaThumbnail } from "../src/lib/banana.ts";

const log = (m) => console.error(`[robbery] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "FAL_KEY", "SUNO_API_KEY"] });

const RUN = process.env.DOCU_RUN_DIR || join(process.cwd(), "output", "documotion", "robbery");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const sh = (a) => new Promise((res, rej) => { const p = spawn(FFMPEG, a, { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (c) => (c === 0 ? res() : rej(new Error(e.slice(-400))))); });
const dur = (f) => new Promise((res, rej) => { const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", () => res(parseFloat(o.trim()))); p.on("error", rej); });

const topic =
  "The 2003 Antwerp Diamond Heist — the heist of the century. Leonardo Notarbartolo and the School of Turin bypassed " +
  "ten layers of security (a 100-million-combination lock, infrared, a seismic sensor, a magnetic field, Doppler radar) " +
  "two floors underground and stole over 100 million dollars in diamonds and gold — then a bag of half-eaten sandwiches " +
  "and a partial DNA trace undid them.";

// 1. VISUAL BODY (reuses cached plan + assets in RUN; re-renders clean fonts)
const visual = await craftDocuMotion({ topic, style: "robbery_noir", durationSec: 60, runDir: RUN, maxRefineRounds: 1, log });
const body = visual.outPath;
const D = await dur(body);
log(`visual body ${D.toFixed(1)}s — ${visual.plan.title}`);

// 2. GOLDEN TITLE (metacraft)
const meta = await craftMetadata({
  topic,
  channelName: "Vault Files",
  niche: "true crime",
  scriptExcerpt: visual.plan.shots.map((s) => s.beat).join(" "),
  log,
}).catch((e) => { log(`metacraft failed: ${e.message}`); return null; });
const title = meta?.title || visual.plan.title;
log(`TITLE: ${title}`);

// 3. NARRATION — one tight VO take from the shot beats, then ElevenLabs
const beats = visual.plan.shots.map((s, i) => `${i + 1}. ${s.beat}`).join("\n");
const { narration } = await geminiJson({
  prompt:
    `Write a tense, cinematic true-crime NARRATION for a 60-second video titled "${title}" about the Antwerp Diamond ` +
    `Heist. Follow these ${visual.plan.shots.length} visual beats IN ORDER, ~1 sentence each, present tense, concrete, ` +
    `no filler, building suspense and landing on the irony of the sandwiches. TOTAL about 135 words.\nBEATS:\n${beats}\n` +
    `Return STRICT JSON {"narration":"the full voiceover as one string"}.`,
  maxTokens: 1200,
  temperature: 0.6,
});
const narrPath = join(RUN, "narration.mp3");
await writeFile(narrPath, await synthNarration({ text: narration, provider: "elevenlabs" }));
const narrDur = await dur(narrPath);
log(`narration ${narrDur.toFixed(1)}s (${narration.split(/\s+/).length} words)`);

// 4. MUSIC — tense heist underscore (Suno, instrumental)
const musicPath = join(RUN, "music.wav");
if (!existsSync(musicPath)) {
  const m = await generateSuno({ prompt: "tense cinematic heist underscore, pulsing low strings and ticking percussion, dark and suspenseful, instrumental, no vocals", title: title.slice(0, 70), wantClips: 1, preferWav: true });
  const r = await fetch(m.url); await writeFile(musicPath, Buffer.from(await r.arrayBuffer()));
  log(`music ${m.provider} ${m.jobId}`);
}

// 5. MUX — VO + ducked music, loudnorm, onto the body
const full = join(RUN, "robbery_full.mp4");
await sh([
  "-y", "-i", body, "-i", narrPath, "-i", musicPath,
  "-filter_complex",
  // narration → stereo, delayed, split into the mix copy + the sidechain key
  `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=300:all=1,apad,asplit=2[nar][narkey];` +
  `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2147483647,atrim=0:${D.toFixed(2)},volume=0.42,afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, D - 3).toFixed(2)}:d=3[mus];` +
  `[mus][narkey]sidechaincompress=threshold=0.05:ratio=12:attack=15:release=380[musd];` +
  `[nar][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", D.toFixed(2), full,
]);
log(`muxed → ${full}`);

// 6. GOLDEN THUMBNAIL (banana)
const thumb = join(RUN, "thumbnail.jpg");
const brief = buildThumbBrief({
  channelName: "Vault Files",
  imageStyle: "cinematic heist-thriller still, teal-and-amber night grade, deep film noir shadows, 35mm grain",
  palette: ["#0a0e12", "#e8b23a", "#3fb6a0"],
  accentColor: "#e8b23a",
  textObject: "stamp_ink",
  composition: "cutout_collage",
  scene: "a gloved hand on a brass vault dial in a dark Antwerp diamond vault, scattered loose diamonds catching amber light, tense and cinematic",
  lines: [{ text: "10 LAYERS", accent: true }, { text: "1 MISTAKE", payoff: true }],
  badge: "TRUE CRIME",
});
const tr = await bananaThumbnail({ brief, outJpg: thumb, expectWords: ["10 LAYERS", "1 MISTAKE"], imageStyle: "cinematic heist-thriller noir still", title, log }).catch((e) => { log(`thumb failed: ${e.message}`); return null; });

// 7. OUTPUT — local artifacts only (serve via the VPS; no external publishing)
console.log(JSON.stringify({
  video: full, thumbnail: tr?.path ?? null, thumbVerdict: tr?.verdict ?? null,
  title, titleAlternate: meta?.titleAlternate ?? null, description: meta?.description ?? null,
  planTitle: visual.plan.title, verdict: visual.verdict,
}, null, 2));
