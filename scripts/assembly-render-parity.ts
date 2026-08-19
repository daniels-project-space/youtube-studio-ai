/**
 * assembly-render-parity — the RENDER-LEVEL parity proof for the Assembly CUTOVER.
 *
 *   ./node_modules/.bin/tsx scripts/assembly-render-parity.ts
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/assembly-parity.ts` proves the EDL path reproduces the god-block's
 * deterministic PLAN MATH (durations, cadence, structure). It never renders a
 * frame, so it cannot see a divergence that lives in the COMPOSITION — different
 * ffmpeg arguments, a re-rendered card, a skipped audio pass. This script closes
 * that gap: it renders BOTH paths against ONE set of local fixtures and compares
 * the two actual MP4s.
 *
 * HERMETIC — no Convex, no R2, no paid provider, no network. Fixtures are
 * synthesized with ffmpeg (testsrc2 + sine), exactly like scripts/assembly-smoke.ts.
 * The scenarios that would need Remotion/Chromium are OPT-IN (PARITY_CARDS=1) and
 * clearly reported as excluded when off.
 *
 * THE TWO PATHS
 * -------------
 *   EDL     — the real `assembleViaEdl()` from src/lib/assembly/cutover.ts, i.e.
 *             precisely what `ctx.params.useAssemblyEdl === true` executes
 *             (narratedBlocks.ts:1850-1868).
 *   LEGACY  — `renderLegacyEssay()` below: a faithful in-process TRANSCRIPTION of
 *             the god-block's essay composition sequence (narratedBlocks.ts:1871-2374),
 *             calling the SAME @/lib/ffmpeg primitives with the SAME arguments.
 *             The god-block's `run()` cannot be invoked directly here — it needs a
 *             live StageContext (Convex writes, R2 puts, recordAsset). Only its
 *             I/O shell is omitted; every composition call is byte-for-byte the
 *             god-block's. `assertLegacyReplicaInSync()` fails the run if the
 *             god-block's call sites drift away from this transcription, so the
 *             replica cannot silently rot.
 *
 * WHAT IS COMPARED (beyond plan math)
 * -----------------------------------
 *   container : duration, file size, frame count, WxH, fps, video/audio codec
 *   visual    : whole-video SSIM + PSNR (ffmpeg's own filters), plus per-timestamp
 *               raw-RGB frame MD5s at fixed sample points
 *   audio     : decoded-PCM MD5 + EBU R128 integrated loudness (LUFS)
 *
 * VERDICT POLICY — honesty over a green tick. Divergences are classified:
 *   IDENTICAL  bit-identical / hash-equal
 *   EQUIVALENT within encode tolerance (SSIM >= SSIM_PASS, |Δduration| <= 0.5s)
 *   DIVERGENT  a real difference in output
 * The script EXITS NON-ZERO if any scenario is DIVERGENT. It does NOT tune
 * thresholds to manufacture a pass.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assembleBeatBody,
  composeWithIntro,
  applyOverlaysAndCaptions,
  applyQuoteOverlays,
  burnCaptions,
  writeCaptionsAss,
  captionCuesFromTimings,
  normalizeAudioOnly,
  type QuoteOverlaySpec,
} from "@/lib/ffmpeg";
import { renderTitleCard } from "@/lib/remotionRender";
import { bodySegSeconds, planTimeline } from "@/lib/assembly/planTimeline";
import { getCutSheet } from "@/engine/creative/brief";
import { assembleViaEdl, buildPlanInput, paramsToAssemble } from "@/lib/assembly/cutover";
import type { Segment } from "@/lib/assembly/timeline";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN ?? "ffprobe";

/** SSIM at/above this counts as "equivalent within encode noise". */
const SSIM_PASS = 0.98;
/**
 * PSNR at/above this (dB) counts as visually lossless. BOTH SSIM and PSNR must
 * pass before a differing frame/file hash is forgiven as encoder nondeterminism:
 * SSIM alone is far too permissive on structurally self-similar footage (a
 * testsrc2 pattern scores ~0.99 against a DIFFERENT testsrc2 clip).
 */
const PSNR_PASS = 40;
/** Duration delta at/below this (seconds) counts as equivalent. */
const DUR_TOL = 0.5;

/* ================================ shell utils ================================ */

function sh(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err
        ? reject(new Error(`${bin} failed: ${(stderr || String(err)).slice(-600)}`))
        : resolve({ stdout: stdout ?? "", stderr: stderr ?? "" }),
    );
  });
}

/** Run ffmpeg tolerating a non-zero exit; we only want the stderr (filter reports). */
function shSoft(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (_e, stdout, stderr) =>
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" }),
    );
  });
}

/* ============================== fixture synthesis ============================ */

