/**
 * Narrated-archetype text blocks (Stage 3a) — the "brain" shared by essay /
 * crime / shorts / meditation:
 *   script_gen  → script + narrationText   (Gemini)
 *   hook_craft  → hook + narrationText'     (Gemini; prepends a punchy opener)
 *   qa_script   → scriptApproved            (Claude critique; soft gate)
 *
 * All degrade gracefully on a missing key so the pipeline never hard-fails.
 */
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { synthScript } from "@/lib/scriptGen";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { synthNarration, hasFishKey } from "@/lib/tts";
import { searchFootage, hasPexelsKey } from "@/lib/footage";
import { makeRunTempDir, writeBytes, downloadTo, readBytes } from "@/lib/files";
import { putObject, getObjectBytes } from "@/lib/storage";
import { probe, concatScaled, loopUnderAudio, grabFrame } from "@/lib/ffmpeg";
import {
  evaluateVisualFrames,
  evaluateThumbnail,
  evaluateFootage,
  evaluateSeo,
  evaluateIdentity,
  type Verdict,
} from "@/lib/videoVerifier";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`narrated: expected non-empty string store["${key}"]`);
  }
  return v;
}
function opt(ctx: StageContext, key: string): string | undefined {
  const v = ctx.store[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const scriptGen: Block = {
  id: "script_gen",
  consumes: ["topic"],
  produces: ["script", "narrationText"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const script = await synthScript(
      {
        topic,
        channelName: opt(ctx, "channelName"),
        persona: opt(ctx, "persona"),
        styleGrammar: opt(ctx, "styleGrammar"),
        niche: opt(ctx, "niche"),
        style: ctx.params["style"] as string | undefined,
        maxSeconds: ctx.params["maxSeconds"] as number | undefined,
      },
      ctx.log,
    );
    ctx.log(`script_gen: ${script.sections.length} sections, ~${script.estDurationSec}s`);
    return { script, narrationText: script.narrationText };
  },
};

export const hookCraft: Block = {
  id: "hook_craft",
  consumes: ["narrationText"],
  produces: ["hook"],
  run: async (ctx) => {
    // A punchy STANDALONE hook for the title / thumbnail / shorts opener. The
    // spoken narration already opens with script_gen's hook; this does not
    // modify narrationText (single-producer rule).
    const narration = str(ctx, "narrationText");
    const firstLine = () => narration.split(/\n+/)[0].slice(0, 140);
    if (!hasGeminiKey()) return { hook: firstLine() };
    let hook = "";
    try {
      const out = await geminiJson<{ hook?: string }>({
        prompt:
          "Write ONE scroll-stopping hook line for this video (for the title/thumbnail). " +
          'Return STRICT JSON {"hook": string}. No markdown.\n\n' +
          narration.slice(0, 2000),
        maxTokens: 200,
        temperature: 0.9,
      });
      hook = typeof out.hook === "string" ? out.hook.trim() : "";
    } catch (e) {
      ctx.log(`hook_craft: gemini failed (${e instanceof Error ? e.message : e})`);
    }
    if (!hook) hook = firstLine();
    ctx.log(`hook_craft: "${hook.slice(0, 60)}…"`);
    return { hook };
  },
};

export const qaScript: Block = {
  id: "qa_script",
  consumes: ["narrationText"],
  produces: ["scriptApproved"],
  run: async (ctx) => {
    const narration = str(ctx, "narrationText");
    if (!hasAnthropicKey()) {
      ctx.log("qa_script: no Anthropic key — skipping critique (approved)");
      return { scriptApproved: true };
    }
    try {
      const persona = opt(ctx, "persona") ?? "";
      const res = await claudeJson<{ pass?: boolean; issues?: string[] }>({
        prompt:
          `Critique this YouTube narration for quality and on-brand voice` +
          (persona ? ` (channel persona: ${persona})` : "") +
          `. Flag dull sections, off-brand language, factual hedging, or weak structure. ` +
          `Return STRICT JSON {"pass": boolean, "issues": string[]}.\n\n` +
          narration.slice(0, 6000),
        maxTokens: 800,
        temperature: 0.3,
      });
      const issues = Array.isArray(res.issues) ? res.issues : [];
      ctx.log(`qa_script: pass=${res.pass !== false}`, { issues: issues.slice(0, 5) });
      return { scriptApproved: res.pass !== false };
    } catch (e) {
      ctx.log(`qa_script: critique failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      return { scriptApproved: true };
    }
  },
};

export const narrationTts: Block = {
  id: "narration_tts",
  consumes: ["narrationText"],
  produces: ["narrationKey", "narrationDurationSec", "narrationLocalPath"],
  paid: true,
  run: async (ctx) => {
    const text = str(ctx, "narrationText");
    if (!hasFishKey()) {
      throw new Error("narration_tts: FISH_AUDIO_API_KEY missing (vault service 'fish-audio')");
    }
    const voiceId =
      opt(ctx, "voiceId") ?? (ctx.params["voiceId"] as string | undefined);
    const niche = opt(ctx, "niche");
    ctx.log(`narration_tts: synthesizing ${text.length} chars…`);
    const bytes = await synthNarration({ text, voiceId, niche });

    const tmp = await makeRunTempDir(ctx.runId);
    const local = join(tmp, "narration.mp3");
    await writeBytes(local, bytes);
    let durationSec = 0;
    try {
      durationSec = (await probe(local)).durationSec;
    } catch {
      durationSec = Math.round(text.split(/\s+/).length / 2.5);
    }

    const narrationKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
    await putObject(narrationKey, bytes, { contentType: "audio/mpeg" });
    await recordAsset(ctx, "narration", narrationKey, {
      durationSec,
      chars: text.length,
    });
    ctx.log(`narration_tts ok: ${Math.round(bytes.length / 1024)}KB, ${durationSec}s`);
    return {
      narrationKey,
      narrationDurationSec: durationSec,
      narrationLocalPath: local,
      [COST_PATCH_KEY]: (PRICE.ttsPerKCharUsd * text.length) / 1000,
    };
  },
};

export const stockFootage: Block = {
  id: "stock_footage",
  consumes: ["topic", "script"],
  produces: ["footageClips"],
  run: async (ctx) => {
    if (!hasPexelsKey()) {
      throw new Error("stock_footage: PEXELS_API_KEY missing (vault service 'pexels')");
    }
    const topic = str(ctx, "topic");
    const script = ctx.store["script"] as
      | { sections?: { heading?: string }[] }
      | undefined;
    const orientation =
      (ctx.params["aspect"] as string | undefined) === "9:16"
        ? ("portrait" as const)
        : ("landscape" as const);

    // Build search queries from topic + section headings + niche fallback.
    const queries = [
      topic,
      ...(script?.sections ?? []).map((s) => s.heading ?? "").filter(Boolean),
      opt(ctx, "niche") ?? "cinematic background",
    ]
      .map((q) => q.trim())
      .filter(Boolean)
      .filter((q, i, a) => a.indexOf(q) === i)
      .slice(0, 6);

    const tmp = await makeRunTempDir(ctx.runId);
    const clips: string[] = [];
    let n = 0;
    for (const q of queries) {
      try {
        const found = await searchFootage(q, 1, orientation);
        for (const f of found) {
          const local = join(tmp, `footage_${n}.mp4`);
          await downloadTo(f.url, local);
          clips.push(local);
          n++;
        }
      } catch (e) {
        ctx.log(`stock_footage: query "${q}" failed (skip): ${e instanceof Error ? e.message : e}`);
      }
    }
    if (clips.length === 0) {
      throw new Error("stock_footage: no clips found for any query");
    }
    ctx.log(`stock_footage: ${clips.length} clips from ${queries.length} queries`);
    return { footageClips: clips };
  },
};

export const timelineAssemble: Block = {
  id: "timeline_assemble",
  consumes: ["footageClips", "narrationLocalPath", "narrationDurationSec"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec"],
  run: async (ctx) => {
    const footage = ctx.store["footageClips"] as string[] | undefined;
    if (!footage || footage.length === 0) {
      throw new Error("timeline_assemble: no footageClips");
    }
    const narration = str(ctx, "narrationLocalPath");
    const durationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 60;
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;

    const tmp = await makeRunTempDir(ctx.runId);
    ctx.log(`timeline_assemble: concat ${footage.length} clips @ ${W}x${H}…`);
    const concat = await concatScaled(footage, join(tmp, "footage.mp4"), W, H);
    ctx.log(`timeline_assemble: loop under narration (${durationSec}s)…`);
    const out = join(tmp, "video.mp4");
    await loopUnderAudio({
      loopUnitPath: concat,
      audioPath: narration,
      outPath: out,
      durationSec,
      maxHeight: H,
    });

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(out), { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec,
      source: "stock_footage",
      clips: footage.length,
    });
    ctx.log(`timeline_assemble ok: ${durationSec}s`);
    return { videoKey, videoLocalPath: out, videoDurationSec: durationSec };
  },
};

export const lengthCheck: Block = {
  id: "length_check",
  consumes: ["videoDurationSec"],
  produces: ["lengthOk"],
  run: async (ctx) => {
    const dur = Number(ctx.store["videoDurationSec"] ?? 0);
    const min = Number(ctx.params["minSeconds"] ?? 10);
    const max = Number(ctx.params["maxSeconds"] ?? 36000);
    if (dur < min || dur > max) {
      // Hard gate (Stage 4): don't ship an off-spec runtime.
      throw new Error(`length_check FAILED: ${dur}s outside [${min}, ${max}]`);
    }
    ctx.log(`length_check ok: ${dur}s (bounds ${min}–${max})`);
    return { lengthOk: true };
  },
};

export const qaVisual: Block = {
  id: "qa_visual",
  consumes: ["videoLocalPath", "videoDurationSec", "thumbnailKey", "title"],
  produces: ["qaPassed", "qaReport"],
  run: async (ctx) => {
    const video = str(ctx, "videoLocalPath");
    const title = str(ctx, "title");
    const dur = Number(ctx.store["videoDurationSec"] ?? 0);
    const topic = opt(ctx, "topic") ?? title;
    const niche = opt(ctx, "niche");
    const tmp = await makeRunTempDir(ctx.runId);

    // 1) Structural + resolution (hard) — never ship a broken file.
    const p = await probe(video);
    if (!p.hasVideo || !p.hasAudio || p.durationSec < 1) {
      throw new Error(
        `qa_visual FAILED (structural): video=${p.hasVideo} audio=${p.hasAudio} dur=${p.durationSec}s`,
      );
    }
    if ((p.width ?? 0) < 640 || (p.height ?? 0) < 360) {
      throw new Error(`qa_visual FAILED (resolution): ${p.width}x${p.height}`);
    }

    // 2) Script ↔ film length: narration sets the target for narrated archetypes.
    const target = Number(ctx.store["narrationDurationSec"] ?? dur) || dur;
    const ratio = target > 0 ? p.durationSec / target : 1;
    const lengthOk = ratio >= 0.5 && ratio <= 2.0;
    if (!lengthOk) {
      throw new Error(`qa_visual FAILED (length): video ${p.durationSec}s vs target ${target}s`);
    }

    // 3) Video frames (vision, separate).
    const vframes: string[] = [];
    for (const frac of [0.2, 0.5, 0.8]) {
      const f = join(tmp, `qa_v${Math.round(frac * 100)}.jpg`);
      try {
        await grabFrame(video, Math.max(0, dur * frac), f);
        vframes.push(f);
      } catch {
        /* skip frame */
      }
    }
    const video_ = await evaluateVisualFrames(vframes, { topic, niche });

    // 4) Thumbnail (vision, separate) — download from R2.
    let thumbnail: Verdict = { score: 10, issues: [], skipped: true };
    try {
      const tk = opt(ctx, "thumbnailKey");
      if (tk) {
        const tpath = join(tmp, "qa_thumb.jpg");
        await writeBytes(tpath, await getObjectBytes(tk));
        thumbnail = await evaluateThumbnail(tpath, {
          title,
          persona: opt(ctx, "persona"),
          palette: ctx.store["palette"] as string[] | undefined,
        });
      }
    } catch (e) {
      ctx.log(`qa_visual: thumbnail check skipped (${e instanceof Error ? e.message : e})`);
    }

    // 5) Stock-footage appropriateness (vision, separate) — narrated only.
    let footage: Verdict = { score: 10, issues: [], skipped: true };
    const footageClips = ctx.store["footageClips"] as string[] | undefined;
    if (footageClips?.length) {
      const fframes: string[] = [];
      for (let i = 0; i < Math.min(3, footageClips.length); i++) {
        const f = join(tmp, `qa_f${i}.jpg`);
        try {
          await grabFrame(footageClips[i], 1, f);
          fframes.push(f);
        } catch {
          /* skip */
        }
      }
      footage = await evaluateFootage(fframes, { topic, niche });
    }

    // 6) SEO + channel-identity (text, separate).
    const seo = await evaluateSeo({
      title,
      description: opt(ctx, "description"),
      tags: ctx.store["tags"] as string[] | undefined,
      niche,
    });
    const identity = await evaluateIdentity({
      title,
      topic,
      persona: opt(ctx, "persona"),
      niche,
      styleGrammar: opt(ctx, "styleGrammar"),
    });

    // 7) Presence (deterministic): title-card intro + music track.
    const music = { present: Boolean(opt(ctx, "musicKey")) };
    const intro = { applied: ctx.store["introApplied"] === true };

    const report = {
      structural: { ok: true, durationSec: p.durationSec, width: p.width, height: p.height },
      lengthMatch: {
        videoSec: p.durationSec,
        targetSec: target,
        ratio: Number(ratio.toFixed(2)),
        ok: lengthOk,
      },
      video: video_,
      thumbnail,
      footage,
      seo,
      identity,
      music,
      intro,
    };

    // Hard-gate on egregious VISUAL defects; SEO/identity are advisory (logged).
    const critical: string[] = [];
    for (const [name, v] of [
      ["video", video_],
      ["thumbnail", thumbnail],
      ["footage", footage],
    ] as const) {
      if (!v.skipped && v.score < 4) {
        critical.push(`${name} score ${v.score}: ${v.issues.slice(0, 2).join("; ")}`);
      }
    }
    if (critical.length > 0) {
      throw new Error(`qa_visual FAILED: ${critical.join(" | ")} | ${JSON.stringify(report)}`);
    }
    ctx.log("qa_visual PASS (per-artifact)", {
      video: video_.score,
      thumbnail: thumbnail.score,
      footage: footage.skipped ? "n/a" : footage.score,
      seo: seo.score,
      identity: identity.skipped ? "n/a" : identity.score,
      lengthRatio: report.lengthMatch.ratio,
      music: music.present,
      intro: intro.applied,
    });
    return { qaPassed: true, qaReport: report };
  },
};

export const narratedBlocks: Block[] = [
  scriptGen,
  hookCraft,
  qaScript,
  narrationTts,
  stockFootage,
  timelineAssemble,
  lengthCheck,
  qaVisual,
];



