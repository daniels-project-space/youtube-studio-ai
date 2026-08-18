/**
 * DOCUMOTION — the documentary-collage MOTION engine (banana/scriptcraft
 * integration shape): topic + channel STYLE in → polished motion-graphics body
 * out. VISUAL CRAFT ONLY (narration / music / SFX are separate modules).
 *
 * What the module knows — so a channel's pipeline just picks a style id:
 *   • WHAT IS POSSIBLE — the shot-kind grammar (parallax_portrait, map_zoom,
 *     photo_slide, matte_sequence, collage_pan, evidence_board, object_drop,
 *     quote_card) and the channel WORLDS in src/remotion/docuStyles.ts
 *     (archival_collage, detective_board, …). Each world carries its image-
 *     prompting intelligence (still-style + per-role framing) and its theme.
 *   • HOW TO GET THE IMAGE IT NEEDS — per asset, a source: "generate" (Nano
 *     Banana, the default) or "archival" (a real Wikimedia photograph of a
 *     named entity, then cut out). Every generated still passes a vision gate
 *     before it enters the film (better first tries).
 *   • HOW TO ASSEMBLE — a Gemini-Pro plan with a cinematography doctrine
 *     (motivated camera move + varied pacing per shot), rendered by the
 *     DocuMotion Remotion composition (eased camera + 2.5D parallax, stroked
 *     type on scrims, red-string evidence boards, torn mattes, film grade).
 *   • HOW TO JUDGE & FIX — a craft VERIFIER renders one STILL per shot (fast),
 *     scores type/cutout/composition/legibility/style/cohesion (legibility = a hard
 *     text-collision gate), and emits TYPED ACTIONS
 *     the engine APPLIES (regen_asset, emphasize_text, reposition_labels,
 *     retime, camera) before re-checking, then renders the 1080p master.
 *
 * Speed: assets generate+gate in a concurrency pool, verifier rounds use
 * stills (not full video), only the final pass renders the full timeline.
 *
 * Deps: direct Novita Z-Image Turbo worker configuration for generated
 * fallback stills; GEMINI_API_KEY is required only when the
 * optional freeform planner/cinematographer pass is used instead of a locked plan.
 *
 *   import { craftDocuMotion } from "@/lib/documotion";
 *   const { outPath, verdict } = await craftDocuMotion({ topic, style: "detective_board", runDir, log });
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { geminiJson, geminiJsonPro, parseJsonLoose } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { generateNovitaZImageTurbo, hasNovitaZImageTurbo } from "@/lib/novitaZImageTurbo";
import { fetchCityGeo, type CityGeo } from "@/lib/geoMap";
import { searchOnlineDocumentaryAssets } from "@/lib/documentaryAssetSearch";
import { synthNarration } from "@/lib/tts";
import { generateMusic } from "@/lib/music";
import { createImageUsageScope, type ImageUsageSummary } from "@/lib/imageUsage";
import { createModelUsageScope, type ModelUsageSummary } from "@/lib/modelUsage";
import { narrationTtsCost, PRICE } from "@/engine/pricing";
import { CINEMATOGRAPHER_DOCTRINE } from "@/lib/visualDirection";
import {
  assessDocumentaryVisualQuality,
  editorialCoverageFor,
  editorialMotionArcFor,
  editorialTypographyFor,
  normalizeDocumentaryVisualCues,
  type DocumentaryEditorialCoverage,
  type DocumentaryVisualQualityAssessment,
  type DocumentaryMotionArc,
  type DocumentaryTypographyPlan,
  type DocumentaryCoverageRole,
} from "@/lib/documentaryVisualQuality";
import { renderDocuMotion, renderDocuStills } from "@/lib/remotionRender";
import {
  getDocuRoleFraming,
  getStyle,
  type DocuFormat,
  type DocuAssetRole,
  type DocuShotKind,
  type DocuStyleDef,
} from "@/remotion/docuStyles";
import type { DocuCamera, DocuLabel, DocuLabelPos, DocuShotSpec, DocuThread } from "@/remotion/DocuMotion";
import type { DocuLayout } from "@/remotion/DocuMotion";

type Logger = (msg: string) => void;

const FPS = 30;

export type { DocuFormat } from "@/remotion/docuStyles";

export interface DocuRenderGeometry {
  format: DocuFormat;
  layout: DocuLayout;
  width: number;
  height: number;
  verifyWidth: number;
  verifyHeight: number;
}

/** Canonical geometry used by both proof stills and the final master. */
export function docuRenderGeometry(format: DocuFormat = "long"): DocuRenderGeometry {
  return format === "short"
    ? { format, layout: "short", width: 1080, height: 1920, verifyWidth: 540, verifyHeight: 960 }
    : { format, layout: "long", width: 1920, height: 1080, verifyWidth: 960, verifyHeight: 540 };
}

/** Source and direct-worker image concurrency — capped for provider stability. */
const ASSET_CONCURRENCY = Number(process.env.DOCU_ASSET_CONCURRENCY ?? 4);
// Online sources are always tried first. Only a bounded number of Z-Image
// Turbo candidates may be paid for after the source search proves inadequate.
const MAX_NOVITA_ASSET_ATTEMPTS = 2;

export function hasDocumotion(): boolean {
  return hasNovitaZImageTurbo();
}

/* --------------------------------------------------------------- helpers -- */

/** Bounded-concurrency map preserving input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

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

/** Like run() but returns combined stdout+stderr — for probes (volumedetect). */
async function runCapture(cmd: string, cmdArgs: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (out += String(d)));
    p.on("close", () => resolve(out));
    p.on("error", () => resolve(out));
  });
}

/* ---- NARRATION-DRIVEN ASSEMBLY ------------------------------------------- *
 * A documentary's SPINE is the spoken word. The old engine rendered a fixed-
 * length visual timeline and laid one VO blob underneath, so a 35s VO sat under
 * a 60s video → the second half went SILENT and the visuals drifted from the
 * line being spoken. Now: voice each shot's line FIRST, derive each shot's
 * duration FROM its spoken length, then align the VO to the shots so the picture
 * always matches the words. Music beds across the WHOLE length (ducked).        */

const NARR = {
  lead: 0.35, // breath before a shot's line starts
  tail: 0.7, // breathing room after the line, before the cut
  minShot: 3.2, // a near-silent beat still holds on screen
  maxShot: 13, // cap one very long line's shot
  speed: 0.95, // documentary gravitas (< 1 = slower delivery)
};

// BROADCAST MIX targets. Dialogue is the ANCHOR (loudest, most consistent); the
// music BED sits well under it and ducks gently. The previous mix shipped music
// LOUDER than the voice (−14 vs −20 LUFS) → narration buried. These lock the
// relationship: voice ~−16 LUFS, bed ~−30 LUFS (≈14 dB under), gentle slow duck.
const MIX = {
  voLufs: -16, // dialogue anchor
  bedLufs: -30, // music bed, ~14 dB under dialogue
  minDialogueLeadDb: 8, // output gate: VO windows must beat music-only gaps by ≥ this
};

interface ShotVO {
  idx: number;
  path: string;
  durSec: number;
}

interface DocuNarrationUsage {
  provider: string;
  billableCharacters: number;
}

/** ElevenLabs v3 (expressive, documentary-grade) when its key is present — the
 *  right narration tool for this format; Fish Audio otherwise. */
function pickNarrationTts(): { provider?: string; elevenVoiceId?: string } {
  if (process.env.ELEVENLABS_API_KEY) {
    return { provider: "elevenlabs", ...(process.env.DOCU_ELEVEN_VOICE_ID ? { elevenVoiceId: process.env.DOCU_ELEVEN_VOICE_ID } : {}) };
  }
  return {};
}

/** Decode an audio file's duration (seconds) from ffmpeg's banner. */
async function audioDurationSec(path: string): Promise<number> {
  const out = await runCapture(ffmpegBin(), ["-i", path, "-f", "null", "-"]);
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0;
}

/** Voice EACH shot's narration line separately (documentary pace) so timing and
 *  visuals can lock to the spoken word. Returns per-shot VO files + durations. */
async function synthShotVOs(
  plan: DocuPlan,
  runDir: string,
  niche: string | undefined,
  log: Logger,
  usage: DocuNarrationUsage,
  narrationSpeed: number,
  elevenModelId?: string,
): Promise<ShotVO[]> {
  const tts = pickNarrationTts();
  usage.provider = tts.provider ?? "fish";
  const voDir = join(runDir, "vo");
  await mkdir(voDir, { recursive: true });
  const lines = plan.shots.map((s) => (s.narration ?? "").trim());
  const out: ShotVO[] = [];
  for (let i = 0; i < plan.shots.length; i++) {
    if (!lines[i]) continue;
    const path = join(voDir, `vo_${i}.mp3`);
    const bytes = await synthNarration({
      text: lines[i],
      niche,
      speed: narrationSpeed,
      ...tts,
      eleven: { modelId: elevenModelId, stability: 0.45, seed: 4242 },
      stitch: { previousText: lines[i - 1] || undefined, nextText: lines[i + 1] || undefined },
      onBillableCharacters: (characters) => {
        usage.billableCharacters += characters;
      },
    });
    await writeFile(path, Buffer.from(bytes));
    out.push({ idx: i, path, durSec: await audioDurationSec(path) });
  }
  const voTotal = out.reduce((a, v) => a + v.durSec, 0);
  log(`documotion narrate: ${out.length}/${plan.shots.length} shots voiced via ${tts.provider ?? "fish"} @ speed ${narrationSpeed} — ${voTotal.toFixed(1)}s VO`);
  return out;
}

/** Narration-driven shot durations (sec): a shot lasts as long as its spoken
 *  line + breathing room (clamped); a silent shot gets a short visual beat. */
function narrationDurations(plan: DocuPlan, shotVOs: ShotVO[], fallbackSec: number): number[] {
  const byIdx = new Map(shotVOs.map((v) => [v.idx, v.durSec]));
  return plan.shots.map((s, i) => {
    const vo = byIdx.get(i);
    if (vo && vo > 0) return Math.max(NARR.minShot, Math.min(NARR.maxShot, vo + NARR.lead + NARR.tail));
    return Math.max(NARR.minShot, Math.min(8, s.durationSec ?? fallbackSec));
  });
}

/** Mux the per-shot VOs onto the render ALIGNED to each shot's start (picture
 *  matches the line being spoken), bed a ducked music track across the FULL
 *  length, normalize to broadcast loudness. Music best-effort (provider
 *  fallback). Returns the new audio-video path. */
async function assembleNarration(o: {
  videoPath: string; runDir: string; shotVOs: ShotVO[]; shotDursSec: number[]; plan: DocuPlan; log: Logger;
}): Promise<{ path: string; musicTracks: number }> {
  if (!o.shotVOs.length) {
    o.log("documotion narrate: plan carries no narration — leaving silent");
    return { path: o.videoPath, musicTracks: 0 };
  }
  // exact rendered start (sec) of each shot = cumulative rendered duration (frame-quantized to match the render)
  const renderedSec = o.shotDursSec.map((d) => Math.round(d * FPS) / FPS);
  const starts: number[] = [];
  let totalSec = 0;
  for (const d of renderedSec) { starts.push(totalSec); totalSec += d; }

  // music bed (best-effort, provider fallback, looped under the whole thing)
  let musPath = "";
  let musicTracks = 0;
  try {
    const m = await generateMusic({
      prompt: "cinematic documentary underscore — restrained strings and soft piano, slow build, tension and wonder, NO drums, fully instrumental",
      title: o.plan.title,
      log: o.log,
    });
    if (m.url) {
      musPath = join(o.runDir, "music.mp3");
      await downloadTo(m.url, musPath);
      // A provider URL can resolve without producing a local file (expired
      // signed URL / empty upstream response). Do not hand ffmpeg a phantom
      // music input: keep the fully valid narration-only delivery instead.
      if (!existsSync(musPath)) {
        musPath = "";
        o.log("documotion narrate: music download produced no local file — VO only");
      } else {
        // A provider can return multiple billable takes from one generation.
        musicTracks = Math.max(1, m.tracks.length);
        o.log(`documotion narrate: music bed via ${m.provider}`);
      }
    }
  } catch (e) { o.log(`documotion narrate: music unavailable (${e instanceof Error ? e.message : e}) — VO only`); }

  // ---- BROADCAST MIX: dialogue is the ANCHOR, music a quiet bed under it ----
  // input 0 = video; inputs 1..N = shot VOs; input N+1 = music (looped)
  const inputs: string[] = ["-i", o.videoPath];
  o.shotVOs.forEach((v) => inputs.push("-i", v.path));
  const parts: string[] = [];
  o.shotVOs.forEach((v, k) => {
    const delayMs = Math.round((starts[v.idx] + NARR.lead) * 1000);
    parts.push(`[${k + 1}:a]adelay=${delayMs}:all=1[v${k}]`);
  });
  // VO bus → normalize to the DIALOGUE target so narration is consistently the
  // loudest, most intelligible element (it was −20 LUFS raw → buried).
  parts.push(`${o.shotVOs.map((_, k) => `[v${k}]`).join("")}amix=inputs=${o.shotVOs.length}:normalize=0:duration=longest[vomix]`);
  parts.push(`[vomix]loudnorm=I=${MIX.voLufs}:TP=-2:LRA=7[vo]`);
  let outChain = "[vo]";
  if (musPath) {
    inputs.push("-stream_loop", "-1", "-i", musPath);
    const mIdx = o.shotVOs.length + 1;
    // Music → bed level (≈14 dB under dialogue), then GENTLE sidechain duck keyed
    // off the voice (slow release = no pumping). asplit so the VO feeds both the
    // sidechain key and the final mix (a label can only be consumed once).
    parts.push(`[vo]asplit=2[vomain][vokey]`);
    parts.push(`[${mIdx}:a]loudnorm=I=${MIX.bedLufs}:TP=-9:LRA=6[mbed]`);
    parts.push(`[mbed][vokey]sidechaincompress=threshold=0.05:ratio=4:attack=80:release=700:detection=rms[mduck]`);
    parts.push(`[vomain][mduck]amix=inputs=2:normalize=0:duration=first[mix]`);
    outChain = "[mix]";
  }
  // final broadcast loudness + true-peak ceiling (uniform gain → preserves the
  // dialogue-to-bed RATIO established above).
  parts.push(`${outChain}loudnorm=I=-14:TP=-1.5:LRA=11[a]`);

  const out = o.videoPath.replace(/\.mp4$/i, "_av.mp4");
  await run(ffmpegBin(), ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "0:v", "-map", "[a]", "-t", totalSec.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out]);
  o.log(`documotion narrate: muxed ${musPath ? "VO + ducked music bed" : "VO"} aligned over ${totalSec.toFixed(1)}s → ${out}`);
  return { path: out, musicTracks };
}

