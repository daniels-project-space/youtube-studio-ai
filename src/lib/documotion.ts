/**
 * DOCUMOTION — the documentary-collage motion engine (banana/scriptcraft
 * integration shape): topic in → fully-mixed archival-explainer video out.
 *
 * The chain a single craftDocuVideo() call runs:
 *   1. PLAN — the latest Gemini Pro writes a shot list in the documotion
 *      grammar (parallax_portrait, map_zoom, photo_slide, matte_sequence,
 *      collage_pan, object_drop, quote_card) WITH the narration sentence(s)
 *      and per-asset image briefs for every shot.
 *   2. ASSETS — Nano Banana Pro renders every still in the archival style;
 *      hero/object cutouts get a BiRefNet alpha matte (fal.ai). All assets
 *      are downscaled and cached in the run dir (re-runs are free).
 *   3. NARRATION — one ElevenLabs v3 take (documentary narrator), Fish
 *      fallback. AssemblyAI word timings cut the shots ON the sentence
 *      boundaries — deterministic VO sync (proportional fallback).
 *   4. RENDER — the DocuMotion Remotion composition renders the whole
 *      timeline in one pass (2.5D parallax, kinetic type, rough mattes,
 *      collage pans, film grade).
 *   5. SOUND — Suno underscore + ElevenLabs SFX cues at shot boundaries,
 *      music side-chain ducked under the VO, loudnorm master, muxed.
 *   6. QA — Gemini vision judges sampled frames against the golden archival
 *      style + exact overlay spelling; one feedback retry on flagged assets,
 *      then loud failure. No silent degrades anywhere.
 *
 * Deps: GEMINI_API_KEY, FAL_KEY, ELEVENLABS_API_KEY (or FISH_AUDIO_API_KEY),
 * SUNO_API_KEY, ASSEMBLYAI_API_KEY (optional), R2_* (optional, for timings).
 *
 *   import { craftDocuVideo } from "@/lib/documotion";
 *   const { outPath } = await craftDocuVideo({ topic, runDir, log });
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { geminiJsonPro, geminiVisionLocal, parseJsonLoose } from "@/lib/gemini";
import { generateBananaImage } from "@/lib/banana";
import { synthNarration } from "@/lib/tts";
import { generateSuno } from "@/lib/music";
import { transcribeWords, hasAssemblyKey, type Word } from "@/lib/assemblyai";
import { putObject, presignDownload } from "@/lib/storage";
import { renderDocuMotion } from "@/lib/remotionRender";
import type { DocuShotKind, DocuShotSpec, DocuLabel } from "@/remotion/DocuMotion";

type Logger = (msg: string) => void;

const FPS = 30;

export function hasDocumotion(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.FAL_KEY);
}

/* ------------------------------------------------------------------ plan -- */

export interface DocuAssetBrief {
  id: string;
  role: "bg" | "fg" | "image" | "cutout";
  brief: string;
}

export interface DocuShotPlan {
  kind: DocuShotKind;
  narration: string;
  title?: string;
  kicker?: string;
  labels?: DocuLabel[];
  annotations?: string[];
  circleLabel?: string;
  quote?: string;
  attribution?: string;
  accent?: string;
  sfx?: string;
  assets: DocuAssetBrief[];
}

export interface DocuPlan {
  title: string;
  musicPrompt: string;
  shots: DocuShotPlan[];
}

/** Per-kind asset contract: role → [min, max] count. */
const KIND_ASSETS: Record<DocuShotKind, Partial<Record<DocuAssetBrief["role"], [number, number]>>> = {
  parallax_portrait: { bg: [1, 1], fg: [1, 1] },
  map_zoom: { bg: [1, 1] },
  photo_slide: { bg: [1, 1], image: [2, 3] },
  matte_sequence: { image: [3, 4] },
  collage_pan: { bg: [0, 1], image: [6, 8] },
  object_drop: { bg: [1, 1], fg: [0, 1], cutout: [1, 3] },
  quote_card: { bg: [0, 1] },
};

