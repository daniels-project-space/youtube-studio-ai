/**
 * ffmpegBackend — the REAL `RenderBackend` for the standalone Assembly module.
 *
 * This is the single swappable integration adapter renderTimeline() executes
 * through. It is a THIN wrapper: every method maps onto an already-shipped,
 * battle-tested primitive (the same ones the live `timeline_assemble` god-block
 * calls) — assembleBeatBody / assembleStructuredBody / composeWithIntro /
 * patchSegment / probe from ffmpeg.ts, renderTitleCard from remotionRender.ts,
 * and R2 put/get from storage.ts. Source strings (R2 key / url / local path) are
 * resolved to local files by SourceResolver before any ffmpeg invocation.
 *
 * ADDITIVE ONLY — nothing in the live pipeline imports this. It is wired in by
 * the smoke test (scripts/assembly-smoke.ts) and, later, the real channel run.
 *
 * OVERLAY BURN-IN (ported from the god-block's finishFromComposed pass):
 *   applyOverlays maps the EDL Overlay[] via overlaysToCuesAndSpecs → writes the
 *   caption .ass → single-pass applyOverlaysAndCaptions(base, specs, ass, …,
 *   {blurSigma:20}), with the proven sequential fallback (burnCaptions then
 *   applyQuoteOverlays) on any failure. Mapping drops (a text-less caption, a
 *   quote/insert with no renderable media) surface as warnings, never silent.
 *
 * STILL NEEDS A REAL RENDER (flagged honestly, never faked):
 *   - quote/insert media: the alpha card must be a Remotion-rendered .webm/.mov.
 *     overlaysToCuesAndSpecs warns + skips any spec lacking a media path; we do
 *     NOT invent one. Captions are pure ffmpeg (libass) → hermetically provable.
 *   - reframe "subject_track": v1 falls back to a center-crop + a warning that
 *     true subject tracking is pending.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile as writeFileP } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assembleBeatBody,
  assembleStructuredBody,
  composeWithIntro,
  patchSegment,
  probe as ffprobe,
  applyOverlaysAndCaptions,
  applyQuoteOverlays,
  burnCaptions,
  writeCaptionsAss,
  makeVerticalClip,
} from "@/lib/ffmpeg";
import { renderTitleCard } from "@/lib/remotionRender";
import { getObjectBytes, putObject } from "@/lib/storage";
import { makeRunTempDir, writeBytes, readBytes } from "@/lib/files";
import { execFile } from "node:child_process";
import type { CardSpec, RenderBackend } from "./renderTimeline";
import type { Format, Overlay, Segment } from "./timeline";
import { SourceResolver } from "./__fetch";
import { overlaysToCuesAndSpecs } from "./overlays";

export interface FfmpegBackendOpts {
  /** Run id — namespaces the published artifact. */
  runId: string;
  /** R2 key prefix for the cache + published outputs (e.g. "assembly/" or "smoke/"). */
  keyPrefix: string;
  /** Pre-made temp dir; one is created lazily if omitted. */
  tmpDir?: string;
  /**
   * Local cache root used as a FALLBACK when R2 is unreachable (no R2_* env).
   * Detected at runtime; lets the hermetic smoke run with no storage creds.
   */
  localFallbackDir?: string;
}

const isCard = (s: Segment): s is Extract<Segment, { kind: "card" }> => s.kind === "card";

/** Map a Timeline card durSec list to a sensible per-clip window cap. */
function maxSegFrom(segs: Segment[], fallback: number): number {
  const durs = segs.filter((s) => s.kind !== "card").map((s) => s.durSec).filter((d) => d > 0);
  return durs.length ? Math.max(fallback, Math.ceil(Math.max(...durs))) : fallback;
}