/** A visually DISTINCT ~`sec`s clip (unique hue + burned-in index ⇒ frames differ). */
async function makeClip(out: string, sec: number, variant: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi",
    "-i", `testsrc2=size=1280x720:rate=30:duration=${sec}`,
    "-vf",
    `hue=h=${(variant * 37) % 360}:s=1,` +
      `drawtext=text='CLIP ${variant}':fontcolor=white:fontsize=72:x=(w-tw)/2:y=(h-th)/2`,
    "-t", String(sec),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

/** A ~`sec`s tone (stands in for narration / music). */
async function makeAudio(out: string, sec: number, freq: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=44100:duration=${sec}`,
    "-t", String(sec), "-c:a", "aac", "-b:a", "128k", out,
  ]);
  return out;
}

/** A pre-rendered intro title card, as the upstream `intro_card` block would emit. */
async function makeIntroCard(out: string, sec: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi", "-i", `color=c=0x101820:size=1280x720:rate=30:duration=${sec}`,
    "-vf", `drawtext=text='UPSTREAM INTRO CARD':fontcolor=white:fontsize=56:x=(w-tw)/2:y=(h-th)/2`,
    "-t", String(sec),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

/* ================================ measurement ================================ */

interface Meta {
  durationSec: number;
  bytes: number;
  frames: number;
  width: number;
  height: number;
  fps: string;
  vcodec: string;
  acodec: string;
}

async function ffprobeMeta(path: string): Promise<Meta> {
  const { stdout } = await sh(FFPROBE, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
  ]);
  const j = JSON.parse(stdout) as {
    streams: Record<string, unknown>[];
    format: Record<string, unknown>;
  };
  const v = j.streams.find((s) => s.codec_type === "video") ?? {};
  const a = j.streams.find((s) => s.codec_type === "audio") ?? {};
  // nb_frames is often absent for mp4 written by libx264 → count packets.
  let frames = Number(v.nb_frames ?? 0);
  if (!frames) {
    const { stdout: cnt } = await sh(FFPROBE, [
      "-v", "error", "-select_streams", "v:0", "-count_packets",
      "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path,
    ]);
    frames = Number(cnt.trim()) || 0;
  }
  return {
    durationSec: Number((j.format as { duration?: string }).duration ?? 0),
    bytes: Number((j.format as { size?: string }).size ?? 0),
    frames,
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    fps: String(v.avg_frame_rate ?? "0/0"),
    vcodec: String(v.codec_name ?? "none"),
    acodec: String(a.codec_name ?? "none"),
  };
}

/** Whole-file MD5 (bit-identity check). */
async function fileMd5(path: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(await readFile(path)).digest("hex");
}

/** MD5 of the decoded raw RGB frame at `t` — visual identity, encoder-agnostic. */
async function frameMd5(path: string, t: number): Promise<string> {
  const { stdout } = await shSoft(FFMPEG, [
    "-v", "error", "-ss", t.toFixed(3), "-i", path,
    "-frames:v", "1", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "md5", "-",
  ]);
  return (stdout.trim().split("=")[1] ?? "n/a").trim();
}

/** MD5 of the decoded PCM audio — audio identity, codec-agnostic. */
async function audioMd5(path: string): Promise<string> {
  const { stdout } = await shSoft(FFMPEG, [
    "-v", "error", "-i", path, "-vn", "-c:a", "pcm_s16le", "-ar", "44100", "-f", "md5", "-",
  ]);
  return (stdout.trim().split("=")[1] ?? "n/a").trim();
}

/** EBU R128 integrated loudness (LUFS) via loudnorm's measurement pass. */
async function integratedLufs(path: string): Promise<number | null> {
  const { stderr } = await shSoft(FFMPEG, [
    "-hide_banner", "-nostats", "-i", path, "-map", "a:0",
    "-filter:a", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "-",
  ]);
  const m = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(stderr);
  return m ? Number(m[1]) : null;
}

/** Whole-video SSIM + PSNR between two files (ffmpeg's own filters). */
async function ssimPsnr(a: string, b: string): Promise<{ ssim: number | null; psnr: number | null }> {
  const { stderr: sOut } = await shSoft(FFMPEG, [
    "-hide_banner", "-nostats", "-i", a, "-i", b,
    "-filter_complex", "[0:v][1:v]ssim", "-f", "null", "-",
  ]);
  const sm = /SSIM .*All:([\d.]+)/.exec(sOut);
  const { stderr: pOut } = await shSoft(FFMPEG, [
    "-hide_banner", "-nostats", "-i", a, "-i", b,
    "-filter_complex", "[0:v][1:v]psnr", "-f", "null", "-",
  ]);
  const pm = /PSNR .*average:([\d.inf]+)/.exec(pOut);
  const psnrRaw = pm ? pm[1] : null;
  return {
    ssim: sm ? Number(sm[1]) : null,
    psnr: psnrRaw === null ? null : psnrRaw === "inf" ? Infinity : Number(psnrRaw),
  };
}

/* ======================= legacy replica drift guard ========================== */

/**
 * The god-block's composition call sites this file transcribes. If narratedBlocks.ts
 * stops containing these EXACT fragments, the transcription below is stale and the
 * comparison would be measuring a fiction — so we fail loudly instead.
 */
const LEGACY_MARKERS: { marker: string; why: string }[] = [
  { marker: "targetSec: narrationSec + tailSec + 3", why: "assembleBeatBody target length" },
  { marker: "maxSegSec: bodyMaxSeg", why: "assembleBeatBody per-clip cap" },
  { marker: "const bodyMaxSeg = bodySegSeconds(narrationSec, cutSheet)", why: "cadence source" },
  { marker: "outroFadeInSec: 1.2", why: "outro fold-in dissolve" },
  { marker: "outroCardPath,", why: "outro folded into composeWithIntro (NOT patched after)" },
  { marker: "await applyOverlaysAndCaptions(composed, allOverlays, assPath, finished, { blurSigma: 20 })", why: "single-pass finish" },
  { marker: 'const target = Number(ctx.params["targetLufs"] ?? -14);', why: "unconditional final loudnorm" },
  { marker: "await normalizeAudioOnly(finalVideo, norm, target)", why: "unconditional final loudnorm" },
  { marker: 'Number(ctx.params["introMusicVol"] ?? 0.513)', why: "music duck levels" },
  { marker: 'Number(ctx.params["bodyMusicVol"] ?? 0.1026)', why: "music duck levels" },
];

async function assertLegacyReplicaInSync(): Promise<void> {
  const src = await readFile(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
  const missing = LEGACY_MARKERS.filter((m) => !src.includes(m.marker));
  if (missing.length > 0) {
    console.error("\nLEGACY REPLICA OUT OF SYNC — narratedBlocks.ts no longer contains:");
    for (const m of missing) console.error(`  - ${m.marker}   (${m.why})`);
    console.error(
      "\nrenderLegacyEssay() below is a transcription of those call sites. Re-sync it before\n" +
        "trusting any parity verdict from this script.",
    );
    throw new Error("legacy replica drift detected");
  }
  console.log(`[guard] legacy replica in sync — all ${LEGACY_MARKERS.length} god-block call-site markers present`);
}

/* ============================ the LEGACY render =============================== */

interface EssayStore {
  footageClips: string[];
  entityClips?: string[];
  narrationLocalPath: string;
  narrationDurationSec: number;
  introCardPath?: string;
  introSec?: number;
  musicKey: string; // a LOCAL path here (see note in main) — same file both paths
  sentenceTimings?: { text: string; start: number; end: number }[];
  cutSheet?: { sections?: { name?: string; cutsPerMin: number }[] };
  /**
   * The god-block reads the outro's closing line from `ctx.store["script"]`
   * (narratedBlocks.ts:2155), and `buildPlanInput` mirrors that exact read
   * (cutover.ts). A top-level `closingLine` key is deliberately NOT supported:
   * it silently titled the legacy outro card "Think it through." while the EDL
   * fell back to "Until next time.", a harness artefact that looked like a
   * product divergence.
   */
  script?: { closingLine?: string };
  channelName?: string;
  quoteOverlays?: QuoteOverlaySpec[];
  insertOverlays?: QuoteOverlaySpec[];
}
type ParamsBag = Record<string, unknown>;

/**
 * Faithful transcription of narratedBlocks.ts::timeline_assemble for the ESSAY
 * path (no authoredManifest, no chapterPlan) + finishFromComposed. Line refs are
 * to narratedBlocks.ts at the commit this file was written against; the drift
 * guard above enforces the call-site fragments.
 *
 * Omitted (I/O shell only, never composition): getObjectBytes/putObject, recordAsset,
 * ctx.log, the surgical-heal branch, and the overlay `materialize()` R2 re-fetch
 * (fixtures are already local, so materialize is an identity map here).
 */
async function renderLegacyEssay(
  store: EssayStore,
  params: ParamsBag,
  tmp: string,
): Promise<{ path: string; composed: string }> {
  // :1871-1890 — interleave entity images amongst the stock b-roll
  const footage = store.footageClips;
  const entity = store.entityClips ?? [];
  const clips: string[] = [];
  const maxn = Math.max(footage.length, entity.length);
  for (let k = 0; k < maxn; k++) {
    if (footage[k]) clips.push(footage[k]);
    if (entity[k]) clips.push(entity[k]);
  }

  // :1891-1930
  const narration = store.narrationLocalPath;
  const narrationSec = Number(store.narrationDurationSec ?? 0) || 60;
  const portrait = (params["aspect"] as string | undefined) === "9:16";
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;
  const introCardPath = store.introCardPath && store.introCardPath.length > 0 ? store.introCardPath : "";
  const introSec = introCardPath ? Number(store.introSec ?? 5) : 0;
  const tailSec = Number(params["tailSec"] ?? 3);
  const fadeOutSec = Number(params["fadeOutSec"] ?? 2);
  const audioFadeOutSec = Number(params["audioFadeOutSec"] ?? fadeOutSec);
  const videoSec = introSec + narrationSec + tailSec;

  // :2034-2041 — beats + editor cutSheet cadence
  const beats = (store.sentenceTimings ?? []).map((s) => s.end);
  const cutSheet = getCutSheet(store as unknown as Record<string, unknown>);
  const bodyMaxSeg = bodySegSeconds(narrationSec, cutSheet);

  // :2117-2131 — beat body (essay path: no chapterPlan, no authoredManifest)
  const concat = await assembleBeatBody({
    clipPaths: clips,
    outPath: join(tmp, "legacy_body.mp4"),
    targetSec: narrationSec + tailSec + 3,
    tmpDir: tmp,
    beats,
    width: W,
    height: H,
    maxSegSec: bodyMaxSeg,
  });

  // :2136-2144 — music bed. The god-block downloads musicKey from R2 to a local
  // file; our fixture IS that local file, so the composition input is identical.
  const musicPath = store.musicKey;

  // :2152-2176 — outro card, rendered BEFORE compose and FOLDED into its graph
  let outroCardPath: string | undefined;
  if (tailSec >= 2) {
    try {
      // :2155-2158 — verbatim: the closing line comes off store.script, and a
      // blank/absent one falls back to the neutral "Until next time."
      const sc = store.script;
      const closing = (sc?.closingLine || "").trim() || "Until next time.";
      const oc = join(tmp, "legacy_outro.mp4");
      await renderTitleCard({
        title: closing,
        subtitle: store.channelName ?? "",
        outPath: oc,
        durationSec: tailSec,
        width: W,
        height: H,
        outro: true,
      });
      outroCardPath = oc;
    } catch (e) {
      console.warn(`[legacy] outro card render failed (plain tail): ${(e as Error).message}`);
    }
  }

  // :2181-2202 — compose
  const out = join(tmp, "legacy_composed.mp4");
  await composeWithIntro({
    introCardPath: introCardPath || undefined,
    loopBodyPath: concat,
    musicPath,
    narrationPath: narration,
    outPath: out,
    introSec,
    bodySec: narrationSec,
    tailSec,
    fadeOutSec,
    audioFadeOutSec,
    width: W,
    height: H,
    introMusicVol: Number(params["introMusicVol"] ?? 0.513),
    bodyMusicVol: Number(params["bodyMusicVol"] ?? 0.1026),
    musicDuckRampSec: Number(params["musicDuckRampSec"] ?? 4),
    outroCardPath,
    outroFadeInSec: 1.2,
  });

  /* ---- finishFromComposed (:2219-2374) ---- */
  const bodyEnd = Math.max(0, videoSec - tailSec);
  // materialize(): fixtures are local, so only the outro-tail clamp/drop applies.
  const materialize = (specs: QuoteOverlaySpec[]): QuoteOverlaySpec[] => {
    const ready: QuoteOverlaySpec[] = [];
    for (const raw of specs) {
      const s = { ...raw };
      if (s.startSec >= bodyEnd - 1) continue;
      if (s.startSec + s.durSec > bodyEnd) s.durSec = Math.max(2, bodyEnd - s.startSec);
      if (!existsSync(s.path)) continue;
      ready.push(s);
    }
    return ready;
  };
  const quotes = materialize(store.quoteOverlays ?? []);
  const inserts = materialize(store.insertOverlays ?? []);

  let assPath: string | null = null;
  let preparedCues: { startSec: number; endSec: number; text: string }[] = [];
  if (params["burnCaptions"] !== false) {
    const capTimings = store.sentenceTimings;
    if (capTimings && capTimings.length > 0) {
      const pad = 0.2;
      const qWindows = quotes.map((q) => [q.startSec - pad, q.startSec + q.durSec + pad] as [number, number]);
      const iWindows = inserts.map((q) => [q.startSec - pad, q.startSec + q.durSec + pad] as [number, number]);
      const blocked = [...qWindows, ...iWindows]; // essay: no chapter cards
      const cues = captionCuesFromTimings(capTimings, introSec).filter(
        (c) => !blocked.some(([a, b]) => c.endSec > a && c.startSec < b),
      );
      preparedCues = cues;
      assPath = await writeCaptionsAss(cues, tmp, { width: W, height: H });
    }
  }

  let finalVideo = out;
  const allOverlays = [...quotes, ...inserts].sort((a, b) => a.startSec - b.startSec);
  if (allOverlays.length > 0 || assPath) {
    const finished = join(tmp, "legacy_finished.mp4");
    try {
      await applyOverlaysAndCaptions(out, allOverlays, assPath, finished, { blurSigma: 20 });
      finalVideo = finished;
    } catch (e) {
      console.warn(`[legacy] single-pass finish failed — sequential fallback: ${(e as Error).message}`);
      let base = out;
      if (preparedCues.length > 0) {
        const capPath = join(tmp, "legacy_captioned.mp4");
        await burnCaptions(base, preparedCues, capPath, { tmpDir: tmp, width: W, height: H });
        base = capPath;
      }
      if (allOverlays.length > 0) {
        const withQuotes = join(tmp, "legacy_quotes.mp4");
        await applyQuoteOverlays(base, allOverlays, withQuotes, { blurSigma: 20 });
        base = withQuotes;
      }
      finalVideo = base;
    }
  }

  // :2366-2374 — UNCONDITIONAL final loudness normalization (fail-soft)
  try {
    const norm = join(tmp, "legacy_norm.mp4");
    const target = Number(params["targetLufs"] ?? -14);
    await normalizeAudioOnly(finalVideo, norm, target);
    finalVideo = norm;
  } catch (e) {
    console.warn(`[legacy] loudnorm skipped (non-fatal): ${(e as Error).message}`);
  }

  return { path: finalVideo, composed: out };
}

/* ================================ scenarios ================================== */

interface Scenario {
  name: string;
  /** Needs Remotion/Chromium (intro card re-render and/or outro card). */
  needsCards: boolean;
  note: string;
  build(fx: Fixtures): { store: EssayStore; params: ParamsBag };
}

interface Fixtures {
  clips: string[];
  narration: string;
  music: string;
  introCard: string;
  narrationSec: number;
}

/** Sentence timings covering the narration at ~5s cadence (drives captions + beats). */
function timings(narrationSec: number): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (let t = 0; t < narrationSec; t += 5) {
    out.push({ text: `Sentence ${out.length + 1} of the essay.`, start: t, end: Math.min(narrationSec, t + 5) });
  }
  return out;
}

const SCENARIOS: Scenario[] = [
  {
    name: "essay-core (cold open, captions ON)",
    needsCards: false,
    note: "Pure ffmpeg both sides: body + compose + caption burn. No Remotion.",
    build: (fx) => ({
      store: {
        footageClips: fx.clips,
        narrationLocalPath: fx.narration,
        narrationDurationSec: fx.narrationSec,
        introCardPath: "", // cold open ⇒ introSec 0 ⇒ no intro card either side
        musicKey: fx.music,
        sentenceTimings: timings(fx.narrationSec),
        cutSheet: { sections: [{ name: "intro", cutsPerMin: 6 }, { name: "body", cutsPerMin: 6 }] },
        // The god-block reads the closing line from store.script.closingLine
        // (narratedBlocks.ts:2155) — NOT a top-level key. Putting it anywhere else
        // makes the two paths title the outro card differently.
        script: { closingLine: "Think it through." },
        channelName: "Investory",
      },
      // tailSec 1 (<2) ⇒ no outro card ⇒ hermetic
      params: { aspect: "16:9", tailSec: 1, burnCaptions: true },
    }),
  },
  {
    name: "essay-core (cold open, captions OFF)",
    needsCards: false,
    note: "Isolates body+compose from the caption burn.",
    build: (fx) => ({
      store: {
        footageClips: fx.clips,
        narrationLocalPath: fx.narration,
        narrationDurationSec: fx.narrationSec,
        introCardPath: "",
        musicKey: fx.music,
        sentenceTimings: timings(fx.narrationSec),
        cutSheet: { sections: [{ name: "intro", cutsPerMin: 6 }, { name: "body", cutsPerMin: 6 }] },
        // The god-block reads the closing line from store.script.closingLine
        // (narratedBlocks.ts:2155) — NOT a top-level key. Putting it anywhere else
        // makes the two paths title the outro card differently.
        script: { closingLine: "Think it through." },
        channelName: "Investory",
      },
      params: { aspect: "16:9", tailSec: 1, burnCaptions: false },
    }),
  },
  {
    name: "essay-full (intro card + outro card)",
    needsCards: true,
    note: "The real essay preset. Needs Remotion/Chromium — opt in with PARITY_CARDS=1.",
    build: (fx) => ({
      store: {
        footageClips: fx.clips,
        narrationLocalPath: fx.narration,
        narrationDurationSec: fx.narrationSec,
        introCardPath: fx.introCard, // an ALREADY-RENDERED upstream card
        introSec: 5,
        musicKey: fx.music,
        sentenceTimings: timings(fx.narrationSec),
        cutSheet: { sections: [{ name: "intro", cutsPerMin: 6 }, { name: "body", cutsPerMin: 6 }] },
        // The god-block reads the closing line from store.script.closingLine
        // (narratedBlocks.ts:2155) — NOT a top-level key. Putting it anywhere else
        // makes the two paths title the outro card differently.
        script: { closingLine: "Think it through." },
        channelName: "Investory",
      },
      params: { aspect: "16:9", tailSec: 3, burnCaptions: true },
    }),
  },
];

/* ================================== compare ================================== */

type Verdict = "IDENTICAL" | "EQUIVALENT" | "DIVERGENT";

interface Row {
  field: string;
  legacy: string;
  edl: string;
  verdict: Verdict;
}

const n2 = (n: number) => n.toFixed(2);

function cmp(field: string, a: string, b: string, ok?: boolean): Row {
  const equal = a === b;
  return { field, legacy: a, edl: b, verdict: equal ? "IDENTICAL" : ok ? "EQUIVALENT" : "DIVERGENT" };
}

async function compare(legacyPath: string, edlPath: string): Promise<{ rows: Row[]; verdict: Verdict }> {
  const [lm, em] = await Promise.all([ffprobeMeta(legacyPath), ffprobeMeta(edlPath)]);
  const [lHash, eHash] = await Promise.all([fileMd5(legacyPath), fileMd5(edlPath)]);
  const [lAudio, eAudio] = await Promise.all([audioMd5(legacyPath), audioMd5(edlPath)]);
  const [lLufs, eLufs] = await Promise.all([integratedLufs(legacyPath), integratedLufs(edlPath)]);
  const { ssim, psnr } = await ssimPsnr(legacyPath, edlPath);

  const durDelta = Math.abs(lm.durationSec - em.durationSec);
  const rows: Row[] = [
    cmp("file md5", lHash.slice(0, 12), eHash.slice(0, 12), false),
    cmp("duration (s)", n2(lm.durationSec), n2(em.durationSec), durDelta <= DUR_TOL),
    cmp("frames", String(lm.frames), String(em.frames), Math.abs(lm.frames - em.frames) <= DUR_TOL * 30),
    cmp("resolution", `${lm.width}x${lm.height}`, `${em.width}x${em.height}`),
    cmp("fps", lm.fps, em.fps),
    cmp("video codec", lm.vcodec, em.vcodec),
    cmp("audio codec", lm.acodec, em.acodec),
    cmp("size (KiB)", n2(lm.bytes / 1024), n2(em.bytes / 1024), true), // encode-noise only
    cmp("audio pcm md5", lAudio.slice(0, 12), eAudio.slice(0, 12), false),
    cmp(
      "integrated LUFS",
      lLufs === null ? "n/a" : n2(lLufs),
      eLufs === null ? "n/a" : n2(eLufs),
      lLufs !== null && eLufs !== null && Math.abs(lLufs - eLufs) <= 1.0,
    ),
    cmp(
      "SSIM (all)",
      "1.000000",
      ssim === null ? "n/a" : ssim.toFixed(6),
      ssim !== null && ssim >= SSIM_PASS,
    ),
    cmp(
      "PSNR (avg dB)",
      "inf",
      psnr === null ? "n/a" : psnr === Infinity ? "inf" : psnr.toFixed(2),
      psnr !== null && (psnr === Infinity || psnr >= 40),
    ),
  ];

  // Sampled raw-RGB frame hashes across the body.
  const sampleAt = [1, Math.round(lm.durationSec * 0.25), Math.round(lm.durationSec * 0.5), Math.round(lm.durationSec * 0.75)]
    .filter((t) => t > 0 && t < Math.min(lm.durationSec, em.durationSec) - 1);
  for (const t of sampleAt) {
    const [lf, ef] = await Promise.all([frameMd5(legacyPath, t), frameMd5(edlPath, t)]);
    rows.push(cmp(`frame md5 @${t}s`, lf.slice(0, 12), ef.slice(0, 12), false));
  }

  // Overall: worst row wins, but a DIVERGENT hash row is downgraded to EQUIVALENT
  // when the perceptual measures say the picture matches (encoder nondeterminism).
  // BOTH SSIM and PSNR must agree — see PSNR_PASS.
  const picMatches = ssim !== null && ssim >= SSIM_PASS && psnr !== null && psnr >= PSNR_PASS;
  const hardDiff = rows.some((r) => {
    if (r.verdict !== "DIVERGENT") return false;
    const soft = r.field === "file md5" || r.field.startsWith("frame md5") || r.field === "audio pcm md5";
    return !(soft && picMatches);
  });
  const allIdentical = rows.every((r) => r.verdict === "IDENTICAL");
  const verdict: Verdict = hardDiff ? "DIVERGENT" : allIdentical ? "IDENTICAL" : "EQUIVALENT";
  return { rows, verdict };
}

/* ============================ divergence diagnostics ========================= */

/**
 * Print the STRUCTURAL deltas between the two paths' composition inputs, so a
 * DIVERGENT verdict names its own root cause instead of leaving a bare hash diff.
 * Pure plan/argument inspection — renders nothing.
 */
async function diagnose(store: EssayStore, params: ParamsBag): Promise<void> {
  const narrationSec = Number(store.narrationDurationSec ?? 0) || 60;
  const tailSec = Number(params["tailSec"] ?? 3);

  const planInput = buildPlanInput(store as unknown as Record<string, unknown>, params);
  const plan = planTimeline(planInput, paramsToAssemble(params));
  const middle = plan.segments.filter(
    (s) => !(s.kind === "card" && (s.role === "intro" || s.role === "outro")),
  );
  const clipSegs = middle.filter((s) => s.kind !== "card") as Extract<Segment, { kind: "footage" }>[];

  // ffmpegBackend.ts::maxSegFrom
  const durs = clipSegs.map((s) => s.durSec).filter((d) => d > 0);
  const edlMaxSeg = durs.length ? Math.max(10, Math.ceil(Math.max(...durs))) : 10;
  const legacyMaxSeg = bodySegSeconds(narrationSec, getCutSheet(store as unknown as Record<string, unknown>));

  const legacyTarget = narrationSec + tailSec + 3; // narratedBlocks.ts:2122
  const plannedCoverage = clipSegs.reduce((a, s) => a + s.durSec, 0);
  // renderTimeline.ts: Math.max(bodySec + tailSec, planned clip coverage). The
  // plan itself carries the anti-loop buffer (planTimeline BODY_BUFFER_SEC), so
  // the render target is derived from the plan rather than recomputed here.
  const edlTarget = Math.max(plan.audio.bodySec + plan.audio.tailSec, plannedCoverage);

  console.log("[diag] body-construction arguments:");
  console.log(
    `[diag]   legacy: targetSec=${legacyTarget}  maxSegSec=${legacyMaxSeg}  segDurationsSec=ABSENT (flat cap)`,
  );
  console.log(
    `[diag]   edl   : targetSec=${edlTarget}  maxSegSec=${edlMaxSeg}  segDurationsSec=PRESENT ` +
      `[${clipSegs.map((s, i) => (i === clipSegs.length - 1 ? "uncapped" : s.durSec.toFixed(1))).join(", ")}]`,
  );
  if (Math.abs(legacyTarget - edlTarget) > 0.01) {
    console.log(
      `[diag]   ⚠ TARGET GAP ${(legacyTarget - edlTarget).toFixed(1)}s — the god-block asks the body for ` +
        `narration+tail+3 (an anti-loop buffer). A body that underruns is LOOPED by composeWithIntro ` +
        `(repeated footage at the tail).`,
    );
  }
  console.log(`[diag]   edl planned clip coverage: ${plannedCoverage.toFixed(1)}s over ${clipSegs.length} segment(s)`);

  if (plan.audio.targetLufs === undefined || plan.audio.targetLufs === null) {
    console.log(
      `[diag]   ⚠ LOUDNESS GAP — plan.audio.targetLufs is undefined, so renderTimeline SKIPS ` +
        `normalizeLoudness (renderTimeline.ts:284). The god-block ALWAYS runs ` +
        `normalizeAudioOnly(ctx.params.targetLufs ?? -14) (narratedBlocks.ts:2366-2374). ` +
        `Root cause: ASSEMBLE_DEFAULTS declares no targetLufs and paramsToAssemble never reads ` +
        `params.targetLufs, so the no-profile EDL path ships un-normalized audio.`,
    );
  }

  // INTRO CARD REUSE — the god-block composites the FILE the upstream `intro_card`
  // block already rendered. The EDL must carry that path on the intro CardSeg
  // (`src`) so the backend reuses it; a plan that only gates on it re-renders a
  // different card through Remotion (wasted render + real picture divergence).
  const introCardSrc = store.introCardPath ?? "";
  if (introCardSrc.length > 0) {
    const introSeg = plan.segments.find((s) => s.kind === "card" && s.role === "intro") as
      | { src?: string }
      | undefined;
    if (!introSeg) {
      console.log(`[diag]   ⚠ INTRO CARD GAP — introCardPath is set but the plan has no intro card segment.`);
    } else if (introSeg.src !== introCardSrc) {
      console.log(
        `[diag]   ⚠ INTRO CARD GAP — the god-block composites the upstream-rendered card FILE ` +
          `(${introCardSrc}), but the plan's intro CardSeg carries src=${introSeg.src ?? "UNSET"} ` +
          `⇒ the renderer will render a DIFFERENT card instead of reusing it.`,
      );
    } else {
      console.log(`[diag]   intro card: REUSED from the upstream render (${introCardSrc})`);
    }
  }

  // OUTRO METHOD — the god-block FOLDS the outro into composeWithIntro's single
  // filter graph (narratedBlocks.ts:2200-2201). A post-hoc patchSegment costs an
  // entire extra full-video x264 pass (and yields non-CFR output). renderTimeline
  // no longer calls patchOutro at all; assert that stays true.
  const outroPlanned = plan.segments.some((s) => s.kind === "card" && s.role === "outro");
  if (outroPlanned) {
    const rt = await readFile("src/lib/assembly/renderTimeline.ts", "utf8");
    if (/await backend\.patchOutro\(/.test(rt)) {
      console.log(
        `[diag]   ⚠ OUTRO METHOD GAP — renderTimeline still calls backend.patchOutro (a second ` +
          `full-video x264 pass). The god-block folds the outro into composeWithIntro instead.`,
      );
    } else {
      console.log(`[diag]   outro: FOLDED into the single composeWithIntro graph (no patch pass)`);
    }
  }
}

