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
import { geminiJson, geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { synthNarration, hasFishKey } from "@/lib/tts";
import { searchFootage, scoreClip, hasPexelsKey } from "@/lib/footage";
import { searchWikimediaImage } from "@/lib/wikimedia";
import { makeRunTempDir, writeBytes, downloadTo, readBytes } from "@/lib/files";
import { putObject, getObjectBytes, publicUrl } from "@/lib/storage";
import {
  hasAssemblyKey,
  transcribeWords,
  wordsToSrt,
  buildChapters,
} from "@/lib/assemblyai";
import { probe, concatScaled, composeWithIntro, grabFrame, kenBurns } from "@/lib/ffmpeg";
import { renderTitleCard } from "@/lib/remotionRender";
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
          `CRITICALLY: require a genuine, specific POINT OF VIEW / original angle — not ` +
          `just narrated facts — and flag generic, formulaic, or templated writing that ` +
          `could read as mass-produced (YouTube demonetizes "inauthentic" content). ` +
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

    // Derive CONCRETE, filmable b-roll queries (abstract topics like philosophy
    // have no literal stock footage — turn them into visual terms a camera can
    // actually show, so the footage is relevant). Falls back to topic+headings.
    let queries: string[] = [];
    if (hasGeminiKey()) {
      try {
        const out = await geminiJson<{ queries?: string[] }>({
          prompt:
            `Give 6 CONCRETE, filmable stock-footage search queries (2-4 words each, ` +
            `things a camera can literally show) that visually evoke a video about ` +
            `"${topic}"${opt(ctx, "niche") ? ` (${opt(ctx, "niche")})` : ""}. ` +
            `Prefer evocative scenes (e.g. "rain on window", "candle flame", ` +
            `"person walking alone dusk", "calm ocean waves"). Avoid abstract words. ` +
            `Return STRICT JSON {"queries":string[]}.`,
          maxTokens: 300,
          temperature: 0.6,
        });
        queries = (out.queries ?? [])
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .slice(0, 6);
      } catch (e) {
        ctx.log(`stock_footage: query-gen failed (${e instanceof Error ? e.message : e})`);
      }
    }
    if (queries.length === 0) {
      queries = [
        topic,
        ...(script?.sections ?? []).map((s) => s.heading ?? "").filter(Boolean),
        opt(ctx, "niche") ?? "cinematic background",
      ]
        .map((q) => q.trim())
        .filter(Boolean)
        .filter((q, i, a) => a.indexOf(q) === i)
        .slice(0, 6);
    }
    ctx.log(`stock_footage: queries = ${queries.join(" | ")}`);

    // Pick the BEST + RELEVANT clip per query (not the first): rank candidates
    // by technical score (v1), dedup across queries, then a Gemini-vision
    // relevance gate rejects off-topic footage. Falls back to the best-scored
    // candidate if none pass (never drop a query → keeps the timeline full).
    const tmp = await makeRunTempDir(ctx.runId);
    const niche = opt(ctx, "niche");
    const relevanceGate = hasGeminiKey();
    const clips: string[] = [];
    const usedUrls = new Set<string>();
    let dl = 0;
    let gated = 0;
    for (const q of queries) {
      try {
        const cands = (await searchFootage(q, 5, orientation))
          .filter((c) => !usedUrls.has(c.url))
          .sort((a, b) => scoreClip(b) - scoreClip(a))
          .slice(0, 3);
        if (cands.length === 0) continue;
        let picked: string | null = null;
        let fallback: string | null = null;
        for (const cand of cands) {
          const local = join(tmp, `footage_${dl++}.mp4`);
          await downloadTo(cand.url, local);
          usedUrls.add(cand.url);
          if (!fallback) fallback = local;
          if (!relevanceGate) {
            picked = local;
            break;
          }
          let ok = true;
          try {
            const frame = `${local}.jpg`;
            await grabFrame(local, 1, frame);
            const raw = await geminiVisionLocal({
              prompt:
                `This is a frame from a stock clip chosen for the query "${q}" in a video about "${topic}"` +
                (niche ? ` (${niche})` : "") +
                `. Is it clearly relevant and on-topic (not random/off-subject)? ` +
                `Return STRICT JSON {"relevant":boolean,"score":0-10}.`,
              imagePaths: [frame],
              json: true,
              maxTokens: 150,
            });
            const v = parseJsonLoose<{ relevant?: boolean; score?: number }>(raw);
            ok = v.relevant !== false && (typeof v.score !== "number" || v.score >= 6);
          } catch {
            ok = true; // vision failed → don't block
          }
          if (ok) {
            picked = local;
            gated++;
            break;
          }
        }
        if (picked) clips.push(picked);
        else if (fallback) {
          clips.push(fallback);
          ctx.log(`stock_footage: no on-topic clip for "${q}" — best-scored fallback`);
        }
      } catch (e) {
        ctx.log(`stock_footage: query "${q}" failed (skip): ${e instanceof Error ? e.message : e}`);
      }
    }
    if (clips.length === 0) {
      throw new Error("stock_footage: no clips found for any query");
    }
    ctx.log(`stock_footage: ${clips.length} clips from ${queries.length} queries (${gated} passed relevance gate, gate=${relevanceGate})`);
    return { footageClips: clips };
  },
};