/** Mean dBFS of one time-window of a file's audio. */
async function windowDb(videoPath: string, startSec: number, durSec: number): Promise<number> {
  const probe = await runCapture(ffmpegBin(), ["-ss", startSec.toFixed(2), "-t", durSec.toFixed(2), "-i", videoPath, "-af", "volumedetect", "-f", "null", "-"]);
  const m = probe.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  return m ? parseFloat(m[1]) : -91;
}

/** OUTPUT VALIDATION — the verifier is VISION-only, so the audio must police
 *  itself. The old check only proved "sound exists across the timeline", which a
 *  loud music bed satisfies even when the NARRATION is buried (the bug that
 *  shipped). This now also measures DIALOGUE DOMINANCE: a voice window must beat
 *  a music-only gap window by ≥ minDialogueLeadDb, i.e. the narration is actually
 *  the foreground. Fails on: silence, poor coverage, trailing gap, OR a buried VO. */
async function validateAudioCoverage(
  videoPath: string,
  expectSec: number,
  log: Logger,
  dominance?: { voStartSec: number; gapStartSec: number; hasMusic: boolean },
): Promise<{ audioOk: boolean; meanVolumeDb: number; coverage: number; dialogueLeadDb: number | null }> {
  const probe = await runCapture(ffmpegBin(), ["-i", videoPath, "-af", "silencedetect=noise=-45dB:d=0.8,volumedetect", "-f", "null", "-"]);
  const mm = probe.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  const meanVolumeDb = mm ? parseFloat(mm[1]) : -91;
  let silence = 0;
  let trailing = 0;
  let lastStart: number | null = null;
  for (const line of probe.split("\n")) {
    const s = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    const e = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (s) lastStart = parseFloat(s[1]);
    if (e && lastStart !== null) { silence += parseFloat(e[1]) - lastStart; lastStart = null; }
  }
  if (lastStart !== null) { trailing = Math.max(0, expectSec - lastStart); silence += trailing; } // ran to EOF
  const coverage = expectSec > 0 ? Math.max(0, 1 - silence / expectSec) : 0;

  // DIALOGUE DOMINANCE — only meaningful when a music bed is present (else a quiet
  // gap is genuine silence, not competing music).
  let dialogueLeadDb: number | null = null;
  if (dominance?.hasMusic) {
    const [voDb, gapDb] = await Promise.all([
      windowDb(videoPath, dominance.voStartSec, 1.2),
      windowDb(videoPath, dominance.gapStartSec, 0.35),
    ]);
    dialogueLeadDb = voDb - gapDb;
  }

  const dominanceOk = dialogueLeadDb === null || dialogueLeadDb >= MIX.minDialogueLeadDb;
  const audioOk = meanVolumeDb > -50 && coverage >= 0.6 && trailing < expectSec * 0.15 && dominanceOk;
  log(
    `documotion VALIDATE: mean ${meanVolumeDb} dB, coverage ${(coverage * 100).toFixed(0)}%, trailing-gap ${trailing.toFixed(1)}s` +
      `${dialogueLeadDb !== null ? `, dialogue-lead ${dialogueLeadDb.toFixed(1)} dB (need ≥${MIX.minDialogueLeadDb})` : ""} → ${audioOk ? "OK" : "FAIL"}`,
  );
  return { audioOk, meanVolumeDb, coverage, dialogueLeadDb };
}

/* ------------------------------------------------------------------ plan -- */

export interface DocuAssetBrief {
  id: string;
  role: DocuAssetRole;
  brief: string;
  /** generate (default) | archival (real Wikimedia photo of `query`). */
  source?: "generate" | "archival" | "online";
  query?: string;
  /** Precise online-search phrase for an auditable real-world still. */
  onlineQuery?: string;
  /** Editorial purpose inside its beat, used by the visual coverage gate. */
  storyRole?: DocumentaryCoverageRole;
}

export interface DocuShotPlan {
  kind: DocuShotKind;
  /** The spoken VOICEOVER line for this shot — the narrative spine; the visual
   *  ILLUSTRATES it, and the deliverable's VO is these lines in order. */
  narration: string;
  /** Documentary shot SCALE — drives the framing of the asset brief and the
   *  scene-setting rhythm (establish wide → tighten to detail). */
  scale: "establishing" | "wide" | "medium" | "close";
  /** Short note on the visual intent (what to show). */
  beat: string;
  durationSec: number;
  camera: DocuCamera;
  /** Named proof + coverage roles. A beat cannot be one generic plate. */
  coverage?: DocumentaryEditorialCoverage;
  /** Establish → reveal → exit direction, including the in-shot visual reset. */
  motionArc?: DocumentaryMotionArc;
  /** Type may orient the viewer but may not replace the proof image. */
  typography?: DocumentaryTypographyPlan;
  title?: string;
  kicker?: string;
  labels?: DocuLabel[];
  annotations?: string[];
  circleLabel?: string;
  quote?: string;
  /** Optional 1-3 exact quote words selected by the existing planning pass.
   *  Remotion applies the visual emphasis deterministically; this never starts
   *  a separate model or image-generation request. */
  quoteEmphasis?: string[];
  attribution?: string;
  accent?: string;
  threads?: DocuThread[];
  /** geo_map: the real place to render (e.g. "Antwerp, Belgium"). */
  geoQuery?: string;
  /** geo_map: orienting CONTEXT labels — the surrounding bodies/regions that place
   *  the feature ("MEDITERRANEAN SEA" top, "RED SEA" bottom, …) so the viewer sees
   *  WHERE it is and what it connects, in relation to the narration. */
  geoContext?: { label: string; side: "top" | "bottom" | "left" | "right" }[];
  /** depth_parallax: a cinematic focus pull between near + far planes. */
  rackFocus?: "near_to_far" | "far_to_near";
  assets: DocuAssetBrief[];
  /** Cinematographer pass: the concrete elements the frame MUST show (from the
   *  narration line) — drives the coherence cue-check in the verifier. */
  visualCues?: string[];
}

export interface DocuPlan {
  title: string;
  styleId: string;
  shots: DocuShotPlan[];
}

const QUOTE_CARD_MAX_WORDS = 14;
const QUOTE_CARD_MAX_CHARACTERS = 120;
const QUOTE_ATTRIBUTION_MAX_CHARACTERS = 48;

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

/**
 * Provider JSON and historical cached plans are untrusted runtime input. Some
 * providers return `quoteEmphasis` as a string (or, more rarely, an object)
 * despite the requested schema. Normalize it before any downstream provider
 * work so typography can never crash after image/TTS spend.
 */
export function normalizeQuoteEmphasis(value: unknown): string[] | undefined {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const words = parts
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) => part.trim().split(/\s+/))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, 3);
  return words.length ? words : undefined;
}

function complementaryRevealMove(move: DocuCamera["move"]): DocuCamera["move"] {
  if (move === "push_in") return "pan_right";
  if (move === "pull_back") return "push_in";
  if (move === "pan_left" || move === "pan_right") return "push_in";
  return "pan_left";
}

/** Makes the mandated in-shot information reveal executable by the renderer. */
function normalizeCameraMotion(value: unknown, motionArc: unknown): DocuCamera | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const move = optionalText(raw.move);
  if (!move || !CAMERA_MOVES.includes(move)) return raw as unknown as DocuCamera;
  const arc = motionArc && typeof motionArc === "object" && !Array.isArray(motionArc)
    ? motionArc as Record<string, unknown>
    : undefined;
  const explicitReset = typeof raw.revealAtPercent === "number"
    ? raw.revealAtPercent
    : typeof arc?.visualResetAtPercent === "number"
      ? arc.visualResetAtPercent
      : 0.5;
  return {
    ...raw,
    move,
    revealMove: optionalText(raw.revealMove) ?? complementaryRevealMove(move as DocuCamera["move"]),
    revealAtPercent: explicitReset,
  } as DocuCamera;
}

export function normalizeDocuPlan(value: unknown): DocuPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("documotion: plan must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.shots)) throw new Error("documotion: plan.shots must be an array");

  const shots = raw.shots.map((valueAtIndex, index) => {
    if (!valueAtIndex || typeof valueAtIndex !== "object" || Array.isArray(valueAtIndex)) {
      throw new Error(`documotion: shot ${index} must be an object`);
    }
    const shot = valueAtIndex as Record<string, unknown>;
    const camera = normalizeCameraMotion(shot.camera, shot.motionArc);
    return {
      ...shot,
      camera,
      narration: optionalText(shot.narration) ?? "",
      beat: optionalText(shot.beat) ?? "",
      quote: optionalText(shot.quote),
      quoteEmphasis: normalizeQuoteEmphasis(shot.quoteEmphasis),
      attribution: optionalText(shot.attribution),
      assets: Array.isArray(shot.assets) ? shot.assets : [],
      visualCues: normalizeDocumentaryVisualCues(
        optionalText(shot.narration) ?? "",
        optionalText(shot.beat) ?? "",
        Array.isArray(shot.visualCues) ? shot.visualCues.filter((cue): cue is string => typeof cue === "string") : [],
      ),
      coverage: shot.coverage && typeof shot.coverage === "object"
        ? shot.coverage as DocumentaryEditorialCoverage
        : editorialCoverageFor(optionalText(shot.narration) ?? "", optionalText(shot.beat) ?? "", optionalText(shot.kind)),
      motionArc: shot.motionArc && typeof shot.motionArc === "object"
        ? shot.motionArc as DocumentaryMotionArc
        : editorialMotionArcFor(optionalText(shot.narration) ?? "", optionalText(shot.beat) ?? "", camera),
      typography: shot.typography && typeof shot.typography === "object"
        ? shot.typography as DocumentaryTypographyPlan
        : editorialTypographyFor(optionalText(shot.kind), Boolean(optionalText(shot.title))),
    } as unknown as DocuShotPlan;
  });

  return {
    ...raw,
    title: optionalText(raw.title) ?? "",
    styleId: optionalText(raw.styleId) ?? "",
    shots,
  } as DocuPlan;
}

/** Per-kind asset contract: role → [min, max] count. */
const KIND_ASSETS: Record<DocuShotKind, Partial<Record<DocuAssetRole, [number, number]>>> = {
  parallax_portrait: { bg: [1, 1], fg: [1, 1] },
  depth_parallax: { image: [1, 1] }, // one scene; near depth layers are DERIVED
  geo_map: {}, // no images — real street geometry is FETCHED from geoQuery
  map_zoom: { bg: [1, 1] },
  photo_slide: { bg: [1, 1], image: [2, 3] },
  matte_sequence: { image: [3, 4] },
  collage_pan: { bg: [0, 1], image: [6, 8] },
  evidence_board: { bg: [0, 1], image: [3, 6] },
  object_drop: { bg: [1, 1], fg: [0, 1], cutout: [1, 3] },
  quote_card: { bg: [0, 1] },
  // VOX kinds (motion-graphics shots — composition-drawn, no photo assets;
  // vox_scene/vox_reveal may take one optional bg plate).
  vox_reveal: { bg: [0, 1] },
  vox_chart: {},
  vox_counter: {},
  vox_map: {},
  vox_dialogue: {},
  vox_typewriter: {},
  vox_scene: { bg: [0, 1] },
};