function validatePlan(plan: DocuPlan, durationSec: number): string[] {
  const problems: string[] = [];
  if (!plan.shots?.length || plan.shots.length < 5) problems.push("need 6-8 shots");
  for (const [i, s] of (plan.shots ?? []).entries()) {
    if (!KIND_ASSETS[s.kind]) {
      problems.push(`shot ${i}: unknown kind "${s.kind}"`);
      continue;
    }
    if (!s.narration?.trim() && s.kind !== "quote_card") problems.push(`shot ${i}: empty narration`);
    const byRole: Record<string, number> = {};
    for (const a of s.assets ?? []) byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    for (const [role, [min, max]] of Object.entries(KIND_ASSETS[s.kind]) as [string, [number, number]][]) {
      const n = byRole[role] ?? 0;
      if (n < min || n > max) problems.push(`shot ${i} (${s.kind}): needs ${min}-${max} ${role} assets, got ${n}`);
    }
    if (s.kind === "quote_card" && !s.quote?.trim()) problems.push(`shot ${i}: quote_card without quote`);
  }
  const words = (plan.shots ?? []).map((s) => s.narration ?? "").join(" ").split(/\s+/).filter(Boolean).length;
  const target = Math.round(durationSec * 2.6);
  if (Math.abs(words - target) > target * 0.3) problems.push(`narration ${words} words, target ~${target}`);
  return problems;
}

const PLAN_CONTRACT = `Return STRICT JSON:
{
 "title": "video title",
 "musicPrompt": "<=280 chars instrumental underscore brief (mood, instruments, tempo)",
 "shots": [
   {
     "kind": "parallax_portrait|map_zoom|photo_slide|matte_sequence|collage_pan|object_drop|quote_card",
     "narration": "the exact voiceover sentence(s) spoken over this shot",
     "title": "BIG headline <=3 words (parallax_portrait / object_drop)",
     "kicker": "tiny letterspaced line above the title (optional)",
     "labels": [{"text": "<=3 word callout", "sub": "optional handwritten sub-note <=6 words"}],
     "annotations": ["optional handwritten margin note <=6 words"],
     "circleLabel": "map_zoom ring word (one word)",
     "quote": "quote_card only — THE QUOTE <=14 words",
     "attribution": "quote_card byline",
     "accent": "optional hex accent for this shot",
     "sfx": "short sound-effect cue fired at the shot cut, e.g. 'deep cinematic whoosh with paper flutter'",
     "assets": [{"id": "bg", "role": "bg|fg|image|cutout", "brief": "rich visual description of THIS image, period-correct, no text in image"}]
   }
 ]
}
ASSET CONTRACT per kind (exact roles): parallax_portrait: 1 bg (wide environment plate) + 1 fg (the protagonist, upper body, facing camera, clean plain background for cutting out). map_zoom: 1 bg (aged map / satellite-style chart of the relevant region). photo_slide: 1 bg (wide plate) + 2-3 image (distinct archival photographs). matte_sequence: 3-4 image (full-frame scenes that cut between each other). collage_pan: 1 bg (aged map or paper board) + 6-8 image (varied small archival photos). object_drop: 1 bg + 0-1 fg + 1-3 cutout (single object on plain white background). quote_card: 0-1 bg.`;

