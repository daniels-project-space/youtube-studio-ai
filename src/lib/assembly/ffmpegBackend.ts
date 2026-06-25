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
 * NOT-YET-PORTED (flagged honestly, never faked):
 *   - overlay burn-in (captions/quotes/inserts). applyOverlays returns the base
 *     untouched and surfaces a warning when overlays exist. Parity with the
 *     god-block's finishFromComposed overlay pass is a separate later step.
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
} from "@/lib/ffmpeg";
import { renderTitleCard } from "@/lib/remotionRender";
import { getObjectBytes, putObject } from "@/lib/storage";
import { makeRunTempDir, writeBytes, readBytes } from "@/lib/files";
import { execFile } from "node:child_process";
import type { CardSpec, RenderBackend } from "./renderTimeline";
import type { Format, Overlay, Segment } from "./timeline";
import { SourceResolver } from "./__fetch";

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
      });
    },

    async patchOutro(basePath, outroCardPath, startSec, durSec, fmt): Promise<string> {
      const outPath = await out("patched.mp4");
      return patchSegment(basePath, outroCardPath, startSec, durSec, outPath, {
        ...fmtWH(fmt),
        fadeInSec: 1.2,
      });
    },

    async applyOverlays(basePath: string, overlays: Overlay[], _fmt: Format) {
      if (overlays.length === 0) return { path: basePath, applied: 0, warnings: [] };
      // Overlay burn-in is NOT yet ported from the god-block's finishFromComposed
      // pass. Surface it honestly rather than silently shipping a video missing
      // its captions/quotes/inserts.
      return {
        path: basePath,
        applied: 0,
        warnings: ["overlay burn-in not yet ported from finishFromComposed"],
      };
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