/** What each capability does + when to use it — the planner's palette. */
const CAPABILITY_CATALOG =
  `CAPABILITY PALETTE (use any when it serves the story; the style says which to LEAN on):\n` +
  `- parallax_portrait: a die-cut person over a plate with a huge NAME title — introduce a person.\n` +
  `- depth_parallax: ONE cinematic scene given living 2.5D depth, camera drifts THROUGH it — the WORKHORSE for ` +
  `ESTABLISHING/WIDE scene-setting (a city skyline, a bank exterior at night, the insider standing across the street, ` +
  `the crew around a table) AND reconstructed moments (the safe being cracked). Render people IN the scene here, not ` +
  `as cutouts. (brief MUST describe a clear foreground subject and a separated background). Optional ` +
  `"rackFocus": a cinematic FOCUS PULL — "near_to_far" (start on the foreground subject, pull focus to the depths) or ` +
  `"far_to_near" (reveal the foreground). Use it when the line shifts attention between a close thing and a deeper ` +
  `one (e.g. "a gloved hand on the dial — then the vault yawning behind"); only on a brief with a STRONG close ` +
  `subject AND a clearly deeper, separated background.\n` +
  `- geo_map: a FULLY RENDERED cinematic CARTOGRAPHIC reveal of a REAL place — the subject is the hero: a canal/` +
  `river/strait draws on as a glowing channel between its endpoints, a country/region/lake/city reveals its OUTLINE, ` +
  `over real water bodies + a true lat/lon graticule with coordinate labels, a GPS-lock readout, radar sweep, compass ` +
  `and metric scale bar; the camera pushes in with parallax. Needs a real "geoQuery" — a place ("Antwerp, Belgium"), ` +
  `a waterway ("Suez Canal"), a region or a country. Use this to pin a story to a real location or trace a route.\n` +
  `- map_zoom: a simpler aged map/chart with a ringed location word — geography when geo_map is overkill.\n` +
  `- photo_slide: 2-3 taped photographs sliding over a plate — a handful of evidence/photos.\n` +
  `- matte_sequence: 3-4 full-frame scenes with torn-paper cuts between them — a list of places/moments.\n` +
  `- collage_pan: 6-8 small photos on a board, slow rostrum pan — a broad sweep.\n` +
  `- evidence_board: cork board of pinned photos joined by RED STRING, camera prowls and HOLDS on each clue — ` +
  `investigations and webs of connection.\n` +
  `- object_drop: 1-3 objects drop onto a plate under a huge number/title — money, loot, a key object.\n` +
  `- quote_card: a single closing line — the landing.`;

const CAMERA_MOVES = ["push_in", "pull_back", "pan_left", "pan_right", "drift"];
const CAMERA_INTENSITIES = ["subtle", "medium", "strong"];

export function validatePlan(
  plan: DocuPlan,
  durationSec: number,
  _style: DocuStyleDef,
  opts?: { narrationWordsPerSec?: number },
): string[] {
  const problems: string[] = [];
  if (!plan.shots?.length || plan.shots.length < 5) problems.push("need 6-8 shots");
  // Any KNOWN capability is allowed — a style biases selection, it does not
  // restrict it (the planner composes freely).
  for (const [i, s] of (plan.shots ?? []).entries()) {
    if (!KIND_ASSETS[s.kind]) {
      problems.push(`shot ${i}: unknown kind "${s.kind}" (use one of: ${Object.keys(KIND_ASSETS).join(", ")})`);
      continue;
    }
    if (!s.narration?.trim()) problems.push(`shot ${i}: missing narration (the spoken VO line)`);
    if (!["establishing", "wide", "medium", "close"].includes(s.scale)) problems.push(`shot ${i}: scale must be establishing|wide|medium|close`);
    if (!s.beat?.trim()) problems.push(`shot ${i}: empty beat`);
    if (!(s.durationSec >= 3 && s.durationSec <= 10)) problems.push(`shot ${i}: durationSec must be 3-10`);
    if (!s.camera || !CAMERA_MOVES.includes(s.camera.move) || !CAMERA_INTENSITIES.includes(s.camera.intensity))
      problems.push(`shot ${i}: camera must be {move,intensity}`);
    if (!s.camera?.revealMove || s.camera.revealAtPercent === undefined || s.camera.revealMove === s.camera.move) {
      problems.push(`shot ${i}: camera needs a distinct revealMove and revealAtPercent for the in-shot proof reset`);
    }
    if (s.camera?.revealMove && !CAMERA_MOVES.includes(s.camera.revealMove)) {
      problems.push(`shot ${i}: camera.revealMove must be a supported camera move`);
    }
    if (s.camera?.revealAtPercent !== undefined && (s.camera.revealAtPercent < 0.28 || s.camera.revealAtPercent > 0.66)) {
      problems.push(`shot ${i}: camera.revealAtPercent must land the reveal between 28% and 66% of the shot`);
    }
    if (!s.coverage?.primarySubject?.trim() || !s.coverage.visualProof?.trim() || !s.coverage.roles.includes("proof")) {
      problems.push(`shot ${i}: needs a named primary subject, literal visual proof, and proof coverage`);
    }
    if (s.kind !== "quote_card" && (s.coverage?.roles.length ?? 0) < 2) {
      problems.push(`shot ${i}: needs at least two editorial coverage roles`);
    }
    if (!s.motionArc?.establish?.trim() || !s.motionArc.reveal?.trim() || !s.motionArc.exit?.trim() || !s.motionArc.purpose?.trim()) {
      problems.push(`shot ${i}: needs an establish → reveal → exit motion arc`);
    } else if (s.motionArc.visualResetAtPercent < 0.28 || s.motionArc.visualResetAtPercent > 0.66 || s.durationSec * s.motionArc.visualResetAtPercent > 4.1) {
      problems.push(`shot ${i}: visual reset must land between 28%-66% and before 4.1s`);
    }
    if (!s.typography || s.typography.maxWords < 1 || s.typography.maxWords > 6) {
      problems.push(`shot ${i}: typography must declare a restrained 1-6 word copy budget`);
    }
    if ((s.title?.trim().split(/\s+/).length ?? 0) > 3) problems.push(`shot ${i}: title must be <=3 words; use annotations for supporting context`);
    if ((s.visualCues?.length ?? 0) < 2) problems.push(`shot ${i}: needs at least two concrete must-show visual cues`);
    const byRole: Record<string, number> = {};
    for (const a of s.assets ?? []) byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    for (const [role, [min, max]] of Object.entries(KIND_ASSETS[s.kind]) as [DocuAssetRole, [number, number]][]) {
      const n = byRole[role] ?? 0;
      if (n < min || n > max) problems.push(`shot ${i} (${s.kind}): needs ${min}-${max} ${role}, got ${n}`);
    }
    if (s.kind === "quote_card") {
      const quote = optionalText(s.quote);
      if (!quote) problems.push(`shot ${i}: quote_card without quote`);
      else {
        const quoteWords = quote.split(/\s+/).length;
        if (quoteWords > QUOTE_CARD_MAX_WORDS || Array.from(quote).length > QUOTE_CARD_MAX_CHARACTERS) {
          problems.push(
            `shot ${i}: quote_card quote must be <=${QUOTE_CARD_MAX_WORDS} words and <=${QUOTE_CARD_MAX_CHARACTERS} characters`,
          );
        }
      }
      if (s.attribution && Array.from(s.attribution).length > QUOTE_ATTRIBUTION_MAX_CHARACTERS) {
        problems.push(`shot ${i}: quote_card attribution must be <=${QUOTE_ATTRIBUTION_MAX_CHARACTERS} characters`);
      }
    }
    if (s.kind === "geo_map" && !s.geoQuery?.trim()) problems.push(`shot ${i}: geo_map without geoQuery (a real place name)`);
  }
  const total = (plan.shots ?? []).reduce((a, s) => a + (s.durationSec || 0), 0);
  if (Math.abs(total - durationSec) > durationSec * 0.15) problems.push(`durations sum ${total}s, target ${durationSec}s (±15%)`);
  // Narration normally drives the video length at a standard documentary pace.
  // A locked Short may deliberately use a measured slower delivery with visual
  // breathing room; callers then declare its tested words-per-second target.
  const words = (plan.shots ?? []).map((s) => s.narration ?? "").join(" ").split(/\s+/).filter(Boolean).length;
  const narrationWordsPerSec = Math.max(0.8, Math.min(4, opts?.narrationWordsPerSec ?? 2.3));
  const wTarget = Math.round(durationSec * narrationWordsPerSec);
  if (words < wTarget * 0.8 || words > wTarget * 1.4) problems.push(`narration ${words} words, target ~${wTarget} (≈${narrationWordsPerSec} words/sec fills ${durationSec}s; under-writing leaves the video half-silent)`);
  // Documentary shot grammar: SET THE SCENE first, then have scale variety.
  const scales = (plan.shots ?? []).map((s) => s.scale);
  const opensWide = scales.slice(0, 2).some((sc) => sc === "establishing" || sc === "wide");
  if (!opensWide) problems.push("shots 1-2 must ESTABLISH the scene (scale establishing/wide) before any close detail");
  const wideCount = scales.filter((sc) => sc === "establishing" || sc === "wide").length;
  if (wideCount < 2) problems.push(`need >=2 establishing/wide scene-setting shots (got ${wideCount})`);
  if (new Set(scales).size < 2) problems.push("vary the shot scale (don't use one scale for everything)");
  const moveTypes = new Set((plan.shots ?? []).map((shot) => shot.camera?.move).filter((move) => move && move !== "drift"));
  if (moveTypes.size < 3) problems.push("need at least three motivated camera move types across the Short");
  const titleShots = (plan.shots ?? []).filter((shot) => Boolean(shot.title?.trim())).length;
  if (titleShots / Math.max(1, plan.shots.length) > 0.65) problems.push("large title treatment appears in too many beats; let the imagery carry more of the story");
  return problems;
}

function planContract(style: DocuStyleDef): string {
  return `Return STRICT JSON:
{
 "title": "video title",
 "styleId": "${style.id}",
 "shots": [
   {
     "narration": "the EXACT voiceover sentence spoken over this shot (present tense, concrete, cinematic) — the visual must SHOW what this says",
     "scale": "establishing|wide|medium|close — shot 1-2 establish the world; tighten over the video",
     "kind": one of [${Object.keys(KIND_ASSETS).join(", ")}] — LEAN ON [${style.preferredKinds.join(", ")}]; pick the one that best SHOWS this line at this scale,
     "beat": "<=8 words: the visual intent (what we literally see)",
     "durationSec": n (3-10),
     "camera": {"move": "push_in|pull_back|pan_left|pan_right|drift", "intensity": "subtle|medium|strong", "revealMove": "a distinct second motivated move", "revealAtPercent": 0.28-0.66},
     "coverage": {"primarySubject":"the literal person/place/object the viewer sees", "visualProof":"the exact fact or object this frame proves", "roles":["establish","hero","proof","detail"]},
     "motionArc": {"establish":"how the viewer is oriented", "reveal":"what new information appears", "exit":"how the frame hands off", "purpose":"why this movement advances the story", "visualResetAtPercent":0.28-0.66},
     "typography": {"mode":"headline|annotation|minimal", "purpose":"orient|identify|emphasize|land", "maxWords":1-6},
     "title": "BIG headline <=3 words (parallax_portrait / object_drop / evidence_board)",
     "kicker": "tiny letterspaced line above the title (optional)",
     "labels": [{"text": "<=3 word callout / evidence tag", "sub": "optional handwritten note <=6 words"}],
     "annotations": ["optional handwritten margin note <=6 words"],
     "circleLabel": "map_zoom ring word (one word)",
     "quote": "quote_card only — THE line <=14 words AND <=120 characters; typography is added later by Remotion",
     "quoteEmphasis": ["quote_card only — 1-3 exact words already present in quote that carry its stakes or turn; never a mundane filler noun"],
     "attribution": "quote_card byline",
     "accent": "optional hex accent for this shot",
     "threads": [{"from": photoIndex, "to": photoIndex}]  (evidence_board only — connections between its images),
     "geoQuery": "Real place name, geo_map ONLY (e.g. \\"Antwerp, Belgium\\")",
     "rackFocus": "depth_parallax ONLY, optional: near_to_far | far_to_near (a cinematic focus pull)",
     "visualCues": ["2-4 specific things the finished frame MUST visibly prove from this narration; never generic style words"],
     "assets": [{"id":"bg","role":"bg|fg|image|cutout","brief":"vivid period/world-correct description, NO text in image","source":"online|generate|archival","onlineQuery":"precise real subject/place/object for licensed online search","query":"<entity name if source=archival>"}]
   }
 ]
}
ASSET CONTRACT per kind (exact roles): parallax_portrait: 1 bg (wide environment plate, calm centre for big type) + 1 fg (the protagonist ALONE, head/shoulders/arms inside frame, plain backdrop). depth_parallax: exactly 1 image (a cinematic scene with a CLEAR foreground subject and a separated background — the engine derives the 2.5D depth layers). geo_map: ZERO assets — supply "geoQuery" (a real place); the map is rendered from live street data. map_zoom: 1 bg (aged map/chart of the region). photo_slide: 1 bg + 2-3 image. matte_sequence: 3-4 image (full-frame scenes). collage_pan: 1 bg + 6-8 image. evidence_board: optional 1 bg (cork/board) + 3-6 image (the pinned clues/suspects/photos). object_drop: 1 bg + 0-1 fg + 1-3 cutout (single object on white). quote_card: 0-1 PICTURE-ONLY background plate with negative space; NEVER put the quote, attribution, or any lettering in its brief/image.
SOURCE: use "online" with a precise "onlineQuery" for every real named person, place, company, document or object that can be shown factually; the renderer searches Pexels and Wikimedia Commons, records source/license/credit, and accepts it only after the visual gate. If that search has no usable match, it falls back to direct Novita Z-Image Turbo. FAL/Nano Banana is reserved for thumbnails and is never an asset fallback. Use "archival" only for a deliberately pinned Wikimedia query; otherwise use "online".
CUE-DRIVEN ASSETS: every asset brief must depict EXACTLY what its shot's narration line says — render the concrete image the words evoke. If the line names the crew → a scene of the crew (e.g. dark-clad figures in a dim vault corridor at night); a place from above → an aerial/overhead scene of that place; a person at a location → that person in front of that location; an object → that object. Do NOT use generic filler.
EDITORIAL RHYTHM: every beat must visibly reset before 4.1 seconds: establish the literal subject, reveal a new proof/detail through a distinct camera move, then leave the frame with a readable handoff. Do not use a generic hero plate as a substitute for factual proof. Across the film, cover the world with establishment, hero, proof, and detail frames; no same-shaped plate can carry consecutive new claims.
ON-SCREEN TEXT TONE: titles/kickers/labels/circleLabels must be SHORT, dramatic and tonally on-point for a premium documentary — evocative, never awkward, literal, redundant or accidentally COMICAL. (Bad: an evidence shot titled "THE TRASH". Good: "THE SLIP", "ONE MISTAKE", "THE INSIDER".) When unsure, omit the title and let the imagery speak.`;
}