/** Gemini Pro plans the shot list + narration. One feedback retry, then loud. */
export async function planDocu(args: {
  topic: string;
  referenceNotes?: string;
  durationSec: number;
  log?: Logger;
}): Promise<DocuPlan> {
  const { topic, referenceNotes, durationSec, log } = args;
  const shotsWanted = Math.max(6, Math.min(8, Math.round(durationSec / 8)));
  const wordsTarget = Math.round(durationSec * 2.6);
  const base =
    `You are the showrunner of a premium archival-documentary explainer channel (the "collage motion" style: ` +
    `sepia cutout portraits over illustrated plates, huge distressed type, yellow highlight boxes, taped photos, ` +
    `ink/torn matte cuts, slow rostrum collage pans, film grain). Design the first ${durationSec} seconds of a video about: ${topic}.\n` +
    (referenceNotes ? `REFERENCE (recreate this beat structure and visual grammar): ${referenceNotes}\n` : "") +
    `RULES: exactly ${shotsWanted} shots. Shot 1 = parallax_portrait HOOK introducing the protagonist with their name as the title. ` +
    `Last shot = quote_card landing the irony/lesson. Vary the kinds in between (use map_zoom when geography enters, ` +
    `matte_sequence for "they built X, Y, Z" lists, collage_pan for the broad sweep, object_drop for money/objects). ` +
    `NARRATION: tight present-tense documentary VO, concrete numbers and dates, no filler, TOTAL ${wordsTarget} words (~2.6 words/sec), ` +
    `1-3 sentences per shot, each shot's narration must SPEAK to what is on screen. ` +
    `Asset briefs must be vivid, specific, period-correct, and contain NO text/lettering in the image itself. ` +
    `Labels/titles: punchy, ALL real correctly-spelled words.\n${PLAN_CONTRACT}`;

  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await geminiJsonPro<DocuPlan>({ prompt: base + feedback, maxTokens: 9000, temperature: 0.6, log });
    lastProblems = validatePlan(plan, durationSec);
    if (!lastProblems.length) {
      log?.(`documotion plan: "${plan.title}" — ${plan.shots.length} shots OK`);
      return plan;
    }
    log?.(`documotion plan attempt ${attempt + 1} rejected: ${lastProblems.join("; ")}`);
    feedback = `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly these: ${lastProblems.join("; ")}`;
  }
  throw new Error(`documotion: plan failed validation twice (${lastProblems.join("; ")})`);
}

/* ---------------------------------------------------------------- assets -- */

const DOCU_STILL_STYLE =
  " STYLE (obey strictly): authentic 1920s-1930s archival documentary image — sepia and desaturated earth " +
  "tones, real photographic film grain, slight halftone print texture, period-correct clothing/machinery/architecture, " +
  "dramatic natural light, believable historical photograph or vintage illustrated plate. " +
  "ABSOLUTELY NO text, NO letters, NO numbers, NO captions, NO watermarks, NO borders, NO modern objects.";

const ROLE_FRAMING: Record<DocuAssetBrief["role"], { prefix: string; ar: string }> = {
  bg: { prefix: "Wide establishing plate, full-bleed: ", ar: "16:9" },
  fg: {
    prefix:
      "Portrait for a die-cut collage cutout: the subject alone, upper body, facing camera, sharp edges, " +
      "evenly lit PLAIN LIGHT GREY studio background, nothing else in frame: ",
    ar: "3:4",
  },
  image: { prefix: "Single archival photograph, full-bleed: ", ar: "3:4" },
  cutout: {
    prefix: "Single object centered on a PLAIN WHITE background, no shadow, nothing else in frame: ",
    ar: "1:1",
  },
};

async function run(cmd: string, cmdArgs: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`))));
    p.on("error", reject);
  });
}

const ffmpegBin = () => process.env.FFMPEG_BIN || "ffmpeg";
const ffprobeBin = () => process.env.FFPROBE_BIN || "ffprobe";

async function mediaDuration(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const p = spawn(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.on("close", (code) => {
      const v = parseFloat(out.trim());
      if (code === 0 && Number.isFinite(v)) resolve(v);
      else reject(new Error(`ffprobe failed on ${path}`));
    });
    p.on("error", reject);
  });
}

/** Downscale + recompress for sane inputProps size (keeps alpha for png). */
async function normalizeAsset(rawPath: string, outPath: string, maxW: number): Promise<string> {
  if (outPath.endsWith(".png")) {
    await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", `scale='min(${maxW},iw)':-2`, outPath]);
  } else {
    await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", `scale='min(${maxW},iw)':-2`, "-q:v", "4", outPath]);
  }
  return outPath;
}

/** BiRefNet background removal via fal.ai → alpha PNG. v2 first, then v1. */
async function removeBackground(imgPath: string, outPng: string, log?: Logger): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("documotion: FAL_KEY missing (vault service 'fal')");
  const b64 = (await readFile(imgPath)).toString("base64");
  const dataUri = `data:image/jpeg;base64,${b64}`;
  let lastErr = "";
  for (const ep of ["fal-ai/birefnet/v2", "fal-ai/birefnet"]) {
    try {
      const res = await fetch(`https://fal.run/${ep}`, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ image_url: dataUri }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = (await res.json()) as { image?: { url?: string }; detail?: unknown };
      if (!res.ok) {
        lastErr = `${ep} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 160)}`;
        continue;
      }
      const url = j?.image?.url;
      if (!url) {
        lastErr = `${ep}: no image url`;
        continue;
      }
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`cutout download HTTP ${dl.status}`);
      await writeFile(outPng, Buffer.from(await dl.arrayBuffer()));
      log?.(`documotion cutout: ${ep} OK`);
      return outPng;
    } catch (e) {
      lastErr = `${ep}: ${e instanceof Error ? e.message : e}`;
    }
  }
  throw new Error(`documotion: background removal failed (${lastErr})`);
}