export function createFfmpegBackend(opts: FfmpegBackendOpts): RenderBackend {
  let tmpDirPromise: Promise<string> | null = opts.tmpDir ? Promise.resolve(opts.tmpDir) : null;
  const getTmp = async (): Promise<string> => {
    if (!tmpDirPromise) tmpDirPromise = makeRunTempDir(opts.runId);
    return tmpDirPromise;
  };
  let resolver: SourceResolver | null = null;
  const getResolver = async (): Promise<SourceResolver> => {
    if (!resolver) resolver = new SourceResolver(await getTmp());
    return resolver;
  };

  // counter for unique intermediate filenames
  let nonce = 0;
  const out = async (suffix: string): Promise<string> => join(await getTmp(), `bk_${opts.runId}_${nonce++}_${suffix}`);

  const fmtWH = (fmt: Format) => ({ width: fmt.w, height: fmt.h, fps: fmt.fps });

  return {
    async renderCard(card: CardSpec, fmt: Format): Promise<string> {
      let bgImagePath: string | undefined;
      if (card.bgSrc) {
        try {
          bgImagePath = await (await getResolver()).resolve(card.bgSrc);
        } catch (e) {
          console.warn(`renderCard: bg fetch failed (${card.bgSrc}) — plain card: ${(e as Error).message}`);
        }
      }
      const outPath = await out(`card_${card.role}.mp4`);
      return renderTitleCard({
        title: card.title ?? "",
        subtitle: card.subtitle,
        bgImagePath,
        durationSec: card.durSec,
        width: fmt.w,
        height: fmt.h,
        outro: card.role === "outro",
        chapter: card.role === "chapter",
        outPath,
      });
    },

    async buildBody(middle: Segment[], { targetSec, fmt }): Promise<string> {
      const resolverInst = await getResolver();
      const outPath = await out("body.mp4");
      const maxSegSec = maxSegFrom(middle, 10);

      const hasChapterCard = middle.some(isCard);
      // Clip sources IN ORDER, paired with their PLANNED durations so the plan's
      // per-segment edit decisions (pacing curve, cutEnergy) survive rendering —
      // src and durSec must stay index-aligned. Repeated srcs resolve to the same
      // local file exactly once (SourceResolver is content-addressed per src).
      const clipSegs = middle
        .filter((s) => !isCard(s))
        .map((s) => s as Extract<Segment, { kind: "footage" }>)
        .filter((s) => Boolean(s.src));
      const localClips = await resolverInst.resolveAll(clipSegs.map((s) => s.src));
      const segDurationsSec = clipSegs.map((s) => s.durSec);

      if (hasChapterCard) {
        // Structured (chapter) body: render each chapter card to a clip, then
        // hand windows (card + footage, IN ORDER) to assembleStructuredBody.
        const windows: { kind: "footage" | "card"; durSec: number; cardPath?: string }[] = [];
        for (const seg of middle) {
          if (isCard(seg)) {
            const cardPath = await this.renderCard(
              { role: "chapter", title: seg.title, subtitle: seg.subtitle, bgSrc: seg.bgSrc, durSec: seg.durSec },
              fmt,
            );
            windows.push({ kind: "card", durSec: seg.durSec, cardPath });
          } else {
            windows.push({ kind: "footage", durSec: seg.durSec });
          }
        }
        return assembleStructuredBody({
          windows,
          clipPaths: localClips,
          outPath,
          tmpDir: await getTmp(),
          width: fmt.w,
          height: fmt.h,
          fps: fmt.fps,
          maxSegSec,
        });
      }

      // Beat body: cut each entry at its PLANNED durSec (≤ its real length) to
      // cover targetSec — the Timeline's cadence is rendered, not re-decided.
      return assembleBeatBody({
        clipPaths: localClips,
        outPath,
        targetSec,
        tmpDir: await getTmp(),
        maxSegSec,
        segDurationsSec,
        width: fmt.w,
        height: fmt.h,
        fps: fmt.fps,
      });
    },

    async composeIntro(args): Promise<string> {
      const resolverInst = await getResolver();
      const outPath = await out("composed.mp4");
      // composeWithIntro requires a music track. If none is planned, synthesize a
      // silent bed so the duck/fade graph still runs (honest: no music = silence).
      let musicPath: string;
      if (args.musicSrc) {
        musicPath = await resolverInst.resolve(args.musicSrc);
      } else {
        musicPath = await out("silence.m4a");
        const total = args.introSec + args.bodySec + args.tailSec + 2;
        await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
          "-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-t", total.toFixed(3), "-c:a", "aac", "-b:a", "128k", musicPath,
        ]);
      }
      let narrationPath = args.narrationSrc ? await resolverInst.resolve(args.narrationSrc) : undefined;

      // Editor silence-trim: concat only the KEEP ranges (the complement is dead air).
      // `aselect` keeps the union of [start,end] windows; `asetpts` repacks timestamps so
      // the output is gapless. bodySec already reflects this trimmed length (planTimeline).
      if (narrationPath && args.narrationKeepRanges && args.narrationKeepRanges.length > 0) {
        const expr = args.narrationKeepRanges
          .map((r) => `between(t,${r.startSec.toFixed(3)},${r.endSec.toFixed(3)})`)
          .join("+");
        const trimmedPath = await out("narration_trimmed.m4a");
        await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
          "-y", "-i", narrationPath,
          "-af", `aselect='${expr}',asetpts=N/SR/TB`,
          "-c:a", "aac", "-b:a", "192k", trimmedPath,
        ]);
        narrationPath = trimmedPath;
      }

      // dip_to_black is NOT a dissolve: compose with a HARD cut at the title→body
      // boundary (crossfadeSec 0), then a dedicated post pass fades DOWN to black
      // and back UP across that boundary — a real, visible difference from the
      // xfade crossfade. (crossfade/hardcut keep composeWithIntro's xfade/cut.)
      const isDip = args.transition === "dip_to_black";
      const composedPath = await composeWithIntro({
        introCardPath: args.introCardPath,
        loopBodyPath: args.bodyPath,
        musicPath,
        narrationPath,
        outPath,
        introSec: args.introSec,
        bodySec: args.bodySec,
        tailSec: args.tailSec,
        fadeOutSec: args.fadeOutSec,
        audioFadeOutSec: args.audioFadeOutSec,
        width: args.fmt.w,
        height: args.fmt.h,
        introMusicVol: args.introMusicVol,
        bodyMusicVol: args.bodyMusicVol,
        musicDuckRampSec: args.musicDuckRampSec,
        // hardcut ⇒ 0 (composeWithIntro treats 0 as a hard cut); crossfade ⇒ 0.8s.
        // dip_to_black ⇒ 0 here (we render the dip ourselves below, post-compose).
        ...(isDip ? { crossfadeSec: 0 } : typeof args.crossfadeSec === "number" ? { crossfadeSec: args.crossfadeSec } : {}),
      });

      if (!isDip) return composedPath;

      // ----- dip_to_black post pass -----
      // Fade the VIDEO down to black ending at the boundary, then up from black after
      // it. Boundary = introSec when there's a title card, else a short dip at t=0.
      const dipSec = Math.min(0.6, Math.max(0.3, (args.crossfadeSec ?? 0.8) / 2));
      const boundary = args.introCardPath ? Math.max(0, args.introSec) : dipSec;
      const dipOut = await out("dipped.mp4");
      const fadeOutSt = Math.max(0, boundary - dipSec).toFixed(3);
      const fadeInSt = boundary.toFixed(3);
      const vf = `fade=t=out:st=${fadeOutSt}:d=${dipSec.toFixed(3)}:color=black,fade=t=in:st=${fadeInSt}:d=${dipSec.toFixed(3)}:color=black`;
      await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
        "-y", "-i", composedPath,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart",
        dipOut,
      ]);
      return dipOut;
    },

    async patchOutro(basePath, outroCardPath, startSec, durSec, fmt): Promise<string> {
      const outPath = await out("patched.mp4");
      return patchSegment(basePath, outroCardPath, startSec, durSec, outPath, {
        ...fmtWH(fmt),
        fadeInSec: 1.2,
      });
    },

    async applyOverlays(basePath: string, overlays: Overlay[], fmt: Format, ovOpts?: { captionStyle?: CaptionStyle }) {
      if (overlays.length === 0) return { path: basePath, applied: 0, warnings: [] };

      // EDL → the two god-block primitives (cues + alpha specs). Drops (text-less
      // caption / media-less quote/insert) come back as warnings — never silent.
      const mapped = overlaysToCuesAndSpecs(overlays);
      let cues = mapped.cues;
      const { specs, warnings } = mapped;

      // captionStyle === "none" ⇒ suppress the caption burn entirely (quote/insert
      // alpha specs still composite). Surface as a warning so it's never silent.
      const captionStyle: CaptionStyle = ovOpts?.captionStyle ?? "default";
      if (captionStyle === "none" && cues.length > 0) {
        warnings.push(`captionStyle=none — ${cues.length} caption(s) suppressed (not burned)`);
        cues = [];
      }

      if (cues.length === 0 && specs.length === 0) {
        // Everything was dropped; nothing to burn. Surface why (don't fake a pass).
        return { path: basePath, applied: 0, warnings };
      }

      const tmp = await getTmp();
      const W = fmt.w;
      const H = fmt.h;
      // Caption .ass (null when no cues). When a NON-default captionStyle is set we
      // write our OWN styled header (size / outline / active-word colour / position)
      // — proving the style actually changes the render; otherwise fall back to the
      // shared writeCaptionsAss (back-compatible default look).
      const assPath =
        cues.length === 0
          ? null
          : captionStyle === "default"
            ? await writeCaptionsAss(cues, tmp, { width: W, height: H })
            : await writeStyledCaptionsAss(cues, tmp, { width: W, height: H, style: captionStyle });
      const outPath = await out("finished.mp4");

      try {
        // SINGLE-PASS: captions (ass) + every alpha spec in one filter graph / encode.
        await applyOverlaysAndCaptions(basePath, specs, assPath, outPath, { blurSigma: 20 });
        return { path: outPath, applied: cues.length + specs.length, warnings };
      } catch (e) {
        // PROVEN sequential fallback: burn captions, then composite specs.
        warnings.push(
          `single-pass overlay finish failed — sequential fallback: ${(e as Error).message}`,
        );
        try {
          let base = basePath;
          if (cues.length > 0) {
            const capPath = await out("captioned.mp4");
            // Honor the styled ASS in the fallback too: burn it directly when we
            // wrote a custom (non-default) header; otherwise use the proven helper.
            if (assPath && captionStyle !== "default") {
              await burnAssFile(base, assPath, capPath);
            } else {
              await burnCaptions(base, cues, capPath, { tmpDir: tmp, width: W, height: H });
            }
            base = capPath;
          }
          if (specs.length > 0) {
            const quotesPath = await out("quotes.mp4");
            await applyQuoteOverlays(base, specs, quotesPath, { blurSigma: 20 });
            base = quotesPath;
          }
          return { path: base, applied: cues.length + specs.length, warnings };
        } catch (e2) {
          // Loud: keep the clean (pre-overlay) video, report the failure as a warning.
          warnings.push(`overlay compositing FAILED (clean video kept): ${(e2 as Error).message}`);
          return { path: basePath, applied: 0, warnings };
        }
      }
    },

    async reframe(basePath: string, fmt: Format, strategy: string) {
      // Portrait repurpose. v1 = scale-to-cover + center-crop to the target canvas
      // (makeVerticalClip, the same primitive the Shorts spinoff uses). "subject_track"
      // is NOT yet implemented — it center-crops AND warns that true tracking is pending.
      const warnings: string[] = [];
      const durationSec = (await ffprobe(basePath)).durationSec;
      const outPath = await out("reframed.mp4");
      await makeVerticalClip(basePath, outPath, {
        startSec: 0,
        durSec: Math.max(1, durationSec),
        width: fmt.w,
        height: fmt.h,
      });
      if (strategy === "subject_track") {
        warnings.push("reframe: subject_track not yet implemented — center-cropped (true subject tracking pending)");
      }
      return { path: outPath, warnings };
    },

    async normalizeLoudness(basePath: string, lufs: number) {
      // Single-pass EBU R128 loudnorm to the integrated target. TP=-1.5 (true-peak
      // ceiling) + LRA=11 match masterAudio's broadcast recipe; we clamp the target
      // to the same sane window. VIDEO is stream-copied (audio-only re-encode), so
      // this is cheap and never re-transcodes the picture.
      const warnings: string[] = [];
      const target = Math.max(-24, Math.min(-9, lufs));
      if (target !== lufs) warnings.push(`normalizeLoudness: targetLufs ${lufs} clamped to ${target} (sane [-24,-9] window)`);
      const outPath = await out("loudnorm.mp4");
      await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
        "-y", "-i", basePath,
        "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11`,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "256k", "-ar", "44100",
        "-movflags", "+faststart",
        outPath,
      ]);
      return { path: outPath, warnings };
    },

    async probe(path: string): Promise<number> {
      return (await ffprobe(path)).durationSec;
    },

    async cacheGet(key: string): Promise<string | null> {
      const fullKey = opts.keyPrefix + key;
      const dest = join(await getTmp(), `cache_${key.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      // R2 first; fall back to a local cache dir when storage is unreachable.
      try {
        const bytes = await getObjectBytes(fullKey);
        await writeBytes(dest, bytes);
        return dest;
      } catch (e) {
        if (isMissingR2Env(e)) {
          const local = localCachePath(opts, fullKey);
          if (existsSync(local)) {
            await copyFile(local, dest);
            return dest;
          }
          return null;
        }
        // genuine 404 / NoSuchKey ⇒ cache miss (not an error). Anything ELSE
        // (auth, network, timeout) is still treated as a miss — a cache must
        // never fail a render — but LOUDLY: silently eating a transient R2
        // outage here disables idempotency with zero trace (and cachePut later
        // rethrows the same error class, so the run fails late instead).
        const msg = (e as Error)?.message ?? String(e);
        if (!/NoSuchKey|not found|404/i.test(msg)) {
          console.warn(`cacheGet(${fullKey}): non-404 storage error treated as cache miss: ${msg.slice(0, 200)}`);
        }
        return null;
      }
    },

    async cachePut(key: string, localPath: string): Promise<void> {
      const fullKey = opts.keyPrefix + key;
      try {
        await putObject(fullKey, await readBytes(localPath), { contentType: "video/mp4" });
      } catch (e) {
        if (isMissingR2Env(e)) {
          const local = localCachePath(opts, fullKey);
          await mkdir(dirname(local), { recursive: true });
          await copyFile(localPath, local);
          return;
        }
        throw e;
      }
    },

    async publish(localPath: string): Promise<string> {
      // "final.mp4" — parity with the god-block's videoKey AND the cleanup
      // block's keep-list (["final.mp4","thumbnail.jpg"]): the old
      // "assembled.mp4" would have been DELETED by cleanup after upload,
      // leaving the library's videoKey dangling.
      const key = `${opts.keyPrefix}runs/${opts.runId}/final.mp4`;
      try {
        await putObject(key, await readBytes(localPath), { contentType: "video/mp4" });
      } catch (e) {
        if (isMissingR2Env(e)) {
          const local = localCachePath(opts, key);
          await mkdir(dirname(local), { recursive: true });
          await copyFile(localPath, local);
          console.warn(`publish: R2 unreachable — wrote locally to ${local} (key=${key})`);
          return key;
        }
        throw e;
      }
      return key;
    },
  };
}

/** Promisified ffmpeg spawn for the silent-bed synthesis (run() is not exported). */
function execFileP(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Caption styling intent (renderHints.captionStyle) + the internal "default" look. */
type CaptionStyle = "default" | "none" | "minimal" | "karaoke" | "bold";

/** A burnable caption window (mirrors ffmpeg.ts CaptionCue — kept local, not exported). */
interface OvCue { startSec: number; endSec: number; text: string }

/** ASS timestamp H:MM:SS.cc (local copy — ffmpeg.ts's assTs is module-private). */
function assTsLocal(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cc = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(Math.min(99, cc)).padStart(2, "0")}`;
}
const assTextLocal = (t: string) => t.replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();

/**
 * Per-style ASS V4+ style line + optional inline override. Colours are &HAABBGGRR.
 *   minimal → smaller font, thin outline, lower-key
 *   bold    → large font, heavy outline, top-aligned-bottom (louder presence)
 *   karaoke → mid font + a yellow active-word tint via an inline \c override
 * Returns { styleLine, inline } — inline is prepended to each Dialogue Text.
 */
function styleSpec(style: CaptionStyle, W: number, H: number): { styleLine: string; inline: string } {
  // base proportions (match writeCaptionsAss): font 0.053H, sideM 0.08W, marginV 0.06H
  const side = Math.round(W * 0.08);
  switch (style) {
    case "minimal": {
      const fs = Math.round(H * 0.040);
      const mv = Math.round(H * 0.05);
      // PrimaryColour slightly translucent white, thin outline (1), no shadow, Bold off.
      return { styleLine: `Style: Cap,DejaVu Sans,${fs},&H10FFFFFF,&H00000000,&H64000000,0,1,1,0,2,${side},${side},${mv},1`, inline: "" };
    }
    case "bold": {
      const fs = Math.round(H * 0.072);
      const mv = Math.round(H * 0.08);
      // Heavy: Bold on, thick outline (5) + shadow (3).
      return { styleLine: `Style: Cap,DejaVu Sans,${fs},&H00FFFFFF,&H00000000,&H96000000,1,1,5,3,2,${side},${side},${mv},1`, inline: "" };
    }
    case "karaoke": {
      const fs = Math.round(H * 0.056);
      const mv = Math.round(H * 0.06);
      // Mid weight + a yellow active-word tint (inline \c&H0000FFFF& = yellow in BGR).
      return { styleLine: `Style: Cap,DejaVu Sans,${fs},&H00FFFFFF,&H00000000,&H64000000,1,1,4,2,2,${side},${side},${mv},1`, inline: "{\\c&H0000FFFF&}" };
    }
    default: {
      const fs = Math.round(H * 0.053);
      const mv = Math.round(H * 0.06);
      return { styleLine: `Style: Cap,DejaVu Sans,${fs},&H00FFFFFF,&H00000000,&H64000000,1,1,4,2,2,${side},${side},${mv},1`, inline: "" };
    }
  }
}

/**
 * Write a STYLED caption .ass (own header) so renderHints.captionStyle actually
 * changes the burn (font size / outline / weight / active-word colour). Proves ≥2
 * styles ⇒ different ffmpeg input. Returns null when there are no cues.
 */
async function writeStyledCaptionsAss(
  cues: OvCue[],
  tmpDir: string,
  opts: { width?: number; height?: number; style: CaptionStyle },
): Promise<string | null> {
  if (cues.length === 0) return null;
  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  const { styleLine, inline } = styleSpec(opts.style, W, H);
  const head =
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `${styleLine}\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const body = cues
    .map((c) => `Dialogue: 0,${assTsLocal(c.startSec)},${assTsLocal(c.endSec)},Cap,,0,0,0,,${inline}${assTextLocal(c.text)}`)
    .join("\n");
  const assPath = join(tmpDir, `captions_${opts.style}.ass`);
  await writeFileP(assPath, head + body + "\n");
  return assPath;
}

/** Burn an already-written .ass onto a video in one ffmpeg pass (styled-fallback path). */
async function burnAssFile(videoPath: string, assPath: string, outPath: string): Promise<void> {
  const p = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
    "-y", "-i", videoPath, "-vf", `ass='${p}'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", outPath,
  ]);
}

/** storage.ts throws "Missing required R2 environment variable: ..." when creds absent. */
function isMissingR2Env(e: unknown): boolean {
  const m = (e as Error)?.message ?? "";
  return /Missing required R2 environment variable/i.test(m);
}

/** Local mirror path for a would-be R2 key (smoke / no-creds fallback). */
function localCachePath(opts: FfmpegBackendOpts, fullKey: string): string {
  const root = opts.localFallbackDir ?? join(opts.tmpDir ?? "/tmp", "assembly-local-cache");
  return join(root, fullKey.replace(/[^a-zA-Z0-9._/-]/g, "_"));
}