/** Gemini Pro plans the shot list for the chosen style. One retry, then loud. */
export async function planDocu(args: {
  topic: string;
  style: DocuStyleDef;
  referenceNotes?: string;
  durationSec: number;
  log?: Logger;
}): Promise<DocuPlan> {
  const { topic, style, referenceNotes, durationSec, log } = args;
  const shotsWanted = Math.max(6, Math.min(8, Math.round(durationSec / 8)));
  // ~2.3 words/sec at documentary pace — the narration LENGTH sets the video
  // length now, so this must fill the target duration (not under-write it).
  const wordsTarget = Math.round(durationSec * 2.3);
  const base =
    `You are the writer + director of ${style.worldDescription}\n` +
    `CREATIVE DIRECTION: ${style.creativeDirection}\n` +
    `Make the first ${durationSec} seconds of a documentary about: ${topic}.\n` +
    (referenceNotes ? `REFERENCE (beats + visual grammar to honour): ${referenceNotes}\n` : "") +
    `WORK IN THIS ORDER:\n` +
    `STEP 1 — write the NARRATION: a gripping, FACTUAL voiceover that carries the viewer through the story as ONE ` +
    `coherent arc (hook → who/where → how it unfolds → the turn → the payoff), ~${wordsTarget} words total across ` +
    `exactly ${shotsWanted} beats (one beat = one shot, ~${Math.round(wordsTarget / shotsWanted)} words each). Present ` +
    `tense, concrete, cinematic, no filler. Each beat must flow from the last.\n` +
    `STEP 2 — SET THE SCENE FIRST (documentary shot grammar): a documentary ESTABLISHES the world before any detail. ` +
    `Shot 1 (and usually shot 2) must be ESTABLISHING/WIDE — place the viewer in the location: a wide aerial or ` +
    `exterior of the city/skyline/building, the atmosphere of the place. Introduce PEOPLE IN THEIR ENVIRONMENT as ` +
    `WIDE/MEDIUM scenes (the lone figure across the street from the bank at night; the crew gathered around a table in ` +
    `a dim room) — render them INSIDE the scene with depth_parallax, NOT as a floating cutout. Then move WIDE → MEDIUM ` +
    `→ CLOSE as the story tightens (establish the building → the vault door → the hand on the dial). Vary the scale; ` +
    `never string together only tight close-ups. Give each shot a "scale".\n` +
    `STEP 3 — VISUALISE each beat: choose the capability that best SHOWS that line + write asset brief(s) depicting ` +
    `EXACTLY that image at that SCALE (establishing/wide briefs = lots of environment + the whole place; close briefs ` +
    `= tight detail). Cue→capability: a real place / "the city" / "the building" / "from above" → geo_map (real ` +
    `streets) or a WIDE aerial depth_parallax; a person IN a place, the crew, a reconstructed MOMENT → depth_parallax ` +
    `of that exact wide/medium scene; a deliberate single face-forward REVEAL of a named person → parallax_portrait ` +
    `(archival photo if famous) — use this sparingly, NOT for every person; a web of clues → evidence_board; a ` +
    `sum/object → object_drop. The viewer must always SEE what they HEAR.\n` +
    `${CAPABILITY_CATALOG}\n` +
    `RULES: exactly ${shotsWanted} shots. Shot 1 = a strong HOOK (prefer ${style.hookKind}). Last shot = ` +
    `${style.closerKind}. Lean on this world's preferred capabilities but pick whatever SHOWS the line best; vary the ` +
    `kinds (no identical kind back-to-back unless it is the world's spine). Only choose a visual you can render ` +
    `CONVINCINGLY — if a beat is abstract, reframe its narration to a concrete, showable image. CINEMATOGRAPHY: ` +
    `${style.cinematography}\n` +
    `Asset briefs: vivid, specific, world-correct, strong subject/background separation, NO text/lettering in the ` +
    `image.\n${planContract(style)}`;

  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const rawPlan = await geminiJsonPro<unknown>({ prompt: base + feedback, maxTokens: 9000, temperature: 0.6, log });
    let plan: DocuPlan;
    try {
      plan = normalizeDocuPlan(rawPlan);
    } catch (error) {
      lastProblems = [error instanceof Error ? error.message : "plan is malformed"];
      log?.(`documotion plan attempt ${attempt + 1} rejected: ${lastProblems.join("; ")}`);
      feedback = `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly these: ${lastProblems.join("; ")}`;
      continue;
    }
    plan.styleId = style.id;
    lastProblems = validatePlan(plan, durationSec, style);
    if (!lastProblems.length) {
      await lintLabels(plan, style, log);
      log?.(`documotion plan [${style.id}]: "${plan.title}" — ${plan.shots.length} shots, narration-driven`);
      return plan;
    }
    log?.(`documotion plan attempt ${attempt + 1} rejected: ${lastProblems.join("; ")}`);
    feedback = `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly these: ${lastProblems.join("; ")}`;
  }
  throw new Error(`documotion: plan failed validation twice (${lastProblems.join("; ")})`);
}

/**
 * On-screen TEXT tonal lint — review every title/kicker/label/circleLabel in
 * the context of its shot's narration and rewrite anything awkward, literal,
 * redundant or accidentally comical (the "THE TRASH" problem). Mutates the plan
 * in place; never throws (the plan is already valid).
 */
async function lintLabels(plan: DocuPlan, style: DocuStyleDef, log?: Logger): Promise<void> {
  const items = plan.shots.map((s, i) => ({
    i,
    kind: s.kind,
    narration: s.narration,
    title: s.title ?? "",
    kicker: s.kicker ?? "",
    circleLabel: s.circleLabel ?? "",
    labels: (s.labels ?? []).map((l) => l.text),
  }));
  const hasText = items.some((it) => it.title || it.kicker || it.circleLabel || it.labels.length);
  if (!hasText) return;
  try {
    const res = await geminiJson<{ fixes?: { i: number; title?: string; kicker?: string; circleLabel?: string; labels?: string[] }[] }>({
      prompt:
        `You are the typography editor of a premium ${style.label} documentary. Below is the on-screen TEXT for each ` +
        `shot with its voiceover. A title/label is a DRAMATIC card — it must name the SIGNIFICANCE or stakes, never a ` +
        `mundane object literally. HARD RULE: if a title literally names something ordinary (trash, sandwich, bag, ` +
        `crumbs, food), it reads as accidentally COMICAL at huge scale — you MUST replace it with the dramatic meaning ` +
        `(e.g. title "THE TRASH" over a discarded-evidence shot → "ONE MISTAKE" or "THE SLIP"; "THE SANDWICH" → ` +
        `"THE EVIDENCE"). Also fix anything clunky, redundant or off-tone. Keep genuinely strong text unchanged. Set a ` +
        `field to "" to drop it and let the image speak. Titles <=3 words, labels <=3 words, circleLabel one word.\n` +
        `SHOTS:\n${JSON.stringify(items)}\n` +
        `Return STRICT JSON {"fixes":[{"i":n,"title":"...","kicker":"...","circleLabel":"...","labels":["..."]}]} — ` +
        `include EVERY shot you changed; you MUST change any literal mundane-object title.`,
      maxTokens: 1500,
      temperature: 0.2,
    });
    let n = 0;
    for (const f of res.fixes ?? []) {
      const s = plan.shots[f.i];
      if (!s) continue;
      if (f.title !== undefined) { s.title = f.title || undefined; n++; }
      if (f.kicker !== undefined) { s.kicker = f.kicker || undefined; n++; }
      if (f.circleLabel !== undefined) { s.circleLabel = f.circleLabel || undefined; n++; }
      if (f.labels !== undefined && s.labels) { s.labels = f.labels.map((t, k) => ({ ...s.labels![k], text: t })).filter((l) => l.text); n++; }
    }
    if (n) log?.(`documotion label lint: rewrote ${n} on-screen text item(s)`);
  } catch (e) {
    log?.(`documotion label lint skipped (${e instanceof Error ? e.message : e})`);
  }
}

/**
 * CINEMATOGRAPHER PASS — the planner writes the narrative + structure; THIS pass
 * REALISES each shot. It rewrites every asset brief so the picture literally shows
 * the line's concrete elements (the subject, the action, the key objects), named
 * + period-accurate + composed, and rewrites the on-screen text to carry real
 * INFORMATION (a name / date / place / number) instead of a generic chapter
 * label. It also records the per-shot visualCues the verifier checks. One
 * Gemini-Pro call; mutates the plan. Best-effort — on failure the planner's
 * briefs stand. (Doctrine in src/lib/visualDirection.ts is reusable by other
 * narrated engines.)
 */