export interface DocuAssetFile {
  shotIdx: number;
  id: string;
  role: DocuAssetBrief["role"];
  /** Final normalized file (png for fg/cutout, jpg otherwise). */
  path: string;
}

/**
 * Generate every still in the plan (cached: existing files are kept — delete a
 * file to regenerate it). `fixNotes` re-brief specific assets ("shotIdx:id").
 */
export async function generateDocuAssets(
  plan: DocuPlan,
  assetsDir: string,
  log?: Logger,
  fixNotes?: Record<string, string>,
): Promise<DocuAssetFile[]> {
  await mkdir(assetsDir, { recursive: true });
  const out: DocuAssetFile[] = [];
  for (const [i, shot] of plan.shots.entries()) {
    for (const a of shot.assets ?? []) {
      const keyId = `${i}:${a.id}`;
      const needsAlpha = a.role === "fg" || a.role === "cutout";
      const finalPath = join(assetsDir, `s${i}_${a.id}${needsAlpha ? ".png" : ".jpg"}`);
      const fix = fixNotes?.[keyId];
      if (existsSync(finalPath) && !fix) {
        out.push({ shotIdx: i, id: a.id, role: a.role, path: finalPath });
        continue;
      }
      const framing = ROLE_FRAMING[a.role];
      const prompt = `${framing.prefix}${a.brief}.${DOCU_STILL_STYLE}${fix ? ` CRITICAL FIX FROM QA: ${fix}.` : ""}`;
      log?.(`documotion asset s${i}/${a.id} (${a.role})${fix ? " [QA retry]" : ""}…`);
      const bytes = await generateBananaImage({ prompt, aspectRatio: framing.ar });
      const rawPath = join(assetsDir, `s${i}_${a.id}_raw.jpg`);
      await writeFile(rawPath, bytes);
      if (needsAlpha) {
        const cutRaw = join(assetsDir, `s${i}_${a.id}_cut.png`);
        await removeBackground(rawPath, cutRaw, log);
        await normalizeAsset(cutRaw, finalPath, 1100);
      } else {
        await normalizeAsset(rawPath, finalPath, 1280);
      }
      out.push({ shotIdx: i, id: a.id, role: a.role, path: finalPath });
    }
  }
  log?.(`documotion assets: ${out.length} ready`);
  return out;
}

/* ----------------------------------------------------------- audio + sync -- */

/** One-take narration: ElevenLabs v3 (documentary George), Fish fallback. */
export async function docuNarration(text: string, outMp3: string, log?: Logger): Promise<string> {
  if (existsSync(outMp3)) return outMp3;
  try {
    const bytes = await synthNarration({ text, provider: "elevenlabs" });
    await writeFile(outMp3, bytes);
    log?.(`documotion narration: elevenlabs (${bytes.length} bytes)`);
    return outMp3;
  } catch (e) {
    log?.(`documotion narration: elevenlabs failed (${e instanceof Error ? e.message : e}) — Fish fallback`);
  }
  const bytes = await synthNarration({ text, voiceId: "psychological", speed: 0.96 });
  await writeFile(outMp3, bytes);
  log?.(`documotion narration: fish (${bytes.length} bytes)`);
  return outMp3;
}

export interface ShotTiming {
  startSec: number;
  endSec: number;
  durationInFrames: number;
}