export const entityImagery: Block = {
  id: "entity_imagery",
  consumes: ["narrationText"],
  produces: ["entityClips", "attributions"],
  run: async (ctx) => {
    const clips: string[] = [];
    const attributions: string[] = []; // license ledger (Wikimedia credits)
    if (!hasGeminiKey()) {
      ctx.log("entity_imagery: no Gemini key — skipping");
      return { entityClips: clips, attributions };
    }
    const narration = str(ctx, "narrationText");
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;

    // Pull SPECIFIC named entities that have real imagery (people/places/artworks).
    let entities: string[] = [];
    try {
      const out = await geminiJson<{ entities?: string[] }>({
        prompt:
          "From this narration, list up to 4 SPECIFIC named entities with well-known " +
          'real photographs/portraits (e.g. "Marcus Aurelius", "the Colosseum"). ' +
          "Skip abstract concepts. Return STRICT JSON {\"entities\":string[]}.\n\n" +
          narration.slice(0, 3000),
        maxTokens: 250,
        temperature: 0.3,
      });
      entities = (out.entities ?? [])
        .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
        .slice(0, 4);
    } catch (e) {
      ctx.log(`entity_imagery: extraction failed (${e instanceof Error ? e.message : e})`);
    }

    const tmp = await makeRunTempDir(ctx.runId);
    let i = 0;
    for (const e of entities) {
      try {
        const wi = await searchWikimediaImage(e);
        if (!wi) {
          ctx.log(`entity_imagery: no Wikimedia image for "${e}"`);
          continue;
        }
        const img = await downloadTo(wi.url, join(tmp, `entity_${i}.jpg`));
        // Verify the Wikimedia image actually depicts the entity (search can
        // return the wrong person/place). Reject mismatches rather than show a
        // wrong face. Verify failure (not mismatch) keeps the image.
        if (hasGeminiKey()) {
          try {
            const raw = await geminiVisionLocal({
              prompt:
                `Does this image clearly depict "${e}"? Be strict about identity for ` +
                `people and specific places. Return STRICT JSON {"match":boolean,"reason":string}.`,
              imagePaths: [img],
              json: true,
              maxTokens: 120,
            });
            const v = parseJsonLoose<{ match?: boolean; reason?: string }>(raw);
            if (v.match === false) {
              ctx.log(`entity_imagery: image for "${e}" did NOT verify (${v.reason ?? ""}) — skipping`);
              continue;
            }
          } catch {
            /* verification failed → keep the image rather than drop the entity */
          }
        }
        const clip = await kenBurns(img, join(tmp, `entity_${i}.mp4`), 5, W, H);
        clips.push(clip);
        if (wi.attribution) attributions.push(`${e}: ${wi.attribution}`);
        ctx.log(`entity_imagery: "${e}" → verified Ken Burns clip`);
        i++;
      } catch (err) {
        ctx.log(`entity_imagery: "${e}" failed (${err instanceof Error ? err.message : err})`);
      }
    }
    ctx.log(`entity_imagery: ${clips.length} entity clip(s), ${attributions.length} attribution(s)`);
    return { entityClips: clips, attributions };
  },
};

export const introCard: Block = {
  id: "intro_card",
  consumes: ["topic"],
  produces: ["introCardPath", "introApplied", "introSec", "introMode"],
  run: async (ctx) => {
    // Universal Remotion title card (cloud-wired): renders the in-app TitleCard
    // composition (src/remotion) in-process via headless Chromium. It is
    // PREPENDED by the assembler so every video opens with a branded card over a
    // music-only intro (no narration yet). Guarded — a render failure degrades to
    // no-card (introApplied:false) and NEVER blocks the video.
    const channelName =
      opt(ctx, "channelName") ??
      (ctx.params["channelName"] as string | undefined) ??
      "Studio";
    const subtitle =
      opt(ctx, "tagline") ?? opt(ctx, "topic") ?? opt(ctx, "niche") ?? "";
    const introSec = Number(ctx.params["introSec"] ?? 5);
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;
    const palette = ctx.store["palette"] as string[] | undefined;
    try {
      const tmp = await makeRunTempDir(ctx.runId);
      const out = join(tmp, "titlecard.mp4");
      await renderTitleCard({
        title: channelName,
        subtitle,
        palette,
        outPath: out,
        durationSec: introSec,
        width: W,
        height: H,
      });
      ctx.log(`intro_card: title card rendered (${introSec}s @ ${W}x${H}, "${channelName}")`);
      return {
        introCardPath: out,
        introApplied: true,
        introSec,
        introMode: "prepend",
      };
    } catch (e) {
      ctx.log(
        `intro_card: !!! title-card render FAILED (${e instanceof Error ? e.message : e}) — continuing without a card`,
      );
      return { introCardPath: "", introApplied: false, introSec: 0, introMode: "none" };
    }
  },
};