export async function directDocuVisuals(plan: DocuPlan, style: DocuStyleDef, topic: string, log?: Logger): Promise<void> {
  const arc = plan.shots.map((s, i) => `${i}. ${s.narration}`).join("\n");
  const shotReqs = plan.shots
    .map((s, i) => {
      const roles = s.kind === "geo_map" ? "(none — geo map renders from data)" : s.assets.map((a) => `${a.id}(${a.role}${a.source === "archival" ? `, archival of "${a.query}"` : ""})`).join(", ");
      return `SHOT ${i} [${s.kind} / ${s.scale}] line: "${s.narration}"\n  MUST SHOW: ${s.visualCues?.join("; ") || s.beat}\n  asset roles to rewrite: ${roles}`;
    })
    .join("\n");
  try {
    const geoShots = plan.shots.map((s, i) => ({ s, i })).filter((x) => x.s.kind === "geo_map");
    const res = await geminiJsonPro<{
      shots?: { i: number; assets?: { id: string; brief?: string; source?: "generate" | "archival" | "online"; query?: string; onlineQuery?: string }[]; title?: string; kicker?: string; circleLabel?: string; labels?: { text: string; sub?: string }[]; annotations?: string[]; cues?: string[]; geoContext?: { label: string; side: "top" | "bottom" | "left" | "right" }[] }[];
    }>({
      prompt:
        `${CINEMATOGRAPHER_DOCTRINE}\n\n` +
        `VIDEO: a "${style.label}" documentary about: ${topic}.\nLOOK CONTRACT (every image inherits this): ${style.stillStyle}\nWORLD: ${style.creativeDirection}\n\n` +
        `THE NARRATION ARC (keep the SAME figures/places consistent across shots):\n${arc}\n\n` +
        `For EACH shot, REWRITE every listed asset brief into a rich, specific, COMPOSED image that shows ITS line's concrete elements (keep each asset's id), and write SPECIFIC on-screen text. Keep the shot kind. geo_map shots have no image assets — still give specific text + cues. quote_card keeps its quote, but its optional bg brief MUST describe only a text-free atmospheric picture plate with negative space; NEVER copy the quote/attribution into an asset brief.\n\n` +
        `SOURCE — set "source" per asset. PREFER "generate" for almost everything: a composed, period-accurate GENERATED image is more faithful to the line and on-style. Use "archival" ONLY for a genuinely iconic, UNAMBIGUOUS public-domain photograph, with a precise "query" — and NEVER for a person/thing whose name also matches a DIFFERENT subject (e.g. "Ferdinand de Lesseps" also returns Panama Canal material → GENERATE him instead). When in doubt, generate.\n\n` +
        (geoShots.length
          ? `GEO ORIENTATION — for the geo_map shot(s) [${geoShots.map((x) => x.i).join(", ")}], also give "geoContext": 2-4 orienting labels that place the feature so the viewer sees WHERE it is and what it connects, in relation to the line. Use REAL surrounding geography with the correct side: e.g. a N–S canal → {"label":"MEDITERRANEAN SEA","side":"top"},{"label":"RED SEA","side":"bottom"},{"label":"EGYPT","side":"left"},{"label":"SINAI","side":"right"}.\n\n`
          : "") +
        `${shotReqs}\n\n` +
        `Return STRICT JSON {"shots":[{"i":n,"assets":[{"id":"bg","brief":"rich, specific, composed PICTURE-ONLY brief — name the real subject, show the action + key objects, set framing/lighting/era","source":"online|generate|archival","query":"<only if archival: a precise unambiguous subject>","onlineQuery":"<for a real factual subject: exact Wikimedia search phrase>"}],"title":"OPTIONAL specific headline — a name / number / place, not an abstraction (<=3 words; omit when the image carries the line)","kicker":"informative qualifier <=6 words","circleLabel":"ring/geo word if any","labels":[{"text":"specific callout <=4 words","sub":"opt note"}],"annotations":["opt margin note"],"cues":["concrete thing the frame MUST show","2-4 of these"],"geoContext":[{"label":"MEDITERRANEAN SEA","side":"top"}]}]}.`,
      maxTokens: 4000,
      temperature: 0.5,
    });
    let touched = 0;
    for (const d of res?.shots ?? []) {
      const s = plan.shots[d.i];
      if (!s) continue;
      for (const da of d.assets ?? []) {
        const a = s.assets.find((x) => x.id === da.id);
        if (!a) continue;
        if (da.brief?.trim()) a.brief = da.brief.trim();
        if (da.source === "generate") { a.source = "generate"; a.query = undefined; }
        else if (da.source === "archival" && da.query?.trim()) { a.source = "archival"; a.query = da.query.trim(); }
        else if (da.source === "online" && da.onlineQuery?.trim()) { a.source = "online"; a.onlineQuery = da.onlineQuery.trim(); }
      }
      if (d.title?.trim()) {
        const title = d.title.trim();
        s.title = title.split(/\s+/).length <= 3 ? title : undefined;
      }
      if (d.kicker?.trim()) s.kicker = d.kicker.trim();
      if (d.circleLabel?.trim()) s.circleLabel = d.circleLabel.trim();
      if (d.labels?.length) s.labels = d.labels.filter((l) => l.text?.trim());
      if (d.annotations?.length) s.annotations = d.annotations.filter((x) => x?.trim());
      s.visualCues = normalizeDocumentaryVisualCues(
        s.narration,
        s.beat,
        d.cues?.length ? d.cues.filter((c) => c?.trim()).slice(0, 4) : s.visualCues,
      );
      if (d.geoContext?.length && s.kind === "geo_map") s.geoContext = d.geoContext.filter((g) => g.label?.trim() && ["top", "bottom", "left", "right"].includes(g.side)).slice(0, 4);
      touched++;
    }
    log?.(`documotion direct: cinematographer re-composed ${touched}/${plan.shots.length} shots (specific briefs + informative text + cues)`);
  } catch (e) {
    log?.(`documotion direct: cinematographer pass skipped (${e instanceof Error ? e.message : e}) — planner briefs stand`);
  }
}

/* ---------------------------------------------------------------- assets -- */

/** Downscale + recompress for sane inputProps size (keeps alpha for png). */
async function normalizeAsset(rawPath: string, outPath: string, maxW: number): Promise<string> {
  const vf = `scale='min(${maxW},iw)':-2`;
  if (outPath.endsWith(".png")) await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", vf, outPath]);
  else await run(ffmpegBin(), ["-y", "-i", rawPath, "-vf", vf, "-q:v", "4", outPath]);
  return outPath;
}

async function downloadTo(url: string, outPath: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
}

/**
 * Documentary renderers must not invoke FAL outside the thumbnail lane.
 * Cutout briefs therefore require a plain isolated backdrop from source or
 * Z-Image; when it is not achievable locally, the caller composes the full
 * approved image rather than purchasing a hidden background-removal call.
 */
async function removeBackground(_imgPath: string, _outPng: string, _log?: Logger): Promise<string> {
  throw new Error("documotion: external background removal disabled by the thumbnail-only FAL policy");
}

/**
 * Turn ONE still into 2.5D: get its depth map, then cut a feathered NEAR layer
 * (alpha PNG) from the brightest (nearest) depth band over the full base. The
 * renderer parallaxes near-over-base for a camera-through-photo move. Best
 * effort — returns [] on any failure so the shot degrades to a Ken Burns push.
 */
async function deriveDepthLayers(baseImg: string, outDir: string, shotIdx: number, log?: Logger): Promise<string[]> {
  void baseImg;
  void outDir;
  log?.(`documotion depth: shot ${shotIdx} uses authored source/cutout layers; external depth providers are disabled`);
  return [];
}

export interface AssetGate {
  verdictValid: boolean;
  styleOk: boolean;
  briefOk: boolean;
  noText: boolean;
  framingOk: boolean;
  fix?: string;
}

const TEXT_FREE_ASSET_CONTRACT =
  " PICTURE-ONLY CONTRACT: render scenery, people, and objects only. ZERO readable text, letters, numbers, words, " +
  "captions, quote lettering, labels, signs, logos, UI, borders, or watermarks. If the subject normally carries " +
  "writing, keep those markings abstract and illegible. All readable typography is added later by Remotion.";
const ASSET_APPROVAL_CONTRACT = "documotion-picture-only-v1";

function removeForbiddenCopy(value: string, forbiddenCopy: Array<string | undefined>): string {
  let clean = value;
  for (const forbidden of forbiddenCopy) {
    const exact = optionalText(forbidden);
    if (!exact || exact.length < 4) continue;
    clean = clean.replaceAll(exact, "the visual meaning of the closing line");
  }
  return clean;
}

export function buildDocuAssetPrompt(args: {
  framingPrefix: string;
  pictureBrief: string;
  stillStyle: string;
  quality: string;
  focus?: string;
  fix?: string;
  forbiddenCopy?: Array<string | undefined>;
}): string {
  const pictureBrief = removeForbiddenCopy(args.pictureBrief, args.forbiddenCopy ?? []);
  return (
    `${args.framingPrefix}${pictureBrief}.${args.stillStyle}${args.quality}${args.focus ?? ""}` +
    TEXT_FREE_ASSET_CONTRACT +
    (args.fix ? ` CRITICAL FIX FROM THE LAST ATTEMPT: ${args.fix}.` : "")
  );
}

export function isAssetGateApproved(gate: unknown): boolean {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) return false;
  const value = gate as Record<string, unknown>;
  return (
    value.verdictValid === true &&
    value.styleOk === true &&
    value.briefOk === true &&
    value.noText === true &&
    value.framingOk === true
  );
}

function rejectedAssetGate(fix: string): AssetGate {
  return { verdictValid: false, styleOk: false, briefOk: false, noText: false, framingOk: false, fix };
}

/**
 * Qwen can explain a compact JSON verdict in prose or use loose key syntax.
 * The fallback remains fail-closed: all four explicit boolean assignments are
 * required before an asset can pass.
 */
export function parseDocuAssetGate(raw: string): AssetGate {
  try {
    const parsed = parseJsonLoose<unknown>(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rejectedAssetGate("asset gate returned a malformed verdict");
    }
    const value = parsed as Record<string, unknown>;
    if (![value.styleOk, value.briefOk, value.noText, value.framingOk].every((item) => typeof item === "boolean")) {
      return rejectedAssetGate("asset gate omitted a required boolean verdict");
    }
    return {
      verdictValid: true,
      styleOk: value.styleOk as boolean,
      briefOk: value.briefOk as boolean,
      noText: value.noText as boolean,
      framingOk: value.framingOk as boolean,
      fix: optionalText(value.fix),
    };
  } catch {
    const field = (name: "styleOk" | "briefOk" | "noText" | "framingOk"): boolean | undefined => {
      const found = raw.match(new RegExp(`(?:["']?${name}["']?)\\s*[:=]\\s*(true|false)\\b`, "i"));
      return found ? found[1].toLowerCase() === "true" : undefined;
    };
    const styleOk = field("styleOk");
    const briefOk = field("briefOk");
    const noText = field("noText");
    const framingOk = field("framingOk");
    if (styleOk === undefined || briefOk === undefined || noText === undefined || framingOk === undefined) {
      return rejectedAssetGate("asset gate returned unparseable JSON");
    }
    return { verdictValid: true, styleOk, briefOk, noText, framingOk, fix: undefined };
  }
}

async function assetDigest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hasCurrentAssetApproval(path: string): Promise<boolean> {
  try {
    const approval = JSON.parse(await readFile(`${path}.approval.json`, "utf8")) as Record<string, unknown>;
    return approval.contract === ASSET_APPROVAL_CONTRACT && approval.sha256 === (await assetDigest(path));
  } catch {
    return false;
  }
}

async function persistAssetApproval(path: string): Promise<string> {
  const sha256 = await assetDigest(path);
  await writeFile(
    `${path}.approval.json`,
    JSON.stringify({ contract: ASSET_APPROVAL_CONTRACT, sha256 }),
    "utf8",
  );
  return sha256;
}

/** Per-still vision gate — catches weird crops/text/style drift before assembly. */
async function gateAsset(path: string, role: DocuAssetRole, brief: string, worldHint: string, log?: Logger): Promise<AssetGate> {
  const framingAsk =
    role === "fg"
      ? "framingOk: ONE subject, head/shoulders/arms inside frame (only bottom may crop), plain backdrop, not weirdly cropped?"
      : role === "cutout"
        ? "framingOk: single object fully inside frame on a plain background?"
        : "framingOk: clear focal hierarchy, no awkward crops of faces/subjects at the frame edge?";
  let raw = "";
  try {
    raw = await visionLocal({
      prompt:
        `ASSET GATE for ${worldHint}. Brief: "${brief.slice(0, 280)}". ` +
        `Judge: 1. styleOk: matches that world's look (not generic/glossy)? 2. briefOk: depicts the brief? ` +
        `3. noText: ZERO readable text/letters/numbers/captions/signs/logos/UI/borders/watermarks baked in, ` +
        `including on cutout objects? 4. ${framingAsk} ` +
        `Return STRICT JSON {"styleOk":bool,"briefOk":bool,"noText":bool,"framingOk":bool,"fix":"<=14 words"}.`,
      imagePaths: [path],
      json: true,
      maxTokens: 250,
    });
  } catch (error) {
    // Keep the actual provider failure visible in the run trace. The former
    // catch-to-empty string hid a missing/misconfigured judge and made every
    // safe asset gate look identical.
    log?.(`documotion asset gate unavailable: ${error instanceof Error ? error.message.slice(0, 420) : String(error).slice(0, 420)}`);
  }
  if (!raw) return rejectedAssetGate("asset gate unavailable; retry only after a verifiable text-free render");
  const verdict = parseDocuAssetGate(raw);
  if (!verdict.verdictValid) {
    log?.(`documotion asset gate malformed response: ${raw.replace(/\s+/g, " ").slice(0, 420)}`);
  }
  return verdict;
}

export interface DocuAssetFile {
  shotIdx: number;
  id: string;
  role: DocuAssetRole;
  path: string;
  /** Hash attested by the local approval sidecar after the asset gate passed. */
  approvalSha256: string;
}

export interface DocuAssetReceipt {
  shotIdx: number;
  rendererAssetId: string;
  role: DocuAssetRole;
  approvalSha256: string;
}

interface AssetJob {
  shotIdx: number;
  brief: DocuAssetBrief;
}

interface DocuAssetSourceLedger {
  version: "documotion-asset-source/v1";
  acquisition: "online" | "novita-z-image-turbo";
  acquiredAt: string;
  query?: string;
  provider: string;
  model?: string;
  sourcePageUrl?: string;
  downloadUrl?: string;
  attribution?: string;
  license?: string;
  licenseUrl?: string;
  fallbackReason?: string;
}

function onlineQueriesForAsset(shot: DocuShotPlan, asset: DocuAssetBrief): string[] {
  return [
    asset.onlineQuery,
    asset.query,
    shot.coverage?.primarySubject,
    shot.coverage?.visualProof,
    shot.visualCues?.[0],
    shot.beat,
  ].filter((value): value is string => Boolean(value?.trim()));
}

async function persistDocuAssetSource(path: string, source: DocuAssetSourceLedger): Promise<void> {
  await writeFile(`${path}.source.json`, `${JSON.stringify(source, null, 2)}\n`, "utf8");
}

/**
 * Generate every still — gated, in a concurrency pool. Cached: existing files
 * are kept (delete a file, or pass a fixNote "shotIdx:id", to regenerate).
 */