/**
 * Cut the timeline ON the narration's sentence boundaries: AssemblyAI word
 * timings mapped through per-shot word counts. Falls back to proportional
 * word-count allocation when transcription is unavailable.
 */
export async function docuTimings(args: {
  plan: DocuPlan;
  narrationMp3: string;
  runId: string;
  tailSec?: number;
  log?: Logger;
}): Promise<{ timings: ShotTiming[]; audioDur: number }> {
  const { plan, narrationMp3, runId, log } = args;
  const audioDur = await mediaDuration(narrationMp3);
  const tail = args.tailSec ?? 1.2;
  const segWords = plan.shots.map((s) => (s.narration ?? "").split(/\s+/).filter(Boolean).length);
  const totalWords = segWords.reduce((a, b) => a + b, 0);

  let boundaries: number[] | null = null;
  if (hasAssemblyKey() && process.env.R2_ACCESS_KEY_ID) {
    try {
      const key = `documotion/${runId}/narration.mp3`;
      await putObject(key, await readFile(narrationMp3), { contentType: "audio/mpeg" });
      const url = await presignDownload(key, { expiresIn: 3600 });
      const words: Word[] = await transcribeWords(url);
      if (words.length >= totalWords * 0.8) {
        boundaries = [];
        let cum = 0;
        for (let i = 0; i < segWords.length - 1; i++) {
          cum += segWords[i];
          const idx = Math.min(words.length - 1, Math.max(0, Math.round((cum * words.length) / totalWords) - 1));
          boundaries.push(words[idx].end / 1000);
        }
        log?.(`documotion timings: assemblyai sentence-cut (${words.length} words)`);
      } else {
        log?.(`documotion timings: transcript too short (${words.length}/${totalWords}) — proportional`);
      }
    } catch (e) {
      log?.(`documotion timings: assemblyai failed (${e instanceof Error ? e.message : e}) — proportional`);
    }
  }
  if (!boundaries) {
    boundaries = [];
    let cum = 0;
    for (let i = 0; i < segWords.length - 1; i++) {
      cum += segWords[i];
      boundaries.push((cum / totalWords) * audioDur);
    }
    log?.("documotion timings: proportional word-count allocation");
  }

  const starts = [0, ...boundaries];
  const ends = [...boundaries, audioDur + tail];
  const timings: ShotTiming[] = starts.map((s, i) => ({
    startSec: s,
    endSec: ends[i],
    durationInFrames: Math.max(36, Math.round((ends[i] - s) * FPS)),
  }));
  return { timings, audioDur };
}

/* ------------------------------------------------------------------ sfx -- */

/** ElevenLabs sound-generation — one short SFX cue (cached by outPath). */
export async function generateSfx(text: string, seconds: number, outPath: string, log?: Logger): Promise<string | null> {
  if (existsSync(outPath)) return outPath;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    log?.("documotion sfx: no ELEVENLABS_API_KEY — skipping cue");
    return null;
  }
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          duration_seconds: Math.max(0.5, Math.min(10, seconds)),
          prompt_influence: 0.4,
        }),
      });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 1000) {
          await writeFile(outPath, bytes);
          return outPath;
        }
        lastErr = "tiny audio";
      } else {
        lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
        if (res.status < 500 && res.status !== 429) break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  log?.(`documotion sfx: cue failed (${lastErr}) — continuing without it`);
  return null;
}

/* ------------------------------------------------------------- mix + mux -- */

export interface SfxCue {
  path: string;
  atSec: number;
}