export const timelineAssemble: Block = {
  id: "timeline_assemble",
  consumes: [
    "footageClips",
    "entityClips",
    "narrationLocalPath",
    "narrationDurationSec",
    "introCardPath",
    "musicUrl",
  ],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec"],
  run: async (ctx) => {
    const footage = ctx.store["footageClips"] as string[] | undefined;
    if (!footage || footage.length === 0) {
      throw new Error("timeline_assemble: no footageClips");
    }
    // Interleave entity images (Ken Burns) amongst the stock b-roll so named
    // figures (e.g. Marcus Aurelius) appear when relevant.
    const entity = (ctx.store["entityClips"] as string[] | undefined) ?? [];
    const clips: string[] = [];
    const maxn = Math.max(footage.length, entity.length);
    for (let k = 0; k < maxn; k++) {
      if (footage[k]) clips.push(footage[k]);
      if (entity[k]) clips.push(entity[k]);
    }
    const narration = str(ctx, "narrationLocalPath");
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 60;
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;
    // Intro = title card over a music-only opener (no narration yet). Tail = a
    // few silent seconds past the narration, fading to black (clean ending, no
    // end text). So narration time < video time, by design.
    const introCardPath = opt(ctx, "introCardPath"); // "" if the card render failed
    const introSec = introCardPath ? Number(ctx.store["introSec"] ?? 5) : 0;
    const tailSec = Number(ctx.params["tailSec"] ?? 3);
    const fadeOutSec = Number(ctx.params["fadeOutSec"] ?? 2);
    const videoSec = introSec + narrationSec + tailSec;

    const tmp = await makeRunTempDir(ctx.runId);
    ctx.log(`timeline_assemble: concat ${clips.length} clips (${footage.length} footage + ${entity.length} entity) @ ${W}x${H}…`);
    const concat = await concatScaled(clips, join(tmp, "footage.mp4"), W, H);

    // Music bed (full during the intro, ducked low under narration). Downloaded
    // from the music block's provider URL; looped by the composer to length.
    const musicUrl = str(ctx, "musicUrl");
    const musicPath = await downloadTo(musicUrl, join(tmp, "music.mp3"));

    ctx.log(
      `timeline_assemble: compose intro ${introSec}s + narration ${narrationSec}s + ${tailSec}s tail → ${videoSec}s…`,
    );
    const out = join(tmp, "video.mp4");
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
      width: W,
      height: H,
    });

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(out), { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoSec,
      narrationSec,
      introSec,
      source: "stock_footage",
      clips: footage.length,
    });
    ctx.log(`timeline_assemble ok: video ${videoSec}s (narration ${narrationSec}s, intro ${introSec}s)`);
    return { videoKey, videoLocalPath: out, videoDurationSec: videoSec };
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

export const captions: Block = {
  id: "captions",
  consumes: ["narrationDurationSec", "videoDurationSec"],
  produces: ["captionsKey", "chaptersText"],
  run: async (ctx) => {
    const introSec = Number(ctx.store["introSec"] ?? 0);
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0);
    const script = ctx.store["script"] as
      | { sections?: { heading?: string; text?: string; narration?: string }[] }
      | undefined;
    const sections = script?.sections ?? [];

    // Chapters: derived from script sections + narration timing + intro offset.
    // No external dependency — works today (lands in the video description).
    const chaptersText = buildChapters(sections, narrationSec, introSec);
    if (chaptersText) ctx.log(`captions: ${chaptersText.split("\n").length} chapters`);

    // Captions (SRT): AssemblyAI word timestamps shifted by the intro offset.
    // Degrades to chapters-only without a key (add vault service "assemblyai").
    let captionsKey = "";
    if (!hasAssemblyKey()) {
      ctx.log("captions: no ASSEMBLYAI_API_KEY — chapters only (add vault 'assemblyai' for SRT)");
      return { captionsKey, chaptersText };
    }
    try {
      const narrationKey = opt(ctx, "narrationKey");
      if (!narrationKey) {
        ctx.log("captions: no narrationKey — skipping SRT");
        return { captionsKey, chaptersText };
      }
      const words = await transcribeWords(publicUrl(narrationKey));
      const srt = wordsToSrt(words, Math.round(introSec * 1000));
      captionsKey = `${ctx.keyPrefix}runs/${ctx.runId}/captions.srt`;
      await putObject(captionsKey, Buffer.from(srt, "utf8"), {
        contentType: "application/x-subrip",
      });
      await recordAsset(ctx, "captions", captionsKey, { words: words.length });
      ctx.log(`captions: SRT ${words.length} words → ${captionsKey}`);
    } catch (e) {
      ctx.log(`captions: AssemblyAI failed (continuing, chapters only): ${e instanceof Error ? e.message : e}`);
    }
    return { captionsKey, chaptersText };
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
  entityImagery,
  introCard,
  timelineAssemble,
  lengthCheck,
  captions,
  qaVisual,
];