export async function generateDocuAssets(
  plan: DocuPlan,
  style: DocuStyleDef,
  assetsDir: string,
  log?: Logger,
  fixNotes?: Record<string, string>,
  format: DocuFormat = "long",
): Promise<DocuAssetFile[]> {
  await mkdir(assetsDir, { recursive: true });
  const jobs: AssetJob[] = [];
  for (const [i, shot] of plan.shots.entries()) for (const a of shot.assets ?? []) jobs.push({ shotIdx: i, brief: a });

  const out = await pool(jobs, ASSET_CONCURRENCY, async ({ shotIdx: i, brief: a }) => {
    const keyId = `${i}:${a.id}`;
    const needsAlpha = a.role === "fg" || a.role === "cutout";
    const finalPath = join(assetsDir, `s${i}_${a.id}${needsAlpha ? ".png" : ".jpg"}`);
    const externalFix = fixNotes?.[keyId];
    const shot = plan.shots[i];
    const pictureBrief =
      shot.kind === "quote_card"
        ? `Atmospheric closing background plate with calm negative space, visually expressing: ${(shot.visualCues ?? []).join("; ") || shot.beat || "a restrained documentary conclusion"}`
        : a.brief;
    const framing = getDocuRoleFraming(style, a.role, format);
    if (existsSync(finalPath) && !externalFix) {
      if (await hasCurrentAssetApproval(finalPath)) {
        return { shotIdx: i, id: a.id, role: a.role, path: finalPath, approvalSha256: await assetDigest(finalPath) };
      }
      // Legacy caches predate the proof sidecar. Verify once, persist the
      // content hash, then future resumes remain zero-provider and tamper-safe.
      const cachedGate = await gateAsset(finalPath, a.role, pictureBrief, style.label, log);
      if (!cachedGate.verdictValid) {
        throw new Error(`documotion asset s${i}/${a.id}: ${cachedGate.fix}; refusing image spend without a working gate`);
      }
      if (isAssetGateApproved(cachedGate)) {
        const approvalSha256 = await persistAssetApproval(finalPath);
        return { shotIdx: i, id: a.id, role: a.role, path: finalPath, approvalSha256 };
      }
      log?.(
        `documotion asset s${i}/${a.id}: unapproved cache rejected ` +
          `(style=${cachedGate.styleOk} brief=${cachedGate.briefOk} noText=${cachedGate.noText} framing=${cachedGate.framingOk}) — regenerating`,
      );
    }

    const rawPath = join(assetsDir, `s${i}_${a.id}_raw.jpg`);
    let got = false;
    let sourceLedger: DocuAssetSourceLedger | undefined;
    let fallbackReason = "no usable licensed online result";

    // SEARCH FIRST: Wikimedia Commons is the auditable online source. The
    // result only survives if it passes the same literal-brief/no-text gate as
    // generated stills; a broad or incorrect web image is not good enough.
    if (!externalFix && shot.kind !== "quote_card") {
      try {
        const onlineCandidates = await searchOnlineDocumentaryAssets({
          queries: onlineQueriesForAsset(shot, a),
          thumbWidth: format === "short" ? 1600 : 1920,
        });
        const rejectedOnline: string[] = [];
        for (const online of onlineCandidates) {
          await downloadTo(online.downloadUrl, rawPath);
          const onlineGate = await gateAsset(rawPath, a.role, pictureBrief, style.label, log);
          if (!onlineGate.verdictValid) {
            throw new Error(`documotion asset s${i}/${a.id}: ${onlineGate.fix}; refusing unverified online source`);
          }
          if (isAssetGateApproved(onlineGate)) {
            got = true;
            sourceLedger = {
              version: "documotion-asset-source/v1",
              acquisition: "online",
              acquiredAt: new Date().toISOString(),
              provider: online.provider,
              query: online.query,
              sourcePageUrl: online.sourcePageUrl,
              downloadUrl: online.downloadUrl,
              attribution: online.attribution,
              license: online.license,
              licenseUrl: online.licenseUrl,
            };
            log?.(`documotion asset s${i}/${a.id}: online ${online.provider} "${online.query}" (gate approved)`);
            break;
          } else {
            rejectedOnline.push(`${online.query}: style=${onlineGate.styleOk} brief=${onlineGate.briefOk} noText=${onlineGate.noText} framing=${onlineGate.framingOk}`);
          }
        }
        if (!got && rejectedOnline.length) {
          fallbackReason = `online candidates rejected (${rejectedOnline.join(" | ")})`;
          log?.(`documotion asset s${i}/${a.id}: ${fallbackReason} — using Novita Z-Image Turbo`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("refusing unverified online source")) throw error;
        fallbackReason = `online search unavailable (${error instanceof Error ? error.message : error})`;
        log?.(`documotion asset s${i}/${a.id}: ${fallbackReason} — using Novita Z-Image Turbo`);
      }
    }

    // Fallback only: the public Novita Z-Image Turbo API. FAL/Nano Banana
    // is intentionally reserved for thumbnails and is never a documentary
    // still provider.
    if (!got) {
      // Crisp by default; depth_parallax plates must be FULLY in focus so the
      // engine's 2.5D parallax supplies the depth (baked bokeh fights it +
      // leaves focus-edge artefacts when the layers move).
      const QUALITY = " Ultra-sharp, crisp, high detail, no motion blur.";
      const focus =
        plan.shots[i].kind === "depth_parallax"
          ? " CRITICAL: the ENTIRE frame is in SHARP focus front-to-back (deep depth of field) — NO bokeh, NO background blur, NO lens blur; the depth must read from layout/scale, never from focus."
          : "";
      let fix = externalFix ?? "";
      let accepted = false;
      let lastGate: AssetGate | undefined;
      for (let attempt = 0; attempt < MAX_NOVITA_ASSET_ATTEMPTS; attempt++) {
        const prompt = buildDocuAssetPrompt({
          framingPrefix: framing.prefix,
          pictureBrief,
          stillStyle: style.stillStyle,
          quality: QUALITY,
          focus,
          fix,
          forbiddenCopy: [shot.quote, shot.attribution],
        });
        log?.(`documotion asset s${i}/${a.id} (${a.role}) Novita Z-Image Turbo${fix ? ` [retry]` : ""}…`);
        const generated = await generateNovitaZImageTurbo({
          prompt:
            `${prompt} ` +
            "Absolutely no readable text, letters, numbers, captions, signs, logos, watermarks, UI, borders, labels, stamps, postmarks, or brand marks.",
          aspectRatio: framing.ar,
          seed: (i + 1) * 1009 + (attempt + 1) * 97 + a.id.length * 13,
        });
        await writeFile(rawPath, generated.bytes);
        const gate = await gateAsset(rawPath, a.role, pictureBrief, style.label, log);
        if (!gate.verdictValid) {
          throw new Error(`documotion asset s${i}/${a.id}: ${gate.fix}; refusing a second image submission`);
        }
        if (isAssetGateApproved(gate)) {
          accepted = true;
          sourceLedger = {
            version: "documotion-asset-source/v1",
            acquisition: "novita-z-image-turbo",
            acquiredAt: new Date().toISOString(),
            provider: "novita",
            model: generated.model,
            fallbackReason,
          };
          break;
        }
        lastGate = gate;
        fix = gate.fix || "cleaner framing, authentic style, absolutely no text";
        log?.(`documotion asset s${i}/${a.id} gate REJECTED (style=${gate.styleOk} brief=${gate.briefOk} noText=${gate.noText} framing=${gate.framingOk})`);
      }
      if (!accepted) {
        const detail = lastGate
          ? ` (style=${lastGate.styleOk} brief=${lastGate.briefOk} noText=${lastGate.noText} framing=${lastGate.framingOk}; fix=${lastGate.fix || "none"})`
          : "";
        throw new Error(
          `documotion asset s${i}/${a.id}: no approved picture-only asset after ${MAX_NOVITA_ASSET_ATTEMPTS} bounded attempts${detail}; refusing to ship a rejected provider image`,
        );
      }
    }

    if (needsAlpha) {
      const cutRaw = join(assetsDir, `s${i}_${a.id}_cut.png`);
      try {
        await removeBackground(rawPath, cutRaw, log);
        await normalizeAsset(cutRaw, finalPath, 1100);
      } catch (e) {
        // Best-effort cutout (mirrors deriveDepthLayers): a bg-removal failure
        // (e.g. fal 403 / no credits) degrades this fg to the full image rather
        // than killing the whole render.
        log?.(`documotion asset s${i}/${a.id}: bg-removal failed (${e instanceof Error ? e.message : e}) — using full image`);
        await normalizeAsset(rawPath, finalPath, 1100);
      }
    } else {
      await normalizeAsset(rawPath, finalPath, 1280);
    }
    const approvalSha256 = await persistAssetApproval(finalPath);
    if (sourceLedger) await persistDocuAssetSource(finalPath, sourceLedger);
    return { shotIdx: i, id: a.id, role: a.role, path: finalPath, approvalSha256 };
  });

  // depth_parallax: derive the near 2.5D layer from each scene's base image and
  // append it (after the base) so buildShotSpecs orders [base, near]. Cached.
  // Each shot's derivation is independent (own base image, own files, no ordering
  // dependency — consumers find by shotIdx+role), so derive them concurrently.
  const depthJobs = plan.shots
    .map((shot, i) => ({ shot, i, base: out.find((a) => a.shotIdx === i && a.role === "image") }))
    .filter((j) => j.shot.kind === "depth_parallax" && j.base);
  const depthAdds = await pool(depthJobs, ASSET_CONCURRENCY, async ({ i, base }) => {
    const baseFile = base!;
    const nearPath = join(assetsDir, `s${i}_near.png`);
    if (existsSync(nearPath) && !fixNotes?.[`${i}:${baseFile.id}`]) {
      return [{
        shotIdx: i,
        id: `${baseFile.id}_near`,
        role: "image" as const,
        path: nearPath,
        approvalSha256: await persistAssetApproval(nearPath),
      }];
    }
    const layers = await deriveDepthLayers(baseFile.path, assetsDir, i, log);
    return Promise.all(layers.map(async (p) => ({
      shotIdx: i,
      id: `${baseFile.id}_near`,
      role: "image" as const,
      path: p,
      approvalSha256: await persistAssetApproval(p),
    })));
  });
  for (const adds of depthAdds) for (const a of adds) out.push(a);

  log?.(`documotion assets: ${out.length} ready`);
  return out;
}

/* ------------------------------------------------------- specs + overrides -- */

export interface ShotOverride {
  titleBoost?: number;
  labelPos?: DocuLabelPos;
  camera?: DocuCamera;
  durationSec?: number;
}
export type DocuOverrides = Record<number, ShotOverride>;

function dataUri(path: string, bytes: Buffer): string {
  return `data:${path.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`;
}

/** Assemble renderer props: plan + assets + overrides → DocuShotSpec[].
 * Durations are normalised so the timeline sums exactly to durationSec. */
export async function buildShotSpecs(
  plan: DocuPlan,
  assets: DocuAssetFile[],
  durationSec: number,
  overrides: DocuOverrides = {},
  geoByShot: Record<number, CityGeo> = {},
  /** Narration-driven absolute per-shot seconds — when given, used VERBATIM (no
   *  normalization to durationSec) so the picture tracks the spoken word. */
  fixedDursSec?: number[],
): Promise<DocuShotSpec[]> {
  const cache = new Map<string, string>();
  const uri = async (p: string) => {
    if (!cache.has(p)) cache.set(p, dataUri(p, await readFile(p)));
    return cache.get(p)!;
  };
  const durs = fixedDursSec ?? plan.shots.map((s, i) => Math.max(3, Math.min(10, overrides[i]?.durationSec ?? s.durationSec ?? 7)));
  const norm = fixedDursSec ? 1 : durationSec / durs.reduce((a, b) => a + b, 0);
  const specs: DocuShotSpec[] = [];
  for (const [i, s] of plan.shots.entries()) {
    const mine = assets.filter((a) => a.shotIdx === i);
    const byRole = async (role: DocuAssetRole) => Promise.all(mine.filter((a) => a.role === role).map((a) => uri(a.path)));
    const [bgs, fgs, images, cutouts] = await Promise.all([byRole("bg"), byRole("fg"), byRole("image"), byRole("cutout")]);
    const o = overrides[i] ?? {};
    specs.push({
      kind: s.kind,
      durationInFrames: Math.max(36, Math.round(durs[i] * norm * FPS)),
      camera: { ...s.camera, ...(o.camera ?? {}) },
      visualResetAtPercent: s.motionArc?.visualResetAtPercent,
      bg: bgs[0],
      fg: fgs[0],
      images: images.length ? images : undefined,
      cutouts: cutouts.length ? cutouts : undefined,
      title: s.title,
      kicker: s.kicker,
      labels: s.labels,
      labelPos: o.labelPos,
      annotations: s.annotations,
      circleLabel: s.circleLabel,
      quote: s.quote,
      quoteEmphasis: s.quoteEmphasis,
      attribution: s.attribution,
      accent: s.accent,
      titleBoost: o.titleBoost,
      threads: s.threads,
      geo: geoByShot[i] ? { ...geoByShot[i], context: s.geoContext } : undefined,
      rackFocus: s.rackFocus,
    });
  }
  return specs;
}

/* --------------------------------------------------------------- verifier -- */

export interface RefineAction {
  type: "regen_asset" | "emphasize_text" | "reposition_labels" | "retime" | "camera";
  shot: number;
  asset?: string;
  fix?: string;
  to?: DocuLabelPos;
  durationSec?: number;
  move?: DocuCamera["move"];
  intensity?: DocuCamera["intensity"];
}

export interface DocuVerdict {
  typeCraft?: number;
  cutoutCraft?: number;
  composition?: number;
  legibility?: number;
  styleMatch?: number;
  cohesion?: number;
  pass?: boolean;
  actions?: RefineAction[];
  /** Output validation: does the finished video carry audible narration/music? */
  audioOk?: boolean;
  meanVolumeDb?: number;
  note?: string;
}

const VERIFIER_DOCTRINE =
  `HOW THIS ENGINE WORKS (critical): the ONLY assets are PHOTOGRAPHS and background PLATES. ALL text — titles, ` +
  `kickers, labels, evidence tags, quotes, attributions — and the red string, pushpins, highlight boxes, dividers, ` +
  `torn edges and tape are rendered by the ENGINE on TOP of the images. They are NEVER part of any image. So:\n` +
  `• NEVER use regen_asset to add, fix, spell or change TEXT — no image should ever contain text.\n` +
  `• regen_asset is ONLY for a PHOTOGRAPH/PLATE whose subject, style or framing is wrong (wrong content, glossy/` +
  `modern look, a person awkwardly cropped, a half-dissolved/ragged cutout edge). Reference only asset ids that ` +
  `exist for that shot (bg, fg, img1, img2…, cutout1…). Do not invent ids.\n` +
  `• If a TITLE/LABEL/QUOTE is too small or low-contrast, use emphasize_text (the engine enlarges it + strengthens ` +
  `its scrim). Titles are AUTO-FIT to the frame. A hero cutout that tucks the FIRST 1-3 characters of a name/title ` +
  `behind it is the INTENDED style — never call that truncation or a type defect; only flag if the PAYOFF (last) ` +
  `word is cut off at the frame edge.\n` +
  `• evidence_board / collage_pan stills are a moving camera — a still may frame ONE pinned photo or part of the ` +
  `board; that is correct. Judge the photo + red-string + cutout quality, not "missing" other elements.\n` +
  `• Do NOT nitpick photographic taste. regen_asset ONLY for a CLEAR defect: wrong subject, a ragged/half-cut ` +
  `cutout edge, baked-in text on a PHOTO/PLATE, or a plate that is essentially black/empty. A merely "stylised" or ` +
  `"staged" photo is fine.\n` +
  `• quote_card has one explicitly labelled DETERMINISTIC OVERLAY (the exact quote + attribution drawn by Remotion). ` +
  `That named overlay is intentional. ANY additional, duplicated, misspelled, or background lettering belongs to the ` +
  `underlying provider plate, violates the picture-only contract, and MUST trigger regen_asset for that background.`;

const VERIFIER_CHECKLIST =
  `THE CRAFT CHECKLIST:\n` +
  `1. TYPE: engine headlines HUGE (>=12% of frame height), readable at a glance, never lost in a busy plate; a ` +
  `headline's first characters may tuck behind a foreground cutout (the style) but stay recognisable. 2. CUTOUTS: ` +
  `hero/object cutouts read as INTENTIONAL die-cut pieces — clean edges, no half-dissolved subjects, clear ` +
  `separation from the plate. 3. COMPOSITION: one clear focal point, breathing room, nothing important buried, ` +
  `labels not colliding with faces/titles. 4. STYLE: cohesive world — same palette/grade/grain across shots. ` +
  `5. TEXT LAYOUT (legibility): NO two text blocks may overlap, touch or stack on top of one another — the engine ` +
  `headline/title, the kicker, every label and annotation, the quote and its attribution each sit in their OWN clear ` +
  `space with a visible gap. The lower-third title must never run into the label rail or bury a cutout's readable ` +
  `face; stacked labels must not overprint. ANY overlap, touching or unreadable pile-up of text = legibility <=4 + a ` +
  `reposition_labels action. (A headline whose first 1-3 characters tuck behind a hero cutout is the intended style, ` +
  `NOT an overlap.) ` +
  `6. Each frame is labelled with shot index, kind and camera move.`;

/** Score one still per shot and emit typed, actionable critique. */
export async function verifyDocu(args: {
  framePaths: string[];
  labels: string[];
  worldHint: string;
  log?: Logger;
}): Promise<DocuVerdict> {
  const basePrompt =
    `You are the FILM VERIFIER for a ${args.worldHint} motion engine. One frame per shot, in order:\n` +
    `${args.labels.join("\n")}\n${VERIFIER_DOCTRINE}\n${VERIFIER_CHECKLIST}\n` +
    `CUE FIDELITY (the most important check): the frame must SHOW what its LINE says. Read each shot's "MUST SHOW" ` +
    `and "EDITORIAL PROOF" fields — if a key element the line names is ABSENT or generic (e.g. the line is "stares at a map" but there is no ` +
    `map; "the laborers" but no people; a named person who is the wrong person/era), that shot's COHESION is <=4 and ` +
    `you MUST emit a regen_asset that adds the missing element. Reject generic hero plates that fail the stated proof, flat scenes that hide the requested foreground/background separation, or decorative title treatment that competes with the proof image. The picture has to realise the specific moment.\n` +
    `Score 1-10: typeCraft, cutoutCraft, composition, legibility, styleMatch, cohesion. pass = every score >=7 ` +
    `(legibility drops below 7 whenever any two text blocks overlap or touch; cohesion drops below 7 when the frame ` +
    `does not show its line's MUST-SHOW cues).\n` +
    `Then emit ACTIONS — only real problems, max 6, the MOST actionable fix per problem (obey the doctrine above):\n` +
    `- {"type":"regen_asset","shot":n,"asset":"<existing id: bg/fg/img1/cutout1>","fix":"<=14 words, PHOTO content/style/framing only, never text"}\n` +
    `- {"type":"emphasize_text","shot":n}  (type too small / weak contrast)\n` +
    `- {"type":"reposition_labels","shot":n,"to":"top_right|bottom_left|bottom_center"}  (text overlap / colliding labels — move the rail to clear space)\n` +
    `- {"type":"retime","shot":n,"durationSec":n}\n` +
    `- {"type":"camera","shot":n,"move":"push_in|pull_back|pan_left|pan_right|drift","intensity":"subtle|medium|strong"}\n` +
    `Return STRICT JSON {"typeCraft":n,"cutoutCraft":n,"composition":n,"legibility":n,"styleMatch":n,"cohesion":n,"pass":bool,"actions":[...],"note":"<=25 words"}.`;
  // The multi-image verify intermittently returns unparseable JSON, which silently
  // killed the regen/heal loop (actions=0). Retry once with a strict format reminder
  // before degrading — so the gate's repairs actually fire.
  let v: DocuVerdict = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await visionLocal({
      prompt: attempt === 0 ? basePrompt : `${basePrompt}\n\nCRITICAL: your previous reply was not valid JSON. Reply with ONLY the JSON object — no markdown fences, no prose before or after, all strings closed, properly comma-separated.`,
      imagePaths: args.framePaths,
      json: true,
      // Routed via visionLocal (cheap chain, downscaled + cached) — this was
      // the repo's ONLY Pro-vision call (gemini-3.1-pro-preview @ 6000 budget
      // x up to 6 calls per docu video).
      maxTokens: 2000,
    }).catch(() => "");
    if (!raw) continue;
    try { v = parseJsonLoose<DocuVerdict>(raw); break; }
    catch {
      if (attempt === 1) args.log?.("documotion verify: unparseable verdict JSON after retry — treating as unsatisfied (honest verdict)");
    }
  }
  // HARD legibility gate — overlapping text must never ship silently. Recompute
  // pass from all six craft scores so a generous model-assigned pass can't mask
  // a text collision (the failure mode that let a stale render go out).
  const scores = [v.typeCraft, v.cutoutCraft, v.composition, v.legibility, v.styleMatch, v.cohesion];
  if (scores.every((s) => typeof s === "number")) v.pass = (scores as number[]).every((s) => s >= 7);
  args.log?.(
    `documotion verify: type=${v.typeCraft} cutout=${v.cutoutCraft} comp=${v.composition} legib=${v.legibility} style=${v.styleMatch} cohesion=${v.cohesion} pass=${v.pass} actions=${v.actions?.length ?? 0}${v.note ? ` — ${v.note}` : ""}`,
  );
  return v;
}