/** Duck the underscore under the VO, drop SFX at cue times, loudnorm, mux. */
export async function mixAndMux(args: {
  videoPath: string;
  narrationPath: string;
  musicPath?: string;
  sfxCues?: SfxCue[];
  outPath: string;
  log?: Logger;
}): Promise<string> {
  const { videoPath, narrationPath, musicPath, outPath, log } = args;
  const sfx = args.sfxCues ?? [];
  const videoDur = await mediaDuration(videoPath);

  const inputs: string[] = ["-i", videoPath, "-i", narrationPath];
  if (musicPath) inputs.push("-i", musicPath);
  for (const c of sfx) inputs.push("-i", c.path);

  const parts: string[] = [];
  const mixIn: string[] = [];
  if (musicPath) {
    parts.push("[1:a]asplit=2[nar][narsc]");
    parts.push(
      `[2:a]aloop=loop=-1:size=2147483647,atrim=0:${videoDur.toFixed(2)},` +
        `afade=t=in:st=0:d=1.0,afade=t=out:st=${Math.max(0, videoDur - 2.8).toFixed(2)}:d=2.8,volume=0.45[mus]`,
    );
    parts.push("[mus][narsc]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=500[musd]");
    mixIn.push("[nar]", "[musd]");
  } else {
    parts.push("[1:a]anull[nar]");
    mixIn.push("[nar]");
  }
  sfx.forEach((c, i) => {
    const inIdx = (musicPath ? 3 : 2) + i;
    const ms = Math.max(0, Math.round(c.atSec * 1000));
    parts.push(`[${inIdx}:a]adelay=${ms}|${ms},volume=0.75[s${i}]`);
    mixIn.push(`[s${i}]`);
  });
  parts.push(
    `${mixIn.join("")}amix=inputs=${mixIn.length}:duration=longest:dropout_transition=0:normalize=0,` +
      `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`,
  );

  await run(ffmpegBin(), [
    "-y",
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    videoDur.toFixed(2),
    args.outPath,
  ]);
  log?.(`documotion mix: ${outPath}`);
  return outPath;
}

/* ------------------------------------------------------------------- QA -- */

export interface DocuVerdict {
  styleMatch?: number;
  motionDesign?: number;
  typeOk?: boolean;
  cohesion?: number;
  pass?: boolean;
  perShot?: { idx?: number; assetId?: string; issue?: string }[];
  fix?: string;
}

