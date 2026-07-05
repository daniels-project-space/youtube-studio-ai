// FORDLANDIA RE-RENDER — the delivered visual (final.mp4, 12:28) predates the
// documotion text-collision fixes (title collision / text-never-behind-cutouts /
// text-cutout separation, 12:52-14:32) that the detective+robbery renders use.
// Re-render the SAME cached plan + assets through the CURRENT composition, then
// reuse the approved narration.mp3 + music.wav and re-mux (frame-hold extend).
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { craftDocuMotion } from "../src/lib/documotion.ts";

const log = (m) => console.error(`[ford-rr] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

const RUN = join(process.cwd(), "output", "documotion", "fordlandia-v2");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const sh = (a) => new Promise((res, rej) => { const p = spawn(FFMPEG, a, { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (c) => (c === 0 ? res() : rej(new Error(e.slice(-500))))); });
const dur = (f) => new Promise((res, rej) => { const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", () => res(parseFloat(o.trim()))); p.on("error", rej); });

// 1. RE-RENDER visual from cached plan + assets through the current composition.
const plan = JSON.parse(await readFile(join(RUN, "plan.json"), "utf8"));
log(`re-rendering "${plan.title}" - ${plan.shots.length} shots, current composition`);
const fixed = join(RUN, "final_fixed.mp4");
const { outPath } = await craftDocuMotion({ topic: plan.title, runDir: RUN, durationSec: 60, maxRefineRounds: 0, outPath: fixed, log });
const Dv = await dur(outPath);
log(`visual re-rendered ${Dv.toFixed(2)}s -> ${outPath}`);

// 2. Reuse the approved ElevenLabs narration + Suno music (no re-synth).
const narrPath = join(RUN, "narration.mp3");
const musicPath = join(RUN, "music.wav");
if (!existsSync(narrPath)) throw new Error("narration.mp3 missing");
if (!existsSync(musicPath)) throw new Error("music.wav missing");
const Dn = await dur(narrPath);
const T = +(Dn + 1.2).toFixed(2); // hold last frame ~1.2s past the VO tail
log(`narration ${Dn.toFixed(2)}s -> target ${T}s (frame-hold extend ${(T - Dv).toFixed(2)}s)`);

// 3. Frame-hold extend the visual to the VO length.
const ext = join(RUN, "extended_fixed.mp4");
await sh(["-y", "-i", outPath, "-vf", `tpad=stop_mode=clone:stop_duration=${Math.max(0, T - Dv).toFixed(2)}`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-t", T.toFixed(2), ext]);

// 4. MUX — VO + sidechain-ducked music, loudnorm (same chain as the full script).
const full = join(RUN, "fordlandia_full.mp4");
const tmp = join(RUN, "fordlandia_full_new.mp4");
await sh([
  "-y", "-i", ext, "-i", narrPath, "-i", musicPath,
  "-filter_complex",
  `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=300:all=1,apad,asplit=2[nar][narkey];` +
  `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2147483647,atrim=0:${T.toFixed(2)},volume=0.4,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, T - 3).toFixed(2)}:d=3[mus];` +
  `[mus][narkey]sidechaincompress=threshold=0.05:ratio=12:attack=15:release=380[musd];` +
  `[nar][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", T.toFixed(2), tmp,
]);
await rename(tmp, full);
log(`muxed -> ${full}`);
console.log(JSON.stringify({ video: full, visualSec: Dv, finalSec: T }, null, 2));