/** Apply verifier actions: mutate overrides + collect asset regen notes. */
export function applyActions(actions: RefineAction[], overrides: DocuOverrides, log?: Logger): { overrides: DocuOverrides; assetFixes: Record<string, string> } {
  const assetFixes: Record<string, string> = {};
  // Hard guard: text lives in engine overlays, never in images. A regen whose
  // fix is about text would make Banana bake letters into a plate — convert it
  // to a text emphasis instead.
  const TEXT_FIX = /\b(text|title|label|caption|word|words|spell|spelling|letter|heading|headline|quote|name|legible|readable|truncat)/i;
  for (const a of actions ?? []) {
    if (typeof a.shot !== "number") continue;
    const o = (overrides[a.shot] ??= {});
    let type = a.type;
    if (type === "regen_asset" && (!a.asset || (a.fix && TEXT_FIX.test(a.fix)))) {
      type = "emphasize_text";
      log?.(`documotion refine: regen_asset on shot ${a.shot} rewritten to emphasize_text (text is an overlay, not an image)`);
    }
    switch (type) {
      case "regen_asset":
        if (a.asset && a.fix) assetFixes[`${a.shot}:${a.asset}`] = a.fix;
        break;
      case "emphasize_text":
        o.titleBoost = Math.min(1.35, (o.titleBoost ?? 1) * 1.16);
        break;
      case "reposition_labels":
        if (a.to) o.labelPos = a.to;
        break;
      case "retime":
        if (a.durationSec) o.durationSec = Math.max(3, Math.min(10, a.durationSec));
        break;
      case "camera":
        if (a.move && a.intensity) o.camera = { move: a.move, intensity: a.intensity };
        break;
    }
    log?.(`documotion refine: ${type} shot ${a.shot}${type === "regen_asset" && a.asset ? `/${a.asset}` : ""}${type === "regen_asset" && a.fix ? ` (${a.fix})` : ""}`);
  }
  return { overrides, assetFixes };
}

/** Render one verifier still per shot (fast — no full video) + build labels. */
async function renderVerifySet(args: {
  plan: DocuPlan;
  specs: DocuShotSpec[];
  style: DocuStyleDef;
  geometry: DocuRenderGeometry;
  framesDir: string;
  log?: Logger;
}): Promise<{ framePaths: string[]; labels: string[] }> {
  const { plan, specs, style, geometry, framesDir, log } = args;
  await mkdir(framesDir, { recursive: true });
  const frames: number[] = [];
  const outPaths: string[] = [];
  const labels: string[] = [];
  // Sample at the most REPRESENTATIVE moment per kind: panning/board shots are
  // sampled early (wide establishing — title + whole composition visible),
  // others mid-shot once everything has animated in.
  const sampleFrac = (k: DocuShotKind): number =>
    k === "evidence_board" ? 0.16 : k === "collage_pan" ? 0.22 : k === "geo_map" ? 0.78 : 0.55;
  let cursor = 0;
  for (const [i, spec] of specs.entries()) {
    frames.push(Math.round(cursor + spec.durationInFrames * sampleFrac(plan.shots[i].kind)));
    cursor += spec.durationInFrames;
    outPaths.push(join(framesDir, `s${i}.jpg`));
    const s = plan.shots[i];
    labels.push(
        `[shot ${i}] ${s.kind}, ${Math.round(spec.durationInFrames / FPS)}s, camera ${spec.camera?.move}/${spec.camera?.intensity}${spec.camera?.revealMove ? ` → ${spec.camera.revealMove} @${Math.round((spec.camera.revealAtPercent ?? 0.52) * 100)}%` : ""}` +
        (s.title ? `, title "${s.title}"` : "") +
        (s.labels?.length ? `, labels ${s.labels.map((l) => `"${l.text}"`).join("+")}` : "") +
        (s.kind === "quote_card" && s.quote
          ? `\n   DETERMINISTIC OVERLAY (allowed exact copy only): "${s.quote}"${s.attribution ? ` — ${s.attribution}` : ""}`
          : "") +
        `\n   LINE: "${s.narration}"` +
        (s.visualCues?.length ? `\n   MUST SHOW: ${s.visualCues.join("; ")}` : "") +
        (s.coverage ? `\n   EDITORIAL PROOF: ${s.coverage.visualProof}; coverage ${s.coverage.roles.join("/")}` : "") +
        (s.motionArc ? `\n   MOTION ARC: ${s.motionArc.establish} → ${s.motionArc.reveal} → ${s.motionArc.exit}; reset ${Math.round(s.motionArc.visualResetAtPercent * 100)}%` : ""),
    );
  }
  await renderDocuStills({
    shots: specs,
    frames,
    outPaths,
    width: geometry.verifyWidth,
    height: geometry.verifyHeight,
    layout: geometry.layout,
    theme: style.theme,
    fontCss: style.fontCss,
    fontProbe: style.fontProbe,
    log,
  });
  return { framePaths: outPaths, labels };
}

/* ------------------------------------------------------------ orchestrate -- */