/* ==================================== run ==================================== */

async function main(): Promise<void> {
  const withCards = process.env.PARITY_CARDS === "1";
  const narrationSec = Number(process.env.PARITY_NARRATION_SEC ?? 60);

  console.log("=".repeat(78));
  console.log("ASSEMBLY RENDER PARITY — legacy god-block composition vs assembleViaEdl");
  console.log("=".repeat(78));
  console.log(`hermetic: no Convex / no R2 / no provider calls / no network`);
  console.log(`cards (Remotion) scenarios: ${withCards ? "ENABLED (PARITY_CARDS=1)" : "SKIPPED (set PARITY_CARDS=1 to include)"}`);
  console.log(`narration length: ${narrationSec}s\n`);

  await assertLegacyReplicaInSync();

  const tmp = await mkdtemp(join(tmpdir(), "assembly-render-parity-"));
  console.log(`[fx] tmp dir: ${tmp}`);
  console.log("[fx] synthesizing fixtures…");

  // Varied clip lengths so per-segment planned durations actually bite.
  const clipLens = [14, 9, 20, 11, 16, 8, 18, 12, 15, 10, 22, 13];
  const clips = await Promise.all(
    clipLens.map((sec, i) => makeClip(join(tmp, `clip${i}.mp4`), sec, i + 1)),
  );
  const fx: Fixtures = {
    clips,
    narration: await makeAudio(join(tmp, "narration.m4a"), narrationSec, 220),
    music: await makeAudio(join(tmp, "music.m4a"), narrationSec + 30, 110),
    introCard: await makeIntroCard(join(tmp, "introcard.mp4"), 5),
    narrationSec,
  };
  console.log(`[fx] ${clips.length} clips (${clipLens.reduce((a, b) => a + b, 0)}s pool), narration ${narrationSec}s\n`);

  const results: { name: string; verdict: Verdict; rows: Row[]; note: string }[] = [];
  const skipped: { name: string; why: string }[] = [];

  for (const sc of SCENARIOS) {
    if (sc.needsCards && !withCards) {
      skipped.push({ name: sc.name, why: "needs Remotion/Chromium — PARITY_CARDS!=1" });
      continue;
    }
    console.log("-".repeat(78));
    console.log(`SCENARIO: ${sc.name}`);
    console.log(`  ${sc.note}`);
    console.log("-".repeat(78));

    const { store, params } = sc.build(fx);
    const scTmp = await mkdtemp(join(tmp, "sc-"));

    await diagnose(store, params);
    console.log("");

    console.log("[legacy] rendering god-block composition…");
    const legacy = await renderLegacyEssay(store, params, scTmp);
    console.log(`[legacy] → ${legacy.path}`);

    console.log("[edl] rendering assembleViaEdl…");
    const produced = await assembleViaEdl({
      store: { ...store } as unknown as Record<string, unknown>,
      params: { ...params },
      runId: "renderparity",
      keyPrefix: "renderparity/",
      localFallbackDir: join(scTmp, "edl-cache"),
    });
    const edlPath = produced.videoLocalPath;
    if (!edlPath || !existsSync(edlPath)) throw new Error(`EDL produced no local video (${edlPath})`);
    console.log(`[edl] → ${edlPath}`);
    console.log(
      `[edl] produces: durationSec=${n2(produced.videoDurationSec)} captionCues=${produced.captionCues} ` +
        `captionsApplied=${produced.captionsApplied} outroApplied=${produced.outroApplied} ` +
        `overlaysDropped=${produced.overlaysDropped}`,
    );

    const { rows, verdict } = await compare(legacy.path, edlPath);
    console.log("");
    console.log("field                | legacy (god-block)   | EDL (assembleViaEdl) | verdict");
    console.log("---------------------|----------------------|----------------------|-----------");
    for (const r of rows) {
      console.log(
        `${r.field.padEnd(20)} | ${r.legacy.padEnd(20)} | ${r.edl.padEnd(20)} | ${r.verdict}`,
      );
    }
    console.log(`\n  ⇒ ${sc.name}: ${verdict}\n`);
    results.push({ name: sc.name, verdict, rows, note: sc.note });
  }

  console.log("=".repeat(78));
  console.log("SUMMARY");
  console.log("=".repeat(78));
  for (const r of results) console.log(`  ${r.verdict.padEnd(10)}  ${r.name}`);
  for (const s of skipped) console.log(`  SKIPPED     ${s.name}  (${s.why})`);

  const divergent = results.filter((r) => r.verdict === "DIVERGENT");
  if (divergent.length > 0) {
    console.log(`\nRENDER PARITY: NOT PROVEN — ${divergent.length}/${results.length} scenario(s) DIVERGENT.`);
    console.log("The two paths do not produce equivalent rendered output. Divergent fields:");
    for (const d of divergent) {
      const bad = d.rows.filter((r) => r.verdict === "DIVERGENT").map((r) => r.field);
      console.log(`  - ${d.name}: ${bad.join(", ")}`);
    }
    process.exit(1);
  }
  if (results.length === 0) {
    console.log("\nRENDER PARITY: NOTHING RUN — every scenario was skipped.");
    process.exit(1);
  }
  console.log(`\nRENDER PARITY: PROVEN for ${results.length} scenario(s) (SSIM >= ${SSIM_PASS}, |Δdur| <= ${DUR_TOL}s).`);
  if (skipped.length > 0) {
    console.log(`NOTE: ${skipped.length} scenario(s) were SKIPPED and are therefore NOT covered by this proof.`);
  }
}

main().catch((e) => {
  console.error("\n[render-parity] ERROR:", e);
  process.exit(1);
});
