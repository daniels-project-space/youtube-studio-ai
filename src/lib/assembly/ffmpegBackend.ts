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
import { copyFile, mkdir } from "node:fs/promises";
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
      const maxSegSec = maxSegFrom(middle, fmt.fps > 0 ? 10 : 10);

      const hasChapterCard = middle.some(isCard);
      // Distinct clip sources (in order), resolved to local files once.
      const clipSrcs = middle.filter((s) => !isCard(s)).map((s) => (s as Extract<Segment, { kind: "footage" }>).src).filter(Boolean);
      const localClips = await resolverInst.resolveAll(clipSrcs);

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

      // Beat body: walk distinct clips, each ≤ its real length, to cover targetSec.
      return assembleBeatBody({
        clipPaths: localClips,
        outPath,
        targetSec,
        tmpDir: await getTmp(),
        maxSegSec,
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
      const narrationPath = args.narrationSrc ? await resolverInst.resolve(args.narrationSrc) : undefined;

      return composeWithIntro({
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
        // hardcut ⇒ 0 (composeWithIntro treats 0 as a hard cut); crossfade/dip ⇒ 0.8s.
        ...(typeof args.crossfadeSec === "number" ? { crossfadeSec: args.crossfadeSec } : {}),
      });
    },

    async patchOutro(basePath, outroCardPath, startSec, durSec, fmt): Promise<string> {
      const outPath = await out("patched.mp4");
      return patchSegment(basePath, outroCardPath, startSec, durSec, outPath, {
        ...fmtWH(fmt),
        fadeInSec: 1.2,
      });
    },

    async applyOverlays(basePath: string, overlays: Overlay[], fmt: Format) {
      if (overlays.length === 0) return { path: basePath, applied: 0, warnings: [] };

      // EDL → the two god-block primitives (cues + alpha specs). Drops (text-less
      // caption / media-less quote/insert) come back as warnings — never silent.
      const { cues, specs, warnings } = overlaysToCuesAndSpecs(overlays);
      if (cues.length === 0 && specs.length === 0) {
        // Everything was dropped; nothing to burn. Surface why (don't fake a pass).
        return { path: basePath, applied: 0, warnings };
      }

      const tmp = await getTmp();
      const W = fmt.w;
      const H = fmt.h;
      // Caption .ass (null when no cues) — shared by both the single-pass and the
      // sequential fallback, exactly like finishFromComposed.
      const assPath = await writeCaptionsAss(cues, tmp, { width: W, height: H });
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
            await burnCaptions(base, cues, capPath, { tmpDir: tmp, width: W, height: H });
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
        // genuine 404 / NoSuchKey ⇒ cache miss (not an error)
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
      const key = `${opts.keyPrefix}runs/${opts.runId}/assembled.mp4`;
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