export interface CraftDocuArgs {
  topic: string;
  /** Channel world id (src/remotion/docuStyles.ts). Default archival_collage. */
  style?: string;
  referenceNotes?: string;
  durationSec?: number;
  runDir: string;
  outPath?: string;
  /** Verifier refine rounds before the final render (default 2). */
  maxRefineRounds?: number;
  /** Final render parallelism (default cores-2 on the host). */
  concurrency?: number;
  /** Voice the plan narration + bed ducked music into the final video, and
   *  validate the result actually carries audio. Default ON (a documentary speaks). */
  narrate?: boolean;
  /** Render native landscape long-form or a native vertical Short from the asset request onward. */
  format?: DocuFormat;
  /** A verified strategy adapter may supply its locked beat plan instead of asking the planner to invent one. */
  plan?: DocuPlan;
  /** Keep supplied beat windows authoritative after per-shot narration is voiced. */
  lockShotDurations?: boolean;
  /** Optional per-render delivery pace (0.7–1.2). The George voice and timing breaths remain unchanged. */
  narrationSpeed?: number;
  /** Optional ElevenLabs model override for a bounded render; defaults to the provider's expressive v3 path. */
  elevenModelId?: string;
  /** Measured narration pace for a locked cut; defaults to the standard 2.3 words/sec documentary target. */
  narrationWordsPerSec?: number;
  log?: Logger;
}

export interface CraftDocuResult {
  outPath: string;
  plan: DocuPlan;
  verdict: DocuVerdict;
  rounds: number;
  geometry: DocuRenderGeometry;
  /** Exact per-shot visual windows used by the final render, in timeline order. */
  shotDurationsSec: number[];
  /** Content hashes for every approved renderer asset used in the final plan. */
  assetReceipts: DocuAssetReceipt[];
  /** Exact provider usage observed inside the isolated DocuMotion worker. */
  usage: DocuMotionUsage;
  /** The release-gate score for the exact accepted visual plan. */
  quality: DocumentaryVisualQualityAssessment;
}

export interface DocuMotionUsage {
  model: ModelUsageSummary;
  image: ImageUsageSummary;
  narration: {
    provider: string;
    billableCharacters: number;
    costUsd: number;
  };
  music: {
    generatedTracks: number;
    costUsd: number;
  };
  totalCostUsd: number;
}

/** The full visual engine — see module header. */
export async function craftDocuMotion(args: CraftDocuArgs): Promise<CraftDocuResult> {
  const modelUsageScope = createModelUsageScope();
  return modelUsageScope.run(async () => {
  const log = args.log ?? (() => {});
  const durationSec = args.durationSec ?? 60;
  const geometry = docuRenderGeometry(args.format ?? "long");
  const runDir = args.runDir;
  const maxRounds = args.maxRefineRounds ?? 2;
  const narrationSpeed = Math.max(0.7, Math.min(1.2, args.narrationSpeed ?? NARR.speed));
  const elevenModelId = args.elevenModelId;
  const style = getStyle(args.style);
  // Render children do not inherit the parent runner's async-local usage
  // scopes. Keep an explicit local scope so their real provider spend returns
  // with the patch and the parent can enforce the frozen run budget.
  const imageUsageScope = createImageUsageScope();
  const narrationUsage: DocuNarrationUsage = { provider: "fish", billableCharacters: 0 };
  await mkdir(runDir, { recursive: true });

  // 1. PLAN (cached) — then the CINEMATOGRAPHER pass realises each line into a
  //    specific, composed image + informative text (runs once, persisted).
  const planPath = join(runDir, "plan.json");
  let plan: DocuPlan;
  if (args.plan) {
    plan = normalizeDocuPlan(args.plan);
    const suppliedProblems = validatePlan(plan, durationSec, style, { narrationWordsPerSec: args.narrationWordsPerSec });
    if (suppliedProblems.length) {
      throw new Error(`documotion: supplied plan failed validation (${suppliedProblems.join("; ")})`);
    }
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
    log(`documotion: using supplied locked plan (${plan.shots.length} shots, style ${plan.styleId})`);
  } else if (existsSync(planPath)) {
    plan = normalizeDocuPlan(JSON.parse(await readFile(planPath, "utf8")));
    const cachedProblems = validatePlan(plan, durationSec, style, { narrationWordsPerSec: args.narrationWordsPerSec });
    if (cachedProblems.length) {
      throw new Error(
        `documotion: cached plan failed validation before provider work (${cachedProblems.join("; ")})`,
      );
    }
    // Persist the normalized form once, so future resumes inherit the stable
    // runtime schema instead of repeatedly handling old provider quirks.
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
    log(`documotion: plan loaded from cache (${plan.shots.length} shots, style ${plan.styleId})`);
  } else {
    plan = await planDocu({ topic: args.topic, style, referenceNotes: args.referenceNotes, durationSec, log });
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  }
  let planQuality = assessDocumentaryVisualQuality(plan.shots);
  if (planQuality.grade !== "good") {
    await directDocuVisuals(plan, style, args.topic, log);
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8"); // persist so re-runs skip it
    planQuality = assessDocumentaryVisualQuality(plan.shots);
  }
  if (planQuality.grade !== "good") {
    throw new Error(`documotion: editorial release gate rejected plan (${planQuality.blockers.join("; ") || planQuality.reasons.join("; ")})`);
  }
  log(`documotion visual quality: ${planQuality.grade.toUpperCase()} ${planQuality.score}/100 — semantic ${planQuality.semanticScore}/34, coverage ${planQuality.coverageScore}/20, motion ${planQuality.motionScore}/20, story ${planQuality.storyScore}/16, type ${planQuality.typographyScore}/11`);

  // 2. ASSETS (gated, pooled, cached) + GEO geometry for any geo_map shots
  let assets = await imageUsageScope.run(() =>
    generateDocuAssets(plan, style, join(runDir, "assets"), log, undefined, geometry.format),
  );
  const geoByShot: Record<number, CityGeo> = {};
  for (const [i, s] of plan.shots.entries()) {
    if (s.kind === "geo_map" && s.geoQuery) geoByShot[i] = await fetchCityGeo(s.geoQuery, join(runDir, "geo"), log);
  }
  // Quote/type-card text is composed only by Remotion from the exact plan text.
  // Background plates remain text-free assets, so readable lettering is never
  // delegated to an image model (no spelling drift, vision retries, or card-only
  // provider spend). Optional emphasis comes from the already-required plan.

  // 3. NARRATE FIRST — voice each shot's line so the TIMELINE follows the spoken
  //    word (kills the silent-tail bug + locks each visual to its line). Shot
  //    durations below are derived from these VOs; the VO is aligned back on at step 6.
  let shotVOs: ShotVO[] = [];
  let fixedDursSec: number[] | undefined;
  if (args.narrate !== false) {
    shotVOs = await synthShotVOs(plan, runDir, style.label, log, narrationUsage, narrationSpeed, elevenModelId);
    if (shotVOs.length) {
      if (args.lockShotDurations) {
        fixedDursSec = plan.shots.map((shot) => shot.durationSec);
        const overrun = shotVOs.find((voice) =>
          voice.durSec + NARR.lead + NARR.tail > (fixedDursSec?.[voice.idx] ?? 0) + 0.05,
        );
        if (overrun) {
          throw new Error(
            `documotion: locked beat ${overrun.idx + 1} cannot contain its narration ` +
            `(${overrun.durSec.toFixed(2)}s voice exceeds ${(fixedDursSec[overrun.idx] ?? 0).toFixed(2)}s visual window).`,
          );
        }
        log("documotion: locked strategy beat windows retained after narration timing check");
      } else {
        fixedDursSec = narrationDurations(plan, shotVOs, durationSec / Math.max(1, plan.shots.length));
      }
    }
  }

  // 4. VERIFY & REFINE on fast stills
  const overridesPath = join(runDir, "overrides.json");
  let overrides: DocuOverrides = existsSync(overridesPath) ? (JSON.parse(await readFile(overridesPath, "utf8")) as DocuOverrides) : {};
  let verdict: DocuVerdict = {};
  let rounds = 0;
  for (let round = 1; round <= maxRounds + 1; round++) {
    const specs = await buildShotSpecs(plan, assets, durationSec, overrides, geoByShot, fixedDursSec);
    const { framePaths, labels } = await renderVerifySet({ plan, specs, style, geometry, framesDir: join(runDir, `verify_r${round}`), log });
    verdict = await verifyDocu({ framePaths, labels, worldHint: style.label, log });
    rounds = round;
    if (verdict.pass || round > maxRounds || !verdict.actions?.length) break;
    const applied = applyActions(verdict.actions, overrides, log);
    overrides = applied.overrides;
    await writeFile(overridesPath, JSON.stringify(overrides, null, 2), "utf8");
    if (Object.keys(applied.assetFixes).length) {
      assets = await imageUsageScope.run(() =>
        generateDocuAssets(plan, style, join(runDir, "assets"), log, applied.assetFixes, geometry.format),
      );
    }
  }
  if (!verdict.pass) {
    throw new Error(`documotion: final visual verifier rejected render after ${rounds} rounds (${verdict.note ?? "no actionable repair accepted"})`);
  }

  // 5. FINAL 1080p master (narration-driven durations)
  const specs = await buildShotSpecs(plan, assets, durationSec, overrides, geoByShot, fixedDursSec);
  const outPath = args.outPath ?? join(runDir, "final.mp4");
  await renderDocuMotion({
    shots: specs,
    outPath,
    width: geometry.width,
    height: geometry.height,
    layout: geometry.layout,
    theme: style.theme,
    fontCss: style.fontCss,
    fontProbe: style.fontProbe,
    // Cap concurrency (env override) — geo_map/parallax frames are RAM-heavy at
    // 1080p and the default (half-cores) can OOM a shared box.
    concurrency: args.concurrency ?? (process.env.DOCU_RENDER_CONCURRENCY ? Number(process.env.DOCU_RENDER_CONCURRENCY) : 3),
    log,
  });
  log(`documotion: final rendered ${outPath}`);

  // 6. ALIGN VO + MUSIC + VALIDATE — bed the per-shot VOs back on the render
  //    (picture matches the words), duck a quiet music bed under them, then FAIL
  //    unless the audio COVERS the timeline AND the narration DOMINATES the bed.
  let deliverPath = outPath;
  let generatedMusicTracks = 0;
  let audio: { audioOk: boolean; meanVolumeDb: number; coverage: number; dialogueLeadDb: number | null } = { audioOk: true, meanVolumeDb: 0, coverage: 1, dialogueLeadDb: null };
  if (args.narrate !== false && shotVOs.length && fixedDursSec) {
    const hadMusic = Boolean(process.env.SUNO_API_KEY || process.env.MUREKA_API_KEY);
    const assembly = await assembleNarration({
      videoPath: outPath,
      runDir,
      shotVOs,
      shotDursSec: fixedDursSec,
      plan,
      log,
    });
    deliverPath = assembly.path;
    generatedMusicTracks = assembly.musicTracks;
    const rendered = fixedDursSec.map((d) => Math.round(d * FPS) / FPS);
    const totalSec = rendered.reduce((a, d) => a + d, 0);
    // sample a VO window (inside shot 0's line) and a music-only GAP window (shot 0's tail breath)
    const vo0 = shotVOs[0].durSec;
    const dominance = { voStartSec: NARR.lead + 0.6, gapStartSec: NARR.lead + vo0 + 0.15, hasMusic: hadMusic };
    audio = await validateAudioCoverage(deliverPath, totalSec, log, dominance);
    if (!audio.audioOk) {
      const buried = audio.dialogueLeadDb !== null && audio.dialogueLeadDb < MIX.minDialogueLeadDb;
      throw new Error(
        `documotion: OUTPUT VALIDATION FAILED — ${buried ? `narration is BURIED under the music (dialogue lead only ${audio.dialogueLeadDb?.toFixed(1)} dB, need ≥${MIX.minDialogueLeadDb})` : `audio does not cover the video (mean ${audio.meanVolumeDb} dB, coverage ${(audio.coverage * 100).toFixed(0)}%)`}. The narration must be the clear foreground throughout.`,
      );
    }
  }
  const imageUsage = imageUsageScope.snapshot();
  const modelUsage = modelUsageScope.snapshot();
  const narrationCostUsd = narrationTtsCost(
    narrationUsage.provider,
    narrationUsage.billableCharacters,
    0,
  );
  const musicCostUsd = generatedMusicTracks * PRICE.musicTrackUsd;
  return {
    outPath: deliverPath,
    plan,
    verdict: { ...verdict, audioOk: audio.audioOk, meanVolumeDb: audio.meanVolumeDb },
    rounds,
    geometry,
    shotDurationsSec: fixedDursSec ?? plan.shots.map((shot) => shot.durationSec),
    assetReceipts: assets.map((asset) => ({
      shotIdx: asset.shotIdx,
      rendererAssetId: asset.id,
      role: asset.role,
      approvalSha256: asset.approvalSha256,
    })),
    usage: {
      model: modelUsage,
      image: imageUsage,
      narration: {
        provider: narrationUsage.provider,
        billableCharacters: narrationUsage.billableCharacters,
        costUsd: narrationCostUsd,
      },
      music: { generatedTracks: generatedMusicTracks, costUsd: musicCostUsd },
      totalCostUsd: modelUsage.costUsd + imageUsage.costUsd + narrationCostUsd + musicCostUsd,
    },
    quality: planQuality,
  };
  });
}