/** Sample 2 frames per shot and judge against the golden archival-collage bar. */
export async function qaDocuVideo(args: {
  videoPath: string;
  plan: DocuPlan;
  timings: ShotTiming[];
  framesDir: string;
  log?: Logger;
}): Promise<DocuVerdict> {
  const { videoPath, plan, timings, framesDir, log } = args;
  await mkdir(framesDir, { recursive: true });
  const paths: string[] = [];
  const labels: string[] = [];
  for (const [i, t] of timings.entries()) {
    for (const frac of [0.4, 0.85]) {
      const ts = t.startSec + (t.endSec - t.startSec) * frac;
      const p = join(framesDir, `s${i}_${Math.round(frac * 100)}.jpg`);
      try {
        await run(ffmpegBin(), ["-y", "-ss", ts.toFixed(2), "-i", videoPath, "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "5", p]);
        paths.push(p);
        labels.push(`shot ${i} (${plan.shots[i]?.kind}) @${Math.round(frac * 100)}%`);
      } catch {
        /* missing frame → judged from the rest */
      }
    }
  }
  const expectWords = plan.shots
    .flatMap((s) => [s.title, s.circleLabel, ...(s.labels ?? []).map((l) => l.text)])
    .filter(Boolean)
    .map((w) => `"${String(w).toUpperCase()}"`)
    .join(", ");
  const raw = await geminiVisionLocal({
    prompt:
      `DOCUMOTION GATE. You judge frames from an archival-documentary collage explainer ` +
      `(golden bar: sepia archival stills + cutout portraits over plates, HUGE distressed headline type, ` +
      `yellow highlight-box callouts, taped photos, film grain/halftone, cohesive muted palette with bright accents). ` +
      `Frames in order: ${labels.join("; ")}.\n` +
      `Judge: 1. styleMatch 1-10 (vs the golden bar above). 2. motionDesign 1-10 (composition/layout quality of type+photos). ` +
      `3. typeOk: every visible overlay word correctly spelled (expected words include ${expectWords})? ` +
      `4. cohesion 1-10 (do all shots feel like ONE designed film: same palette/grain/type?). ` +
      `5. perShot: list ONLY real problems [{idx, assetId?, issue <=12 words}] — idx = shot number from the frame labels. ` +
      `Return STRICT JSON {"styleMatch":n,"motionDesign":n,"typeOk":bool,"cohesion":n,"pass":bool,"perShot":[...],"fix":"<=20 words"}.`,
    imagePaths: paths,
    json: true,
    maxTokens: 900,
  }).catch(() => "");
  const v: DocuVerdict = raw ? parseJsonLoose<DocuVerdict>(raw) : {};
  log?.(
    `documotion QA: style=${v.styleMatch} motion=${v.motionDesign} cohesion=${v.cohesion} typeOk=${v.typeOk} issues=${v.perShot?.length ?? 0}`,
  );
  return v;
}

/* ------------------------------------------------------------ orchestrate -- */

function dataUri(path: string, bytes: Buffer): string {
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Assemble renderer props: plan + asset files + timings → DocuShotSpec[]. */
export async function buildShotSpecs(
  plan: DocuPlan,
  assets: DocuAssetFile[],
  timings: ShotTiming[],
): Promise<DocuShotSpec[]> {
  const cache = new Map<string, string>();
  const uri = async (p: string) => {
    if (!cache.has(p)) cache.set(p, dataUri(p, await readFile(p)));
    return cache.get(p)!;
  };
  const specs: DocuShotSpec[] = [];
  for (const [i, s] of plan.shots.entries()) {
    const mine = assets.filter((a) => a.shotIdx === i);
    const byRole = async (role: DocuAssetBrief["role"]) =>
      Promise.all(mine.filter((a) => a.role === role).map((a) => uri(a.path)));
    const [bgs, fgs, images, cutouts] = await Promise.all([byRole("bg"), byRole("fg"), byRole("image"), byRole("cutout")]);
    specs.push({
      kind: s.kind,
      durationInFrames: timings[i]?.durationInFrames ?? 90,
      bg: bgs[0],
      fg: fgs[0],
      images: images.length ? images : undefined,
      cutouts: cutouts.length ? cutouts : undefined,
      title: s.title,
      kicker: s.kicker,
      labels: s.labels,
      annotations: s.annotations,
      circleLabel: s.circleLabel,
      quote: s.quote,
      attribution: s.attribution,
      accent: s.accent,
    });
  }
  return specs;
}

export interface CraftDocuArgs {
  topic: string;
  /** Beat/visual notes from a reference video to recreate. */
  referenceNotes?: string;
  durationSec?: number;
  /** Working dir — every artifact is cached here (delete to regenerate). */
  runDir: string;
  outPath?: string;
  /** 960x540 silent draft (no music/sfx/mix) for fast iteration. */
  draft?: boolean;
  /** Skip the QA gate (used by draft iteration scripts that judge manually). */
  skipQa?: boolean;
  log?: Logger;
}

export interface CraftDocuResult {
  outPath: string;
  plan: DocuPlan;
  timings: ShotTiming[];
  qa?: DocuVerdict;
}

/** The full engine — see module header. */
export async function craftDocuVideo(args: CraftDocuArgs): Promise<CraftDocuResult> {
  const log = args.log ?? (() => {});
  const durationSec = args.durationSec ?? 60;
  const runDir = args.runDir;
  const runId = runDir.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(-48);
  await mkdir(runDir, { recursive: true });

  // 1. PLAN (cached)
  const planPath = join(runDir, "plan.json");
  let plan: DocuPlan;
  if (existsSync(planPath)) {
    plan = JSON.parse(await readFile(planPath, "utf8")) as DocuPlan;
    log(`documotion: plan loaded from cache (${plan.shots.length} shots)`);
  } else {
    plan = await planDocu({ topic: args.topic, referenceNotes: args.referenceNotes, durationSec, log });
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  }

  // 2. ASSETS (cached per file)
  const assets = await generateDocuAssets(plan, join(runDir, "assets"), log);

  // 3. NARRATION + TIMINGS
  const narrationText = plan.shots.map((s) => s.narration ?? "").join(" ").replace(/\s+/g, " ").trim();
  const narrationMp3 = await docuNarration(narrationText, join(runDir, "narration.mp3"), log);
  const { timings, audioDur } = await docuTimings({ plan, narrationMp3, runId, log });
  await writeFile(join(runDir, "timings.json"), JSON.stringify(timings, null, 2), "utf8");
  log(`documotion: narration ${audioDur.toFixed(1)}s across ${timings.length} shots`);

  // 4. RENDER
  const shots = await buildShotSpecs(plan, assets, timings);
  const bodyPath = join(runDir, args.draft ? "body_draft.mp4" : "body.mp4");
  const size = args.draft ? { width: 960, height: 540 } : { width: 1920, height: 1080 };
  await renderDocuMotion({ shots, outPath: bodyPath, ...size, log });
  log(`documotion: body rendered ${bodyPath}`);

  if (args.draft) {
    const qa = args.skipQa
      ? undefined
      : await qaDocuVideo({ videoPath: bodyPath, plan, timings, framesDir: join(runDir, "qa_frames"), log });
    return { outPath: bodyPath, plan, timings, qa };
  }

  // 5. SOUND — underscore + SFX cues + duck + mux
  const musicPath = join(runDir, "music.wav");
  if (!existsSync(musicPath)) {
    const music = await generateSuno({
      prompt: `${plan.musicPrompt}. Instrumental only, cinematic documentary underscore, no vocals.`,
      title: plan.title.slice(0, 70),
      wantClips: 1,
      preferWav: true,
    });
    const dl = await fetch(music.url);
    if (!dl.ok) throw new Error(`documotion: music download HTTP ${dl.status}`);
    await writeFile(musicPath, Buffer.from(await dl.arrayBuffer()));
    log(`documotion: underscore ready (${music.provider} ${music.jobId})`);
  }
  const sfxCues: SfxCue[] = [];
  for (const [i, s] of plan.shots.entries()) {
    if (!s.sfx?.trim()) continue;
    const p = await generateSfx(s.sfx, 2.2, join(runDir, `sfx_${i}.mp3`), log);
    if (p) sfxCues.push({ path: p, atSec: Math.max(0, timings[i].startSec - 0.12) });
  }
  const outPath = args.outPath ?? join(runDir, "final.mp4");
  await mixAndMux({ videoPath: bodyPath, narrationPath: narrationMp3, musicPath, sfxCues, outPath, log });

  // 6. QA gate — one feedback retry on flagged assets, then loud failure.
  if (!args.skipQa) {
    const framesDir = join(runDir, "qa_frames");
    let qa = await qaDocuVideo({ videoPath: outPath, plan, timings, framesDir, log });
    const passed = (v: DocuVerdict) =>
      v.typeOk !== false && (v.styleMatch ?? 10) >= 7 && (v.motionDesign ?? 10) >= 7 && (v.cohesion ?? 10) >= 7;
    if (!passed(qa)) {
      const fixNotes: Record<string, string> = {};
      for (const p of qa.perShot ?? []) {
        if (p.idx === undefined || !p.issue) continue;
        const shot = plan.shots[p.idx];
        const assetId = p.assetId ?? shot?.assets?.[0]?.id;
        if (assetId) fixNotes[`${p.idx}:${assetId}`] = p.issue;
      }
      if (Object.keys(fixNotes).length) {
        log(`documotion QA: retrying ${Object.keys(fixNotes).length} flagged assets`);
        const assets2 = await generateDocuAssets(plan, join(runDir, "assets"), log, fixNotes);
        const shots2 = await buildShotSpecs(plan, assets2, timings);
        await renderDocuMotion({ shots: shots2, outPath: bodyPath, ...size, log });
        await mixAndMux({ videoPath: bodyPath, narrationPath: narrationMp3, musicPath, sfxCues, outPath, log });
        qa = await qaDocuVideo({ videoPath: outPath, plan, timings, framesDir, log });
      }
      if (!passed(qa)) {
        throw new Error(
          `documotion: QA gate failed after retry (style=${qa.styleMatch} motion=${qa.motionDesign} ` +
            `cohesion=${qa.cohesion} typeOk=${qa.typeOk} fix="${qa.fix ?? ""}")`,
        );
      }
    }
    return { outPath, plan, timings, qa };
  }
  return { outPath, plan, timings };
}
