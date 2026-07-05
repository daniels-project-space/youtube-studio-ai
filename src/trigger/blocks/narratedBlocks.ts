/**
 * Narrated-archetype text blocks (Stage 3a) â€” the "brain" shared by essay /
 * crime / shorts / meditation:
 *   script_gen  â†’ script + narrationText   (Gemini)
 *   hook_craft  â†’ hook + narrationText'     (Gemini; prepends a punchy opener)
 *   qa_script   â†’ scriptApproved            (Claude critique; soft gate)
 *
 * All degrade gracefully on a missing key so the pipeline never hard-fails.
 */
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { synthScript, translateScript, type Script } from "@/lib/scriptGen";
import { geminiJson, geminiVideo, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { synthNarration, hasFishKey, stripAudioTags } from "@/lib/tts";
import { narrationPhysics, gateColdOpen } from "@/lib/voicecraft";
import { sanitizeSpoken } from "@/lib/scriptGen";
import { buildFootageQueries, castFootage, hasAnyFootageProvider, type FootageBrief } from "@/lib/footagecraft";
import { searchWikimediaImage } from "@/lib/wikimedia";
import { makeRunTempDir, writeBytes, downloadTo, readBytes } from "@/lib/files";
import { putObject, getObjectBytes, publicUrl } from "@/lib/storage";
import {
  hasAssemblyKey,
  transcribeWords,
  wordsToSrt,
  buildChapters,
} from "@/lib/assemblyai";
import {
  probe,
  assembleBeatBody,
  composeWithIntro,
  concatAudioWithGaps,
  applyVoiceFx,
  applyQuoteOverlays,
  applyOverlaysAndCaptions,
  assembleStructuredBody,
  measureAudio,
  normalizeAudioOnly,
  grabFrame,
  kenBurns,
  burnCaptions,
  writeCaptionsAss,
  captionCuesFromTimings,
  type QuoteOverlaySpec,
} from "@/lib/ffmpeg";
import { renderTitleCard, renderQuoteOverlay } from "@/lib/remotionRender";
import { runValidationSpec } from "@/engine/creative/validate";
import { getVisualBrief, getMusicBrief, getValidationSpec, getStructure, getCutSheet } from "@/engine/creative/brief";
import { watchRender, nativeWatchRender } from "@/lib/renderWatch";
import { validateRender } from "@/lib/renderValidate";
import type { ValidationSpec, ValidationAssertion } from "@/engine/creative/types";

/** Split narration into sentences for organic pauses + per-sentence timing. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'â€œâ€˜])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
import {
  evaluateVisualFrames,
  evaluateThumbnail,

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

/**
 * The body's per-clip screen time. SHARED by stock_footage (coverage credit)
 * and timeline_assemble (actual cutting) â€” if these two disagree, the body
 * either loops footage (credit > reality) or wastes downloads. The Editor
 * crew's cutSheet cadence wins; else the legacy duration split.
 */
function bodySegSeconds(
  narrationSec: number,
  cutSheet?: { sections?: { name?: string; cutsPerMin: number }[] },
): number {
  const cadences = (cutSheet?.sections ?? []).map((s) => s.cutsPerMin).filter((c) => c > 0);
  if (cadences.length) {
    const avg = cadences.reduce((a, b) => a + b, 0) / cadences.length;
    return Math.max(4, Math.min(30, Math.round(60 / avg)));
  }
  return narrationSec > 600 ? 25 : 10;
}

/** Ordered concurrency pool â€” results in input order, `limit` in flight. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      for (;;) {
        const idx = next++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
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
    // RENDER-GROUP REUSE: a language sibling translates the base script instead of
    // regenerating it (reuses the base's structure + research; only words change).
    const reuseScript = ctx.store["reuseScript"] as Script | undefined;
    if (reuseScript && Array.isArray(reuseScript.sections)) {
      const lang = ctx.params["language"] as string | undefined;
      const translated = await translateScript(reuseScript, lang, ctx.log);
      ctx.log(`script_gen: reused + translated base script â†’ ${lang ?? "en"} (${translated.sections.length} sections)`);
      return { script: translated, narrationText: translated.narrationText };
    }
    const req = {
      topic,
      channelName: opt(ctx, "channelName"),
      persona: opt(ctx, "persona"),
      styleGrammar: opt(ctx, "styleGrammar"),
      niche: opt(ctx, "niche"),
      style: ctx.params["style"] as string | undefined,
      language: ctx.params["language"] as string | undefined,
      maxSeconds: ctx.params["maxSeconds"] as number | undefined,
      endWithSummary: ctx.params["endWithSummary"] as boolean | undefined,
      // Mirrors of narration_tts pacing (set by the pipeline customizer) so the
      // word budget accounts for real pauses AND voice speed, not just words.
      sentenceGapSec: ctx.params["sentenceGapSec"] as number | undefined,
      ttsSpeed: ctx.params["ttsSpeed"] as number | undefined,
      // Channel voice performs ElevenLabs v3 [audio tags] â€” the writer places
      // them inline (mirrored from narration_tts.ttsProvider by the designer/
      // architect invariants).
      voiceTags: ctx.params["voiceTags"] === true,
      // The channel has a data-viz insert layer â€” the script must speak the
      // numbers the inserts will render.
      dataRich: ctx.params["dataRich"] as boolean | undefined,
      structure: getStructure(ctx.store),
      // The channel's locked narrative register (Style DNA) â€” outranks the
      // generic archetype tone in the prompt.
      narrative: (ctx.store["styleDNA"] as
        | { narrative?: { scriptStyle?: string; hookStyle?: string; pacing?: string; delivery?: string } }
        | null)?.narrative,
      // Script Lab playbook (distilled from WATCHING the niche's top videos).
      // The opening device rotates deterministically per run â€” openings never
      // feel same-y across the channel's library.
      playbook: ctx.store["scriptPlaybook"] as import("@/lib/scriptLab").ScriptPlaybook | undefined,
      openingDeviceIdx: [...ctx.runId].reduce((s, c) => s + c.charCodeAt(0), 0),
    };
    let script = await synthScript(req, ctx.log);

    // EVALUATOR-OPTIMIZER (short-form only â€” regenerating a 30-min chunked
    // script doubles cost): Claude critiques the draft; a rejected draft is
    // regenerated ONCE with the issues injected. Keep the informed second
    // attempt either way â€” never a generic fallback, and the critique signal
    // actually feeds back instead of evaporating in qa_script.
    const maxSec = Number(req.maxSeconds ?? 240);
    if (hasAnthropicKey() && maxSec <= 420) {
      try {
        const persona = req.persona ?? "";
        const crit = await claudeJson<{ pass?: boolean; issues?: string[] }>({
          prompt:
            `Critique this YouTube narration draft for quality and on-brand voice` +
            (persona ? ` (channel persona: ${persona})` : "") +
            `. Flag dull sections, off-brand language, factual hedging, weak structure, or generic ` +
            `templated writing.` +
            (script.hookLoop
              ? ` CRITICAL: the cold open promised "${script.hookLoop}" — flag it as an issue if the script ` +
                `does not EXPLICITLY pay that promise off.`
              : "") +
            ` Return STRICT JSON {"pass": boolean, "issues": string[]} â€” at most 5 ` +
            `issues, each under 140 characters.\n\n` +
            (script.narrationText.length <= 9000
              ? script.narrationText
              : script.narrationText.slice(0, 4000) + `\n\n[... OMITTED ...]\n\n` + script.narrationText.slice(-3500)),
          maxTokens: 1200,
          temperature: 0.3,
        });
        const issues = (Array.isArray(crit.issues) ? crit.issues : []).filter(Boolean).slice(0, 6);
        if (crit.pass === false && issues.length) {
          ctx.log(`script_gen: draft rejected by critic â€” regenerating once`, { issues });
          // Reuse the judge-gated hook: only the narration was rejected, so the
          // regen must not re-bill hookcraft (Pro + grounded fact-checks).
          script = await synthScript({ ...req, priorIssues: issues, precraftedHook: script.crafted }, ctx.log);
        }
      } catch (e) {
        ctx.log(`script_gen: critic unavailable (kept draft): ${e instanceof Error ? e.message : e}`);
      }
    }
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
    ctx.log(`hook_craft: "${hook.slice(0, 60)}â€¦"`);
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
      // HONEST: unverified is not the same as approved. Nothing downstream hard-
      // gates on this yet, but the flag must not lie to the run record/Doctor.
      ctx.log("qa_script: no Anthropic key â€” script UNVERIFIED (scriptApproved=false)");
      return { scriptApproved: false };
    }
    try {
      const persona = opt(ctx, "persona") ?? "";
      // The hookcraft contract: the cold open's promise + the midpoint re-hook
      // are CRAFT_RULES law — verify them here instead of hoping.
      const hookLoop = (ctx.store["script"] as { hookLoop?: string } | undefined)?.hookLoop ?? "";
      const res = await claudeJson<{ pass?: boolean; issues?: string[] }>({
        prompt:
          `Critique this YouTube narration for quality and on-brand voice` +
          (persona ? ` (channel persona: ${persona})` : "") +
          `. Flag dull sections, off-brand language, factual hedging, or weak structure. ` +
          `CRITICALLY: require a genuine, specific POINT OF VIEW / original angle â€” not ` +
          `just narrated facts â€” and flag generic, formulaic, or templated writing that ` +
          `could read as mass-produced (YouTube demonetizes "inauthentic" content). ` +
          (hookLoop
            ? `THE HOOK'S CONTRACT: the cold open promised "${hookLoop}" — FAIL the script if it does not ` +
              `explicitly pay that promise off (a vague gesture at it is a fail). `
            : "") +
          `Also verify a deliberate MIDPOINT RE-HOOK exists in the middle third (a pointed question to the ` +
          `viewer, a vivid concrete example, or a tonal shift) — flag its absence as an issue. ` +
          `Return STRICT JSON {"pass": boolean, "issues": string[]} â€” at most 5 issues, ` +
          `each under 140 characters (a truncated reply is unusable).\n\n` +
          // Head + middle + tail sample: a head-only slice HID the midpoint and
          // the payoff from the critic on anything longer than ~2 minutes.
          (narration.length <= 9000
            ? narration
            : narration.slice(0, 3500) +
              `\n\n[... OMITTED ...]\n\n` +
              narration.slice(Math.floor(narration.length / 2) - 1500, Math.floor(narration.length / 2) + 1500) +
              `\n\n[... OMITTED ...]\n\n` +
              narration.slice(-2500)),
        maxTokens: 1200,
        temperature: 0.3,
      });
      const issues = Array.isArray(res.issues) ? res.issues : [];
      ctx.log(`qa_script: pass=${res.pass !== false}`, { issues: issues.slice(0, 5) });
      return { scriptApproved: res.pass !== false };
    } catch (e) {
      ctx.log(`qa_script: critique failed (non-fatal, UNVERIFIED): ${e instanceof Error ? e.message : e}`);
      return { scriptApproved: false };
    }
  },
};

export const narrationTts: Block = {
  id: "narration_tts",
  consumes: ["narrationText"],
  produces: [
    "narrationKey",
    "narrationDurationSec",
    "narrationLocalPath",
    "sentenceTimings",
    "chapterPlan",
  ],
  paid: true,
  run: async (ctx) => {
    // TTS engine: fish (default) or elevenlabs (v3 expressive â€” PERFORMS inline
    // [audio tags] the script writer placed; tags survive sanitization here but
    // are stripped from all DISPLAY surfaces below).
    const ttsProvider = (ctx.params["ttsProvider"] as string) || "fish";
    const elevenVoiceId = ctx.params["elevenVoiceId"] as string | undefined;
    // sanitizeSpoken strips any markdown/slashes/stage-directions that slipped
    // through script_gen so the voice never reads a symbol aloud.
    const text = sanitizeSpoken(str(ctx, "narrationText"), { keepAudioTags: ttsProvider === "elevenlabs" });
    if (ttsProvider === "elevenlabs") {
      if (!process.env.ELEVENLABS_API_KEY) throw new Error("narration_tts: ELEVENLABS_API_KEY missing");
    } else if (!hasFishKey()) {
      throw new Error("narration_tts: FISH_AUDIO_API_KEY missing (vault service 'fish-audio')");
    }
    const voiceId =
      opt(ctx, "voiceId") ?? (ctx.params["voiceId"] as string | undefined);
    const niche = opt(ctx, "niche");
    // NARRATION PHYSICS — the archetype's delivery doctrine (voicecraft):
    // per-channel-kind speed, v3 stability/style, sentence air. Explicit
    // params and Style-DNA pacing still outrank the archetype baseline.
    const physics = narrationPhysics(niche);
    const baseGap = Number(ctx.params["sentenceGapSec"] ?? physics.sentenceGap ?? 0.85);
    const jitter = Number(ctx.params["sentenceGapJitter"] ?? 0.2);
    // SPEAKING RATE — param > Style-DNA pacing > archetype physics > native.
    const dnaPacing = (ctx.store["styleDNA"] as { narrative?: { pacing?: string; delivery?: string } } | null)
      ?.narrative;
    const pacingText = `${dnaPacing?.pacing ?? ""} ${dnaPacing?.delivery ?? ""}`.toLowerCase();
    const dnaSpeed =
      /sleep|meditat|hypnot|very slow|drowsy/.test(pacingText) ? 0.88
        : /slow|gentle|calm|soothing|unhurried/.test(pacingText) ? 0.93
        : /measured|deliberate|contemplative|documentary/.test(pacingText) ? 0.96
        : /fast|energetic|punchy|rapid|urgent/.test(pacingText) ? 1.05
        : 0;
    const speed = Number(ctx.params["ttsSpeed"] ?? 0) || dnaSpeed || physics.speed;
    if (speed !== 1)
      ctx.log(
        `narration_tts: speaking rate x${speed} (${ctx.params["ttsSpeed"] ? "param" : dnaSpeed ? "Style DNA pacing" : `physics:${physics.archetype}`})`,
      );
    // ElevenLabs render settings from the physics (v3 stability/style/seed).
    let elevenSeed = 4242;
    const elevenSettings = ttsProvider === "elevenlabs"
      ? { stability: physics.stability, ...(physics.style ? { style: physics.style } : {}) }
      : undefined;

    // COLD-OPEN GATE — render the first lines once and let Gemini LISTEN
    // before the full-script spend: a wrong cast or wrong physics fails loud
    // HERE, not after the whole paid render. ~250 chars; voiceGate=false opts out.
    if (ttsProvider === "elevenlabs" && hasGeminiKey() && ctx.params["voiceGate"] !== false) {
      const probe = splitSentences(text).slice(0, 2).join(" ");
      if (probe.trim()) {
        const gate = await gateColdOpen({
          text: probe,
          elevenVoiceId: elevenVoiceId ?? "JBFqnCBsd6RMkjVDRZzb",
          physics,
          log: (m) => ctx.log(m),
        });
        elevenSeed = gate.seed;
        ctx.log(
          `narration_tts: cold-open gate PASSED (register ${gate.verdict.register} | pace ${gate.verdict.pace} | performance ${gate.verdict.performance} | clean ${gate.verdict.clean}, seed ${gate.seed})`,
        );
      }
    }
    // Optional stylized voice filter (e.g. "radio" â†’ vintage AM set). Applied to
    // the finished narration track before upload; no-op when unset. The Composer
    // (crew) brief can set it when the operator didn't pin one.
    const voiceFx =
      (ctx.params["voiceFx"] as string | undefined) ??
      getMusicBrief(ctx.store)?.audio?.voiceFx;
    const tmp = await makeRunTempDir(ctx.runId);

    // CHAPTER MODE â€” speak each section heading as a spoken "chapter card" (the
    // card holds while it's read, then a short break, then the section narration
    // resumes). Emits `chapterPlan` (the body layout: alternating card/footage
    // windows) so timeline_assemble splices the heading cards into the body.
    const script = ctx.store["script"] as
      | { hook?: string; sections?: { heading: string; narration: string }[] }
      | undefined;
    const chapterMode =
      ctx.params["chapterCards"] === true && (script?.sections?.length ?? 0) >= 2;
    if (chapterMode && script?.sections) {
      const preSec = Number(ctx.params["chapterPreSec"] ?? 3); // silence as the card fades in, before the heading
      const postSec = Number(ctx.params["chapterPostSec"] ?? 3); // silence after the heading, as the card fades out
      type Item = { kind: "narration" | "heading"; text: string; chap?: number };
      const items: Item[] = [];
      if (script.hook) for (const s of splitSentences(sanitizeSpoken(script.hook))) items.push({ kind: "narration", text: s });
      // Chapter cards belong to the BODY only: the INTRO (first section) flows
      // straight out of the cold open with no "Chapter 1" interrupt, and the
      // OUTRO (final section) lands as the closing narration with no card.
      const lastIdx = script.sections.length - 1;
      script.sections.forEach((sec, idx) => {
        const isIntro = idx === 0 && script.sections!.length >= 3;
        if (idx !== lastIdx && !isIntro) items.push({ kind: "heading", text: sec.heading, chap: items.filter((x) => x.kind === "heading").length + 1 });
        for (const s of splitSentences(sanitizeSpoken(sec.narration))) items.push({ kind: "narration", text: s });
      });

      const partPaths: string[] = [];
      const gaps: number[] = [];
      const sentenceTimings: { text: string; start: number; end: number }[] = [];
      const chapterPlan: { kind: "footage" | "card"; durSec: number; heading?: string }[] = [];
      let cursor = 0;
      let footAccum = 0;
      let chap = 0;
      const flush = () => { if (footAccum > 0.1) { chapterPlan.push({ kind: "footage", durSec: footAccum }); footAccum = 0; } };
      // PARALLEL synthesis (small pool â€” Fish concurrency limit; see sentence mode).
      const speakOf = (it: Item) =>
        it.kind === "heading" ? `Chapter ${it.chap}: ${it.text.replace(/[.:;,\s]+$/, "")}.` : it.text;
      const chPool = Math.max(1, Number(process.env.TTS_CONCURRENCY ?? 2));
      // Probe-fallback counter: an ESTIMATED duration shifts every later
      // sentenceTiming (captions/quotes/inserts) by the estimation error —
      // one flaky probe is tolerable, several means the whole sync is fiction.
      let probeEstimates = 0;
      const synthed = await mapPool(items, chPool, async (it, i) => {
        const speak = speakOf(it);
        // v3 continuity: condition each take on its neighbors so consecutive
        // sentences keep one prosody instead of jarring independent "takes".
        const stitch = ttsProvider === "elevenlabs"
          ? {
              previousText: i > 0 ? speakOf(items[i - 1]) : undefined,
              nextText: i < items.length - 1 ? speakOf(items[i + 1]) : undefined,
            }
          : undefined;
        const bytes = await synthNarration({ text: speak, voiceId, niche, speed, provider: ttsProvider, elevenVoiceId, eleven: elevenSettings ? { ...elevenSettings, seed: elevenSeed } : undefined, stitch });
        const p = join(tmp, `utt_${i}.mp3`);
        await writeBytes(p, bytes);
        let dur = 0;
        try { dur = (await probe(p)).durationSec; } catch { dur = Math.max(1, speak.split(/\s+/).length / 2.5); probeEstimates++; }
        // Runaway-take guard (deterministic): v3 once rendered 13 minutes for
        // 65 words on a tag-heavy slow script. Code catches what ears cannot.
        const wcnt = speak.split(/\s+/).filter(Boolean).length;
        if (dur > Math.max(12, wcnt * 1.3)) {
          throw new Error(`narration_tts: runaway take (${dur.toFixed(0)}s for ${wcnt} words) — v3 blowout`);
        }
        return { p, dur };
      });
      if (probeEstimates > 2) {
        throw new Error(`narration_tts: ${probeEstimates} sentence durations are ESTIMATES (probe failures) — caption/overlay sync would be fiction; failing loud`);
      }
      if (probeEstimates > 0) ctx.log(`narration_tts: WARNING ${probeEstimates} sentence duration(s) estimated (probe failed) — timings may drift slightly`);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const nextIsHeading = items[i + 1]?.kind === "heading";
        partPaths.push(synthed[i].p);
        const dur = synthed[i].dur;
        let gapAfter: number;
        if (it.kind === "heading") {
          // CARD window = preSec (pre-silence, already reserved as the previous
          // gap) + heading read + postSec (post-silence). The card gently fades
          // in/out across both silences.
          flush();
          chap++;
          chapterPlan.push({ kind: "card", durSec: preSec + dur + postSec, heading: it.text });
          gapAfter = postSec;
        } else {
          sentenceTimings.push({ text: stripAudioTags(it.text), start: cursor, end: cursor + dur });
          if (nextIsHeading) {
            // this gap is the upcoming card's PRE-silence â€” belongs to the card, not footage
            gapAfter = preSec;
            footAccum += dur;
          } else {
            gapAfter = Math.max(0.2, baseGap + (Math.random() * 2 - 1) * jitter);
            footAccum += dur + gapAfter;
          }
        }
        gaps.push(i < items.length - 1 ? gapAfter : 0);
        cursor += dur + (i < items.length - 1 ? gapAfter : 0);
      }
      flush();

      let local = join(tmp, "narration.mp3");
      await concatAudioWithGaps(partPaths, gaps, local);
      local = await applyVoiceFx(local, voiceFx, join(tmp, "narration_fx.mp3"));
      let durationSec = 0;
      try { durationSec = (await probe(local)).durationSec; } catch { durationSec = cursor; }
      const narrationKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
      await putObject(narrationKey, await readBytes(local), { contentType: "audio/mpeg" });
      await recordAsset(ctx, "narration", narrationKey, { durationSec, chapters: chap, mode: "chapter" });
      ctx.log(`narration_tts ok (chapter mode): ${durationSec.toFixed(0)}s, ${chap} chapters, ${sentenceTimings.length} sentences`);
      return {
        narrationKey,
        narrationDurationSec: durationSec,
        narrationLocalPath: local,
        sentenceTimings,
        chapterPlan,
        [COST_PATCH_KEY]: ((ttsProvider === "elevenlabs" ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd) * text.length) / 1000,
      };
    }

    // Synth PER SENTENCE and concat with a silence gap â†’ organic pauses, plus
    // exact per-sentence timings (used to anchor quote overlays). Gaps are
    // jittered per sentence so the pacing feels human, not metronomic.
    const sentences = splitSentences(text);
    const gaps = sentences.map(() => Math.max(0.2, baseGap + (Math.random() * 2 - 1) * jitter));
    ctx.log(`narration_tts: ${sentences.length} sentences, ~${baseGap}s (Â±${jitter}) pausesâ€¦`);

    // PARALLEL synthesis (order preserved) â€” sequential per-sentence HTTP calls
    // made TTS the slowest non-encode stage (~140 calls Ã— ~5s). Pool kept SMALL:
    // Fish Audio enforces a plan-level CONCURRENCY limit (pool of 6 â†’ instant
    // 429 "exceeded your current concurrency limit" â†’ failed render).
    const ttsPool = Math.max(1, Number(process.env.TTS_CONCURRENCY ?? 2));
    let probeFailures = 0;
    const parts = await mapPool(sentences, ttsPool, async (s, i) => {
      // v3 continuity: neighbor conditioning kills the per-sentence "new take"
      // voice jump (the cause of jarring instant voice changes between lines).
      const stitch = ttsProvider === "elevenlabs"
        ? {
            previousText: i > 0 ? sentences[i - 1] : undefined,
            nextText: i < sentences.length - 1 ? sentences[i + 1] : undefined,
          }
        : undefined;
      const bytes = await synthNarration({ text: s, voiceId, niche, speed, provider: ttsProvider, elevenVoiceId, eleven: elevenSettings ? { ...elevenSettings, seed: elevenSeed } : undefined, stitch });
      const p = join(tmp, `sent_${i}.mp3`);
      await writeBytes(p, bytes);
      let dur = 0;
      try { dur = (await probe(p)).durationSec; } catch { probeFailures++; dur = Math.max(1, s.split(/\s+/).length / 2.5); }
      // Runaway-take guard (deterministic) — see chapter mode.
      const wcnt2 = s.split(/\s+/).filter(Boolean).length;
      if (dur > Math.max(12, wcnt2 * 1.3)) {
        throw new Error(`narration_tts: runaway take (${dur.toFixed(0)}s for ${wcnt2} words) — v3 blowout`);
      }
      return { p, dur };
    });
    const partPaths: string[] = parts.map((x) => x.p);
    // Timings carry the DISPLAY text â€” audio tags are performed by the voice,
    // never shown in captions/quote cards/insert matching.
    const sentenceTimings: { text: string; start: number; end: number }[] = [];
    let cursor = 0;
    for (let i = 0; i < sentences.length; i++) {
      sentenceTimings.push({ text: stripAudioTags(sentences[i]), start: cursor, end: cursor + parts[i].dur });
      cursor += parts[i].dur + (i < sentences.length - 1 ? gaps[i] : 0);
    }

    let local = join(tmp, "narration.mp3");
    await concatAudioWithGaps(partPaths, gaps, local);
    local = await applyVoiceFx(local, voiceFx, join(tmp, "narration_fx.mp3"));
    let durationSec = 0;
    try {
      durationSec = (await probe(local)).durationSec;
    } catch {
      durationSec = cursor;
    }
    // TIMING SELF-CHECK: a failed per-sentence probe injected an ESTIMATED
    // duration into the cumulative cursor, silently shifting every later
    // caption/quote/insert sync point. When probes failed AND the real
    // narration length disagrees with the cursor, rescale timings linearly to
    // the measured truth instead of shipping drifted sync.
    if (probeFailures > 0 && durationSec > 0 && Math.abs(durationSec - cursor) > 1.5) {
      const k = durationSec / Math.max(0.1, cursor);
      for (const t of sentenceTimings) {
        t.start *= k;
        t.end *= k;
      }
      ctx.log(`narration_tts: ${probeFailures} probe failure(s) — sentence timings rescaled ×${k.toFixed(4)} to the measured ${durationSec.toFixed(1)}s`);
    }

    const narrationKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
    await putObject(narrationKey, await readBytes(local), { contentType: "audio/mpeg" });
    await recordAsset(ctx, "narration", narrationKey, {
      durationSec,
      sentences: sentences.length,
      gapSec: baseGap,
    });
    ctx.log(`narration_tts ok: ${durationSec}s, ${sentences.length} sentences (~${baseGap}s pauses)`);
    return {
      narrationKey,
      narrationDurationSec: durationSec,
      narrationLocalPath: local,
      sentenceTimings,
      // Declared in `produces`, so it must ALWAYS be returned â€” an empty plan
      // means "no chapter cards". (chapterCards:false channels hit the engine's
      // undefined-produce guard here on their very first render.)
      chapterPlan: [],
      [COST_PATCH_KEY]: ((ttsProvider === "elevenlabs" ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd) * text.length) / 1000,
    };
  },
};

export const stockFootage: Block = {
  id: "stock_footage",
  consumes: ["topic", "script"],
  produces: ["footageClips", "footageKeys"],
  run: async (ctx) => {
    // Upload the gated clips to run-scoped R2 keys alongside the local paths. This
    // is what lets timeline_assemble run on a SEPARATE large-2x worker (the P1→P2
    // render-split) — the render child rehydrates footageClips from footageKeys —
    // and it also makes this block resume-restorable instead of re-downloading.
    const uploadFootageKeys = async (paths: string[]): Promise<string[]> => {
      // Parallel (pool of 4): the sequential loop over 100-160 clips added
      // minutes of pure upload wait per run. Order-preserving via mapPool.
      return mapPool(paths, 4, async (p, i) => {
        const key = `${ctx.keyPrefix}footage/run/${ctx.runId}/clip_${i}.mp4`;
        await putObject(key, await readBytes(p), { contentType: "video/mp4" });
        return key;
      });
    };
    // RENDER-GROUP REUSE: a language sibling reuses the base render's footage from
    // the durable group bundle (no Pexels query/download/AI-gate â€” the visuals are
    // identical across languages; only narration/captions/text differ).
    const reuseKeys = ctx.store["reuseFootageKeys"] as string[] | undefined;
    if (reuseKeys?.length) {
      const tmp = await makeRunTempDir(ctx.runId);
      const clips: string[] = [];
      const okKeys: string[] = [];
      for (let i = 0; i < reuseKeys.length; i++) {
        try {
          const p = join(tmp, `reuse_${i}.mp4`);
          await writeBytes(p, await getObjectBytes(reuseKeys[i]));
          clips.push(p);
          okKeys.push(reuseKeys[i]);
        } catch (e) {
          ctx.log(`stock_footage(reuse): clip ${i} fetch failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (clips.length) {
        ctx.log(`stock_footage: REUSED ${clips.length} footage clips from base render (no Pexels)`);
        return { footageClips: clips, footageKeys: okKeys };
      }
      ctx.log("stock_footage(reuse): no clips fetched â€” falling back to fresh sourcing");
    }
    if (!hasAnyFootageProvider()) {
      throw new Error("stock_footage: no footage provider configured (vault service 'pexels' at minimum)");
    }
    const topic = str(ctx, "topic");
    const script = ctx.store["script"] as
      | { sections?: { heading?: string }[] }
      | undefined;
    const orientation =
      (ctx.params["aspect"] as string | undefined) === "9:16"
        ? ("portrait" as const)
        : ("landscape" as const);

    // Enough DISTINCT clips to cover the whole video so the body never visibly
    // loops the same footage. Target = narration + intro + tail; over-provision
    // queries (~1 clip per ~11s) so we reach coverage even after the relevance gate.
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 120;
    const targetSec = narrationSec + 18; // body must cover narration + ~15s outro
    // Beat-body shows each clip ~SEG seconds, so we need ~targetSec/SEG DISTINCT
    // clips (not a few long ones) â€” count coverage at the per-segment rate.
    // SHARED bodySegSeconds keeps this in lockstep with timeline_assemble's
    // actual cutting (including the Editor cutSheet cadence) â€” when the editor
    // cuts at 8s but coverage was credited at 25s/clip, the body looped its
    // whole footage sequence to fill the video.
    const bodyMaxSeg = bodySegSeconds(
      narrationSec,
      getCutSheet(ctx.store),
    );
    const PER_CLIP = bodyMaxSeg;
    // Size the query count assuming clips are OFTEN SHORTER than the cap, so we
    // over-provision DISTINCT clips and the body never repeats one.
    const SEG = Math.max(5, Math.round(bodyMaxSeg * 0.65));
    // Long-form (15-35 min) needs many more distinct clips; bound cost/time.
    const queryCap = narrationSec > 600 ? 160 : 110;
    const nQueries = Math.min(queryCap, Math.max(12, Math.ceil(targetSec / SEG)));

    // Mood/theme context from the ACTUAL narration so both the query-gen and the
    // relevance gate judge fit against the video's content, not just the topic
    // string. (narration_tts runs first, so narrationText is in the store.)
    const narrationExcerpt = String(ctx.store["narrationText"] ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 900);

    // Footage theme: "nature" â†’ ONLY serene nature / landscape / water / ancient
    // ruins (+ slow motion), no people/cities/objects/interiors. Per-channel param.
    const natureMode = (ctx.params["footageTheme"] as string | undefined) === "nature";
    // A BIG, varied pool of nature/landscape/water/ruins scenes â€” shuffled per
    // render and mixed into the queries so videos don't all reuse the same shots.
    // Channel + topic aware brief — the picker AND the gate judge against it.
    const dna = ctx.store["styleDNA"] as { setting?: string; colorGrade?: string; motifs?: string[]; visualAvoid?: string[] } | null;
    const brief: FootageBrief = {
      topic,
      niche: opt(ctx, "niche"),
      narrationExcerpt,
      orientation,
      visualWorld: dna?.setting ? { setting: dna.setting, colorGrade: dna.colorGrade, motifs: dna.motifs } : undefined,
      visualAvoid: dna?.visualAvoid,
      natureMode,
      healHints: (ctx.store["healHints"] as Record<string, string[]> | undefined)?.["stock_footage"],
    };

    // DP-brief footage queries LEAD (the channel look); buildFootageQueries
    // fills the rest from topic + narration + the DNA world. Overlong DP scene
    // descriptions are compressed (a 15-word query gets zero stock hits).
    const STOP = new Set(["a","an","the","of","with","and","or","in","on","at","to","for","over","under","by"]);
    const compressQuery = (q: string): string => {
      const w = q.trim().split(/\s+/);
      return w.length <= 6 ? q.trim() : w.filter((x) => !STOP.has(x.toLowerCase())).slice(0, 4).join(" ");
    };
    const dpQueries = ((getVisualBrief(ctx.store)?.footageQueries) ?? [])
      .map(compressQuery).filter(Boolean);
    const extras = [topic, ...((script?.sections ?? []).map((sec) => sec.heading ?? "").filter(Boolean)), opt(ctx, "niche") ?? "cinematic background"];
    const built = await buildFootageQueries(brief, nQueries, extras);
    const queries = [...dpQueries, ...built].filter((q, i, a) => q && a.indexOf(q) === i).slice(0, nQueries);
    if (dpQueries.length) ctx.log(`stock_footage: led with ${dpQueries.length} DP brief queries`);
    ctx.log(`stock_footage: ${queries.length} queries, target ${targetSec.toFixed(0)}s coverage`);

    // Worker scratch dir (NEVER a dev box / VPS) + cross-video ledger from R2.
    const tmp = await makeRunTempDir(ctx.runId);
    const ledgerKey = `${ctx.keyPrefix}footage/used_clips.json`;
    const usedIds = new Set<string>();
    try {
      const raw = await getObjectBytes(ledgerKey);
      for (const id of JSON.parse(Buffer.from(raw).toString("utf8")) as string[]) usedIds.add(id);
      ctx.log(`stock_footage: ${usedIds.size} clips in cross-video ledger (will be skipped)`);
    } catch {
      /* no ledger yet — first run for this channel */
    }

    // FOOTAGECRAFT — federated 4K search + CONCURRENT download/gate + coverage.
    const cast = await castFootage({
      brief,
      queries,
      targetSec,
      perClipSec: PER_CLIP,
      usedClipIds: usedIds,
      tmpDir: tmp,
      legacy: ctx.params["legacyFootage"] === true,
      log: (m) => ctx.log(m),
    });
    const clips = cast.clips.map((c) => c.path);
    if (clips.length === 0) throw new Error("stock_footage: no clips found for any query");

    // Persist the ids actually used (bounded) so they're never reused later.
    try {
      for (const id of cast.pickedIds) usedIds.add(id);
      const ledger = Array.from(usedIds).slice(-3000);
      await putObject(ledgerKey, Buffer.from(JSON.stringify(ledger), "utf8"), { contentType: "application/json" });
      ctx.log(`stock_footage: ledger updated -> ${ledger.length} used clip ids`);
    } catch (e) {
      ctx.log(`stock_footage: ledger save failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    // HYBRID: prepend any pre-generated signature establishing shots (produced by
    // the separate signature_clips block when the architect enabled it). Footage
    // SELECTION lives here; signature GENERATION is its own block.
    const sigClips = (ctx.store["signatureClips"] as string[] | undefined) ?? [];
    if (sigClips.length) {
      clips.unshift(...sigClips);
      ctx.log(`stock_footage: HYBRID — ${sigClips.length} signature clip(s) prepended`);
    }
    return { footageClips: clips, footageKeys: await uploadFootageKeys(clips) };
  },
};

export const entityImagery: Block = {
  id: "entity_imagery",
  consumes: ["narrationText"],
  produces: ["entityClips", "entityKeys", "attributions"],
  run: async (ctx) => {
    const clips: string[] = [];
    const attributions: string[] = []; // license ledger (Wikimedia credits)
    // Upload entity images to run-scoped R2 keys so the render child (P1→P2
    // split) can rehydrate entityClips from entityKeys on its own worker.
    const uploadEntityKeys = async (paths: string[]): Promise<string[]> => {
      const keys: string[] = [];
      for (let i = 0; i < paths.length; i++) {
        const key = `${ctx.keyPrefix}entity/run/${ctx.runId}/img_${i}.jpg`;
        await putObject(key, await readBytes(paths[i]), { contentType: "image/jpeg" });
        keys.push(key);
      }
      return keys;
    };
    if (!hasGeminiKey()) {
      ctx.log("entity_imagery: no Gemini key â€” skipping");
      return { entityClips: clips, entityKeys: [], attributions };
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
            const raw = await visionLocal({
              prompt:
                `Does this image clearly depict "${e}"? Be strict about identity for ` +
                `people and specific places. Return STRICT JSON {"match":boolean,"reason":string}.`,
              imagePaths: [img],
              json: true,
              maxTokens: 120,
            });
            const v = parseJsonLoose<{ match?: boolean; reason?: string }>(raw);
            if (v.match === false) {
              ctx.log(`entity_imagery: image for "${e}" did NOT verify (${v.reason ?? ""}) â€” skipping`);
              continue;
            }
          } catch {
            /* verification failed â†’ keep the image rather than drop the entity */
          }
        }
        const clip = await kenBurns(img, join(tmp, `entity_${i}.mp4`), 5, W, H);
        clips.push(clip);
        if (wi.attribution) attributions.push(`${e}: ${wi.attribution}`);
        ctx.log(`entity_imagery: "${e}" â†’ verified Ken Burns clip`);
        i++;
      } catch (err) {
        ctx.log(`entity_imagery: "${e}" failed (${err instanceof Error ? err.message : err})`);
      }
    }
    ctx.log(`entity_imagery: ${clips.length} entity clip(s), ${attributions.length} attribution(s)`);
    return { entityClips: clips, entityKeys: await uploadEntityKeys(clips), attributions };
  },
};

export const introCard: Block = {
  id: "intro_card",
  consumes: ["topic"],
  produces: ["introCardPath", "introCardKey", "introApplied", "introSec", "introMode"],
  run: async (ctx) => {
    // Universal Remotion title card (cloud-wired): renders the in-app TitleCard
    // composition (src/remotion) in-process via headless Chromium. It is
    // PREPENDED by the assembler so every video opens with a branded card over a
    // music-only intro (no narration yet). Guarded â€” a render failure degrades to
    // no-card (introApplied:false) and NEVER blocks the video.
    // Card shows the VIDEO's subject (topic) â€” NOT the channel name (that belongs
    // on the channel page, not stamped on every intro). Keep it SHORT: take the
    // lead clause (before a ':' / 'â€”' / '-') and cap length so it fits the card.
    const rawTopic = (opt(ctx, "topic") ?? (ctx.store["topic"] as string | undefined) ?? "").trim();
    let cardTitle = rawTopic.split(/\s*[:â€”â€“-]\s*/)[0].trim();
    // The card wraps to two lines comfortably at ~60 chars. Trim on a word
    // boundary AND drop a dangling article/preposition â€” the old 46-char cut
    // produced "The Decades When Doing Nothing Was the" (QA-flagged, rightly).
    if (cardTitle.length > 60) cardTitle = cardTitle.slice(0, 60).replace(/\s+\S*$/, "").trim();
    cardTitle = cardTitle.replace(/\s+(the|a|an|of|to|in|on|for|and|or|was|is|with|by)$/i, "").trim() || cardTitle;
    const subtitle = "";
    const introSec = Number(ctx.params["introSec"] ?? 5);
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;
    const palette = ctx.store["palette"] as string[] | undefined;
    try {
      const tmp = await makeRunTempDir(ctx.runId);
      const out = join(tmp, "titlecard.mp4");
      // BRAND bg: the channel's own avatar (its iconic motif) at card opacity â€”
      // every channel used to open on the same baked stoic bust.
      let bgImagePath = join(process.cwd(), "src/assets/intro_bust.jpg");
      const avatarKey = ctx.store["channelAvatarKey"] as string | undefined;
      if (avatarKey) {
        try {
          bgImagePath = await writeBytes(join(tmp, "card_bg.png"), await getObjectBytes(avatarKey));
          ctx.log("intro_card: using the channel avatar as the card background");
        } catch (e) {
          ctx.log(`intro_card: avatar fetch failed (default card bg): ${e instanceof Error ? e.message : e}`);
        }
      }
      await renderTitleCard({
        title: cardTitle,
        subtitle,
        palette,
        outPath: out,
        durationSec: introSec,
        width: W,
        height: H,
        bgImagePath,
      });
      ctx.log(`intro_card: title card rendered (${introSec}s @ ${W}x${H}, "${cardTitle.slice(0, 50)}")`);
      // R2-back the card so the render child (P1→P2 split) can rehydrate
      // introCardPath from introCardKey on its own worker (also fixes resume).
      const introCardKey = `${ctx.keyPrefix}runs/${ctx.runId}/introcard.mp4`;
      await putObject(introCardKey, await readBytes(out), { contentType: "video/mp4" });
      return {
        introCardPath: out,
        introCardKey,
        introApplied: true,
        introSec,
        introMode: "prepend",
      };
    } catch (e) {
      // FAIL LOUD: qa_visual now hard-gates introApplied, so degrading to
      // no-card guaranteed a downstream QA failure anyway - but WORSE, the
      // "ok" stage got resume-CACHED, poisoning every retry with the degraded
      // state (seen live: a worker missing @remotion/noise baked
      // introApplied=false into the run forever). Fail loudly so retry/heal
      // re-runs this cheap render on a healthy worker.
      throw new Error(`intro_card: title-card render FAILED (${e instanceof Error ? e.message : e})`);
    }
  },
};

/**
 * Chapter-card time windows in FINAL video seconds (chapterPlan runs in body time;
 * the body starts after the intro card). Used to keep quote cards + captions from
 * colliding with a chapter card.
 */
function chapterCardWindows(
  plan: { kind: string; durSec: number; heading?: string }[] | undefined,
  introSec: number,
): { start: number; end: number; heading?: string }[] {
  if (!plan || plan.length === 0) return [];
  const out: { start: number; end: number; heading?: string }[] = [];
  let t = introSec;
  for (const w of plan) {
    if (w.kind === "card") out.push({ start: t, end: t + w.durSec, heading: w.heading });
    t += w.durSec;
  }
  return out;
}

export const quoteOverlaysBlock: Block = {
  id: "quote_overlays",
  consumes: ["sentenceTimings"],
  produces: ["quoteOverlays"],
  run: async (ctx) => {
    const timings =
      (ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    const out: QuoteOverlaySpec[] = [];
    if (!hasGeminiKey() || timings.length === 0) {
      ctx.log("quote_overlays: skipping (no Gemini key or no sentence timings)");
      return { quoteOverlays: out };
    }
    const introSec = Number(ctx.store["introSec"] ?? 0);
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;
    // A quote card must NEVER overlap a chapter card â€” keep a gap on both sides.
    const cardWins = chapterCardWindows(
      ctx.store["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined,
      introSec,
    );
    const CARD_GAP = Number(ctx.params["quoteCardGapSec"] ?? 3);
    const clashesCard = (s: number, e: number) =>
      cardWins.some((w) => e > w.start - CARD_GAP && s < w.end + CARD_GAP);
    const maxN = Number(ctx.params["maxQuotes"] ?? 3);

    // Director picks the most impactful sentences + the words to highlight yellow.
    let picks: { index: number; highlights: string[] }[] = [];
    try {
      const indexed = timings.map((t, i) => `${i}: ${t.text}`).join("\n");
      const res = await geminiJson<{ quotes?: { index?: number; highlights?: string[] }[] }>({
        prompt:
          `From these narration sentences, choose the ${maxN} MOST quotable, aphoristic, or emotionally ` +
          `striking ones to show as on-screen quote cards. Pick EXACTLY ${maxN} (or all available if fewer than ` +
          `${maxN} sentences) â€” always rank and return the strongest ${maxN}; do NOT return an empty list. ` +
          `Favour the punchiest, most memorable lines and spread them across the video. ` +
          `Each pick MUST be a COMPLETE, MEANINGFUL SENTENCE (roughly 8-22 words) that stands on its own â€” ` +
          `NEVER a single word, a bare term, or a short fragment. ` +
          `For each chosen, list 1-3 important words to HIGHLIGHT in yellow (each must literally appear in that sentence). ` +
          `Return STRICT JSON {"quotes":[{"index":number,"highlights":string[]}]}.\n\n` +
          indexed,
        maxTokens: 500,
        temperature: 0.4,
      });
      picks = (res.quotes ?? [])
        .filter((q) => typeof q.index === "number" && timings[q.index])
        .slice(0, maxN)
        .map((q) => ({ index: q.index as number, highlights: Array.isArray(q.highlights) ? q.highlights : [] }));
    } catch (e) {
      ctx.log(`quote_overlays: selection failed (${e instanceof Error ? e.message : e})`);
    }

    // GUARANTEE the explicit philosopher quotes get on-screen cards: prepend any
    // sentence that names a philosopher AND reads as a quotation. Dedup by index,
    // keep within maxN. (script_gen weaves in â‰¥2 attributed quotes.)
    const PHILO = /\b(Marcus Aurelius|Aurelius|Seneca|Epictetus|Zeno|Chrysippus|Cato|Diogenes|Socrates|Plato|Aristotle)\b/;
    const QUOTED = /["â€œâ€']|(\b(said|wrote|words|reminds us|put it|taught)\b)/i;
    const philoIdx = timings
      .map((t, i) => ({ i, t }))
      .filter(({ t }) => PHILO.test(t.text) && QUOTED.test(t.text))
      .map(({ i }) => ({ index: i, highlights: [] as string[] }));
    if (philoIdx.length) {
      const seen = new Set<number>();
      picks = [...philoIdx, ...picks].filter((p) => (seen.has(p.index) ? false : (seen.add(p.index), true)));
    }
    // sort by time so overlays appear in narration order, then cap
    picks = picks.sort((a, b) => a.index - b.index).slice(0, Math.max(maxN, Math.min(philoIdx.length, 4)));

    // FLOOR GUARANTEE â€” quote cards (with their gradual blur) must reliably appear,
    // not "randomly get skipped" when the Director under-picks. If we're short of
    // maxN, backfill with heuristically-quotable sentences (6-22 words, not a
    // transitional/question line) spread evenly across the video.
    const TARGET = Math.min(maxN, timings.length);
    if (picks.length < TARGET) {
      const have = new Set(picks.map((p) => p.index));
      const quotable = (s: string) => {
        const w = s.split(/\s+/).filter(Boolean).length;
        return (
          w >= 6 && w <= 22 && !s.includes("?") &&
          !/^(and|but|so|then|now|today|in|this|that|these|those|here|when|while|because|however|also)\b/i.test(s.trim())
        );
      };
      const pool = timings
        .map((t, i) => ({ i, text: t.text }))
        .filter((x) => !have.has(x.i) && quotable(x.text));
      const need = TARGET - picks.length;
      if (pool.length > 0) {
        const step = pool.length / need;
        for (let k = 0; k < need; k++) {
          const pick = pool[Math.min(pool.length - 1, Math.floor(k * step))];
          if (pick && !have.has(pick.i)) { picks.push({ index: pick.i, highlights: [] }); have.add(pick.i); }
        }
        picks = picks.sort((a, b) => a.index - b.index);
        ctx.log(`quote_overlays: backfilled to ${picks.length} candidate(s) (Director picked fewer than ${TARGET})`);
      }
    }

    // Show only the QUOTED span when present (e.g. just the words inside the
    // quotation marks, not the "As Seneca wrote, â€¦. This isn'tâ€¦" wrapper), and
    // GATE quotes that are too long to fit a card legibly.
    const MAX_QUOTE_CHARS = Number(ctx.params["maxQuoteChars"] ?? 140);
    const MAX_QUOTE_WORDS = Number(ctx.params["maxQuoteWords"] ?? 24);
    // Quotes must be a meaningful SENTENCE, not a bare term/fragment.
    const MIN_QUOTE_WORDS = Number(ctx.params["minQuoteWords"] ?? 6);
    const extractQuote = (s: string): string => {
      // Prefer DOUBLE quotes (apostrophes inside contractions don't interfere).
      let m = s.match(/["â€œâ€]\s*([^"â€œâ€]{6,}?)\s*["â€œâ€]/);
      if (m) return m[1].trim();
      // SINGLE quotes only when used as real quote marks (boundary-delimited), so
      // an apostrophe in "It's" never splits the quote mid-word.
      m = s.match(/(?:^|[\s,:â€”-])['â€˜]\s*(.+?)\s*['â€™](?=[\s.,!?;:)]|$)/);
      if (m) return m[1].trim();
      return s.trim();
    };

    // PHASE 1 â€” build timed candidates (gated for length + synced to speech).
    type Cand = { idx: number; display: string; words: number; startSec: number; dur: number; highlights: string[] };
    // TAIL CLAMP: overlays composite AFTER the outro card is placed, so a card
    // running past the narration would blur/cover the outro. End by narration
    // end (+0.5s grace); a card that can't fit its minimum blur ease is skipped.
    const narrEndAbs = introSec + (timings[timings.length - 1]?.end ?? 0);
    const cands: Cand[] = [];
    for (const p of picks) {
      const t = timings[p.index];
      const display = extractQuote(t.text);
      const words = display.split(/\s+/).filter(Boolean).length;
      if (words < MIN_QUOTE_WORDS) {
        ctx.log(`quote_overlays: GATED (too short: ${words} words, need â‰¥${MIN_QUOTE_WORDS}) "${display.slice(0, 40)}â€¦"`);
        continue;
      }
      if (display.length > MAX_QUOTE_CHARS || words > MAX_QUOTE_WORDS) {
        ctx.log(`quote_overlays: GATED (too long: ${display.length} chars / ${words} words) "${display.slice(0, 40)}â€¦"`);
        continue;
      }
      // SYNC the card to when the QUOTE is actually spoken (it's spoken partway
      // through the sentence, after e.g. "As Seneca wrote,").
      const sentDur = Math.max(0.1, t.end - t.start);
      const ci = Math.max(0, t.text.indexOf(display));
      const startFrac = ci / Math.max(1, t.text.length);
      const spokenDur = (display.length / Math.max(1, t.text.length)) * sentDur;
      const cardStart = introSec + t.start + startFrac * sentDur - 0.3;
      // floor 4.5s so the slow blur has room to ease fully in, hold, then ease out
      let dur = Math.min(12, Math.max(5, Math.max(words * 0.42 + 2, spokenDur + 2.2)));
      const startSec = Math.max(introSec + t.start, cardStart);
      dur = Math.min(dur, Math.max(0, narrEndAbs + 0.5 - startSec));
      if (dur < 4.5) {
        ctx.log(`quote_overlays: skipped (would run past the narration into the outro) "${display.slice(0, 36)}â€¦"`);
        continue;
      }
      if (clashesCard(startSec, startSec + dur)) {
        ctx.log(`quote_overlays: skipped (overlaps a chapter card) "${display.slice(0, 36)}â€¦"`);
        continue;
      }
      cands.push({
        idx: p.index,
        display,
        words,
        startSec,
        dur,
        highlights: p.highlights.filter((h) => display.toLowerCase().includes(h.toLowerCase())),
      });
    }

    // PHASE 2 â€” enforce a MINIMUM GAP between cards so they never overlap or
    // crowd each other (â‰¥5s between the end of one and the start of the next).
    const MIN_GAP = Number(ctx.params["minQuoteGapSec"] ?? 5);
    cands.sort((a, b) => a.startSec - b.startSec);
    const spaced: Cand[] = [];
    let lastEnd = -Infinity;
    for (const c of cands) {
      if (c.startSec >= lastEnd + MIN_GAP) {
        spaced.push(c);
        lastEnd = c.startSec + c.dur;
      } else {
        ctx.log(`quote_overlays: dropped (needs â‰¥${MIN_GAP}s gap) "${c.display.slice(0, 30)}â€¦"`);
      }
    }

    // PHASE 2b â€” REFILL: if spacing left us under target (Director picks clustered
    // and got dropped), add well-separated filler quotes from OTHER quotable
    // sentences so cards reliably reach maxN â€” they must not "randomly" thin out.
    // attributedOnly channels SKIP the refill: a quote card is an attributed
    // event ("Buffett saidâ€¦"), never a rhetorical script line dressed as one.
    const attributedOnly = ctx.params["attributedOnly"] === true;
    const TARGET2 = Math.min(maxN, timings.length);
    if (attributedOnly && spaced.length < TARGET2) {
      ctx.log(`quote_overlays: attributedOnly â€” ${spaced.length}/${TARGET2} attributed quotes, refill skipped (quotes are events, not wallpaper)`);
    }
    if (!attributedOnly && spaced.length < TARGET2) {
      const usedIdx = new Set(spaced.map((c) => c.idx));
      const isQuotable = (s: string) => {
        const w = s.split(/\s+/).filter(Boolean).length;
        return (
          w >= Math.max(MIN_QUOTE_WORDS, 7) && w <= MAX_QUOTE_WORDS && !s.includes("?") &&
          !/^(and|but|so|then|now|today|in|this|that|these|those|here|when|while|because|however|also)\b/i.test(s.trim())
        );
      };
      const fits = (c: Cand) =>
        spaced.every((p) => c.startSec >= p.startSec + p.dur + MIN_GAP || c.startSec + c.dur <= p.startSec - MIN_GAP);
      const fillers: Cand[] = [];
      for (let i = 0; i < timings.length; i++) {
        if (usedIdx.has(i)) continue;
        const t = timings[i];
        const display = extractQuote(t.text);
        const words = display.split(/\s+/).filter(Boolean).length;
        if (!isQuotable(display) || display.length > MAX_QUOTE_CHARS || words > MAX_QUOTE_WORDS) continue;
        const sentDur = Math.max(0.1, t.end - t.start);
        const ci = Math.max(0, t.text.indexOf(display));
        const startFrac = ci / Math.max(1, t.text.length);
        const spokenDur = (display.length / Math.max(1, t.text.length)) * sentDur;
        const cardStart = introSec + t.start + startFrac * sentDur - 0.3;
        let dur = Math.min(12, Math.max(5, Math.max(words * 0.42 + 2, spokenDur + 2.2)));
        const startSec = Math.max(introSec + t.start, cardStart);
        dur = Math.min(dur, Math.max(0, narrEndAbs + 0.5 - startSec)); // tail clamp (see PHASE 1)
        if (dur < 4.5) continue;
        if (clashesCard(startSec, startSec + dur)) continue; // never near a chapter card
        fillers.push({ idx: i, display, words, startSec, dur, highlights: [] });
      }
      fillers.sort((a, b) => a.startSec - b.startSec);
      for (const f of fillers) {
        if (spaced.length >= TARGET2) break;
        if (fits(f)) {
          spaced.push(f);
          ctx.log(`quote_overlays: refilled "${f.display.slice(0, 30)}â€¦" @ ${f.startSec.toFixed(1)}s (reach ${spaced.length}/${TARGET2})`);
        }
      }
      spaced.sort((a, b) => a.startSec - b.startSec);
    }

    // PHASE 3 â€” render the spaced selection.
    const tmp = await makeRunTempDir(ctx.runId);
    for (const c of spaced) {
      try {
        const path = join(tmp, `quote_${c.idx}.webm`);
        await renderQuoteOverlay({ quote: c.display, highlights: c.highlights, outPath: path, durationSec: c.dur, width: W, height: H });
        // RENDER-SPLIT CONTRACT: timeline_assemble runs on a SEPARATE worker, so
        // a local-only path is unreachable there — that was the root cause of the
        // "N quotes generated but 0 composited" heal treadmill (every heal re-ran
        // on a machine that still lacked the files). R2-back each card and carry
        // the key; the compose pass re-downloads what isn't local.
        const key = `${ctx.keyPrefix}runs/${ctx.runId}/quote_${c.idx}.webm`;
        await putObject(key, await readBytes(path), { contentType: "video/webm" });
        out.push({ path, key, startSec: c.startSec, durSec: c.dur, text: c.display, highlights: c.highlights, width: W, height: H });
        ctx.log(`quote_overlays: "${c.display.slice(0, 50)}â€¦" @ ${c.startSec.toFixed(1)}s (${c.words}w, ${c.dur.toFixed(1)}s)`);
      } catch (e) {
        ctx.log(`quote_overlays: render failed for #${c.idx} (${e instanceof Error ? e.message : e})`);
      }
    }
    ctx.log(`quote_overlays: ${out.length} overlay(s) ready (â‰¥${MIN_GAP}s apart)`);
    return { quoteOverlays: out };
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
  produces: [
    "videoKey",
    "videoLocalPath",
    "videoDurationSec",
    "quotesApplied",
    "insertsApplied",
    "captionsApplied",
    "captionCues",
    "outroApplied",
    "overlaysDropped",
    "preOverlayKey",
    "preOverlayLocalPath",
  ],
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
    const audioFadeOutSec = Number(ctx.params["audioFadeOutSec"] ?? fadeOutSec);
    const videoSec = introSec + narrationSec + tailSec;

    // EARLY LENGTH GATE: videoSec is the EXACT runtime this block is about to
    // render. If it already lands outside the channel's [minSeconds, maxSeconds]
    // band, abort HERE — before the multi-minute Remotion render + encode —
    // instead of rendering in full only for the post-render length_check to
    // reject it. Quality-neutral (an off-length video fails the hard gate
    // either way); this just stops paying ~$0.5-0.7 of render compute per
    // reject. TOL absorbs caption/overlay rounding so it never trips a video
    // that would have passed (passing ⇒ actual≈videoSec ∈ [min,max]).
    {
      const lcMin = Number(ctx.params["minSeconds"] ?? 0);
      const lcMax = Number(ctx.params["maxSeconds"] ?? 0);
      const TOL = 30;
      if (lcMax > 0 && videoSec > lcMax + TOL) {
        throw new Error(
          `length_precheck FAILED: projected ${Math.round(videoSec)}s > max ${lcMax}s — narration too long; aborting before render`,
        );
      }
      if (lcMin > 0 && videoSec < lcMin - TOL) {
        throw new Error(
          `length_precheck FAILED: projected ${Math.round(videoSec)}s < min ${lcMin}s — narration too short; aborting before render`,
        );
      }
    }

    const tmp = await makeRunTempDir(ctx.runId);

    // SURGICAL HEAL â€” when the self-healer re-runs this block for an
    // overlay/caption-class defect (cards, captions, inserts â€” anything the
    // finishing pass owns), re-finish from the persisted PRE-OVERLAY video
    // instead of rebuilding the whole body: a ~40-min full re-compose becomes a
    // single ~4-min finishing encode. Footage/black/dead-air defects still get
    // the full rebuild (their fix lives in the body).
    // healHints is a Record<blockId, string[]> (healer.ts) — the old read
    // treated it as string[]/string, producing "[object Object]" and silently
    // disabling the surgical heal FOREVER (every overlay heal paid the full
    // ~40-min recompose). Read this block's own hints, tolerate legacy shapes.
    const healHintsRaw = ctx.store["healHints"] as
      | Record<string, string[]>
      | string[]
      | string
      | undefined;
    const healHintsArr: string[] = Array.isArray(healHintsRaw)
      ? healHintsRaw.map(String)
      : typeof healHintsRaw === "string"
        ? [healHintsRaw]
        : healHintsRaw && typeof healHintsRaw === "object"
          ? (healHintsRaw["timeline_assemble"] ?? []).map(String)
          : [];
    const healHints = healHintsArr.join(" | ");
    const overlayClassHeal =
      healHints.length > 0 &&
      /overlay|caption|quote|insert|card text|outro text/i.test(healHints) &&
      !/black|dead.?air|footage|off.?world|cut|loop|duration|length/i.test(healHints);
    if (overlayClassHeal) {
      try {
        const preKey = `${ctx.keyPrefix}runs/${ctx.runId}/pre_overlay.mp4`;
        const preBytes = await getObjectBytes(preKey);
        const prePath = join(tmp, "pre_overlay.mp4");
        await writeBytes(prePath, preBytes);
        const preDur = (await probe(prePath)).durationSec || videoSec;
        ctx.log(`timeline_assemble: SURGICAL HEAL â€” re-finishing from pre-overlay (${preDur.toFixed(1)}s) instead of full rebuild. Hints: ${healHints.slice(0, 160)}`);
        // The pre-overlay video already contains the folded outro (it is the
        // compose output), so outroApplied mirrors the original build.
        return await finishFromComposed(ctx, prePath, tmp, { W, H, introSec, videoSec: preDur, outroApplied: tailSec >= 2 });
      } catch (e) {
        ctx.log(`timeline_assemble: surgical heal unavailable (${e instanceof Error ? e.message : e}) â€” full rebuild`);
      }
    }

    // Beat-aligned body: clips cut on sentence beats (changes with the narration,
    // no global loop), built one clip per pass (memory-flat â€” concatScaled OOM'd
    // with many clips). Covers narration+tail (+buffer) so the composer won't loop.
    const beats = (ctx.store["sentenceTimings"] as { end: number }[] | undefined)?.map((s) => s.end) ?? [];
    // EDITOR BRAIN: the Editor crew's cutSheet drives the cut cadence â€” a
    // channel cut at 6 cuts/min gets ~10s segments, a contemplative one at
    // 2 cuts/min holds shots ~30s. Same shared calc as stock_footage's
    // coverage credit so the pool always covers the body at this cadence.
    const cutSheet = getCutSheet(ctx.store);
    const bodyMaxSeg = bodySegSeconds(narrationSec, cutSheet);
    ctx.log(`timeline_assemble: per-clip screen time ${bodyMaxSeg}s${cutSheet?.sections?.length ? " (editor cutSheet cadence)" : ""}`);

    // CHAPTER MODE â€” narration_tts emitted a chapterPlan (alternating card/footage
    // windows). Render each heading as a card and splice it into the body so it
    // shows WHILE the heading is read out, then fades and footage resumes.
    const chapterPlan = ctx.store["chapterPlan"] as
      | { kind: "footage" | "card"; durSec: number; heading?: string }[]
      | undefined;
    let concat: string;
    // BRAND bg for chapter + outro cards: the channel's avatar, not the baked
    // stoic bust (the outro card was the last bust hold-out â€” seen live on the
    // Investory trial render).
    let brandCardBg = join(process.cwd(), "src/assets/intro_bust.jpg");
    const brandAvatarKey = ctx.store["channelAvatarKey"] as string | undefined;
    if (brandAvatarKey) {
      try {
        brandCardBg = await writeBytes(join(tmp, "brand_card_bg.png"), await getObjectBytes(brandAvatarKey));
      } catch { /* default bust */ }
    }

    if (chapterPlan && chapterPlan.length > 0) {
      ctx.log(`timeline_assemble: chapter mode â€” ${chapterPlan.filter((w) => w.kind === "card").length} chapter cards`);
      const chapBg = brandCardBg;
      let chapNo = 0;
      const windows: { kind: "footage" | "card"; durSec: number; cardPath?: string }[] = [];
      for (const w of chapterPlan) {
        if (w.kind === "card") {
          chapNo++;
          let cardPath: string | undefined;
          try {
            cardPath = join(tmp, `chap_${chapNo}.mp4`);
            await renderTitleCard({
              title: w.heading ?? `Part ${chapNo}`,
              subtitle: `Chapter ${chapNo}`,
              outPath: cardPath,
              durationSec: Math.max(2, w.durSec),
              width: W,
              height: H,
              bgImagePath: chapBg,
              chapter: true, // gently fade in from black / out to black on both ends
            });
          } catch (e) {
            cardPath = undefined; // card render failed â†’ fall back to footage for this window
            ctx.log(`timeline_assemble: chapter card ${chapNo} render failed: ${e instanceof Error ? e.message : e}`);
          }
          windows.push({ kind: cardPath ? "card" : "footage", durSec: w.durSec, cardPath });
        } else {
          windows.push({ kind: "footage", durSec: w.durSec });
        }
      }
      concat = await assembleStructuredBody({
        windows,
        clipPaths: clips,
        outPath: join(tmp, "body.mp4"),
        tmpDir: tmp,
        width: W,
        height: H,
        maxSegSec: bodyMaxSeg,
      });
    } else {
      ctx.log(`timeline_assemble: beat-body from ${clips.length} clips (${footage.length} footage + ${entity.length} entity) @ ${W}x${H}â€¦`);
      concat = await assembleBeatBody({
        clipPaths: clips,
        outPath: join(tmp, "body.mp4"),
        targetSec: narrationSec + tailSec + 3,
        tmpDir: tmp,
        beats,
        width: W,
        height: H,
        // per-clip screen time matches stock_footage's coverage credit (PER_CLIP=25)
        // so the gathered footage fills the full length without the body looping.
        maxSegSec: bodyMaxSeg,
      });
    }

    // Music bed (full during the intro, ducked low under narration). Prefer the
    // R2 copy (musicKey = the mastered mix, never expires); provider URL is the
    // legacy fallback.
    const musicKey = opt(ctx, "musicKey");
    let musicPath: string;
    if (musicKey) {
      const { writeFile } = await import("node:fs/promises");
      musicPath = join(tmp, "music.mp3");
      await writeFile(musicPath, await getObjectBytes(musicKey));
    } else {
      musicPath = await downloadTo(str(ctx, "musicUrl"), join(tmp, "music.mp3"));
    }

    // DEFINED OUTRO â€” the script's closing line + channel sign-off, rendered
    // BEFORE the compose and FOLDED into its single filter graph (xfade across
    // the tail). The old post-hoc patchSegment path paid an ENTIRE second
    // full-video x264 pass for a 3-second change, and its probe-based anchor
    // was a standing drift risk. The xfade offset (total - tail) is exact in
    // every mode because the compose graph itself defines the total.
    let outroCardPath: string | undefined;
    if (tailSec >= 2) {
      try {
        const sc = ctx.store["script"] as { closingLine?: string } | undefined;
        // Neutral fallback â€” "Master your mind." was a stoic-channel default
        // that leaked onto every channel without a closingLine.
        const closing = (sc?.closingLine || "").trim() || "Until next time.";
        const chName = (ctx.store["channelName"] as string | undefined) ?? "";
        const oc = join(tmp, "outro.mp4");
        await renderTitleCard({
          title: closing,
          subtitle: chName,
          outPath: oc,
          durationSec: tailSec,
          width: W,
          height: H,
          bgImagePath: brandCardBg,
          outro: true,
        });
        outroCardPath = oc;
        ctx.log(`timeline_assemble: outro card ready — folded into the compose over the ${tailSec}s tail ("${closing}")`);
      } catch (e) {
        ctx.log(`timeline_assemble: outro card render failed (plain tail): ${e instanceof Error ? e.message : e}`);
      }
    }

    ctx.log(
      `timeline_assemble: compose intro ${introSec}s + narration ${narrationSec}s + ${tailSec}s tail â†’ ${videoSec}sâ€¦`,
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
      audioFadeOutSec,
      width: W,
      height: H,
      // music bed a further 5% quieter (intro 0.54â†’0.513, under-voice 0.108â†’0.1026)
      introMusicVol: Number(ctx.params["introMusicVol"] ?? 0.513),
      bodyMusicVol: Number(ctx.params["bodyMusicVol"] ?? 0.1026),
      // slower, gentler duck into/out of the narration bed
      musicDuckRampSec: Number(ctx.params["musicDuckRampSec"] ?? 4),
      outroCardPath,
      outroFadeInSec: 1.2,
    });

    return await finishFromComposed(ctx, out, tmp, {
      W, H, introSec, videoSec,
      outroApplied: Boolean(outroCardPath),
    });
  },
};

/**
 * FINISHING PASS (shared by the full build and the surgical heal): burn
 * captions + composite every overlay card in ONE filter graph / ONE x264
 * encode, persist final + pre-overlay videos, return the block patch. The old
 * sequence (caption burn + one full re-encode PER overlay) cost 2 quotes +
 * 3 inserts = 6 full-length passes on a 14-min video â€” the dominating
 * assembly cost. Falls back to the proven sequential path on any failure.
 */
async function finishFromComposed(
  ctx: StageContext,
  composed: string,
  tmp: string,
  o: { W: number; H: number; introSec: number; videoSec: number; outroApplied?: boolean },
): Promise<Record<string, unknown>> {
  const { W, H, introSec, videoSec } = o;
  const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 60;
  const footage = (ctx.store["footageClips"] as string[] | undefined) ?? [];
  const tailSec = Number(ctx.params["tailSec"] ?? 3);
  const bodyEnd = Math.max(0, videoSec - tailSec);

  // MATERIALIZE every overlay on THIS worker + clamp to the body window.
  // The render-split child (and any heal on a fresh machine) receives specs
  // whose `path` points at another machine's tmp dir — the exact root cause of
  // "N generated but 0 composited" → heal treadmill → failed run. Order:
  // local file → re-download from the spec's R2 `key` → (quotes only)
  // re-render from the spec text → DROP with a typed warning. Overlays are
  // also clamped so none ever covers the outro-card tail window.
  let overlaysDropped = 0;
  const materialize = async (specs: QuoteOverlaySpec[], kind: string): Promise<QuoteOverlaySpec[]> => {
    const ready: QuoteOverlaySpec[] = [];
    for (let i = 0; i < specs.length; i++) {
      const s = { ...specs[i] };
      if (s.startSec >= bodyEnd - 1) {
        overlaysDropped++;
        ctx.log(`timeline_assemble: DROPPED ${kind} overlay @${s.startSec.toFixed(1)}s — inside the outro tail window`);
        continue;
      }
      if (s.startSec + s.durSec > bodyEnd) s.durSec = Math.max(2, bodyEnd - s.startSec);
      if (!existsSync(s.path) && s.key) {
        try {
          const p = join(tmp, `ovl_${kind}_${i}.webm`);
          await writeBytes(p, await getObjectBytes(s.key));
          s.path = p;
        } catch (e) {
          ctx.log(`timeline_assemble: ${kind} overlay R2 fetch failed (${e instanceof Error ? e.message : e})`);
        }
      }
      if (!existsSync(s.path) && kind === "quote" && s.text) {
        try {
          const p = join(tmp, `ovl_rerender_${i}.webm`);
          await renderQuoteOverlay({ quote: s.text, highlights: s.highlights ?? [], outPath: p, durationSec: s.durSec, width: s.width ?? W, height: s.height ?? H });
          s.path = p;
          ctx.log(`timeline_assemble: quote overlay re-rendered from spec on this worker`);
        } catch (e) {
          ctx.log(`timeline_assemble: quote re-render failed (${e instanceof Error ? e.message : e})`);
        }
      }
      if (!existsSync(s.path)) {
        overlaysDropped++;
        ctx.log(`timeline_assemble: WARNING — ${kind} overlay unavailable on this worker (no local file, no restorable key) — DROPPED`);
        continue;
      }
      ready.push(s);
    }
    return ready;
  };
  const quotes = await materialize((ctx.store["quoteOverlays"] as QuoteOverlaySpec[] | undefined) ?? [], "quote");
  // Script-synced data-viz inserts (visual_inserts) ride the SAME alpha-
  // compositing pass; FORGED modules (architect-authored) emit here too.
  const inserts = await materialize((ctx.store["insertOverlays"] as QuoteOverlaySpec[] | undefined) ?? [], "insert");
  const forgedOv = await materialize((ctx.store["extraOverlays"] as QuoteOverlaySpec[] | undefined) ?? [], "forged");

  let assPath: string | null = null;
  let cueCount = 0;
  let preparedCues: { startSec: number; endSec: number; text: string }[] = [];
  if (ctx.params["burnCaptions"] !== false) {
    const capTimings = ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined;
    if (capTimings && capTimings.length > 0) {
      try {
        const pad = 0.2;
        const qWindows = quotes.map((q) => [q.startSec - pad, q.startSec + q.durSec + pad] as [number, number]);
        // Captions must hide under EVERY overlay that draws in their region —
        // quote cards AND data inserts AND forged overlays (inserts previously
        // blurred/overdrew live captions: text on text).
        const iWindows = [...inserts, ...forgedOv].map((q) => [q.startSec - pad, q.startSec + q.durSec + pad] as [number, number]);
        // Hide captions only while the chapter HEADING is actually read â€” NOT the
        // 3s silent pre/post gaps (no captions there anyway). Insetting by the
        // gaps stops the wide window from clipping adjacent narration captions.
        const preGap = Number(ctx.params["chapterPreSec"] ?? 3);
        const postGap = Number(ctx.params["chapterPostSec"] ?? 3);
        const cWindows = chapterCardWindows(
          ctx.store["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined,
          introSec,
        )
          .map((w) => [w.start + preGap - 0.3, Math.max(w.start + preGap, w.end - postGap) + 0.3] as [number, number])
          .filter(([a, b]) => b > a);
        const blocked = [...qWindows, ...iWindows, ...cWindows];
        const cues = captionCuesFromTimings(capTimings, introSec).filter(
          (c) => !blocked.some(([a, b]) => c.endSec > a && c.startSec < b),
        );
        cueCount = cues.length;
        preparedCues = cues;
        assPath = await writeCaptionsAss(cues, tmp, { width: W, height: H });
        ctx.log(`timeline_assemble: ${cues.length} caption cue(s) prepared (hidden during ${quotes.length} quote + ${inserts.length + forgedOv.length} insert/forged + ${cWindows.length} chapter card(s))`);
      } catch (e) {
        ctx.log(`timeline_assemble: caption prep failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  let finalVideo = composed;
  let quotesApplied = 0;
  let insertsApplied = 0;
  let captionsApplied = false;
  const allOverlays = [...quotes, ...inserts, ...forgedOv].sort((a, b) => a.startSec - b.startSec);
  if (allOverlays.length > 0 || assPath) {
    const finished = join(tmp, "video_finished.mp4");
    try {
      await applyOverlaysAndCaptions(composed, allOverlays, assPath, finished, { blurSigma: 20 });
      finalVideo = finished;
      // HONEST counts: what actually entered the successful filter graph — not
      // the planned totals (the QA feature-presence gate trusts these).
      quotesApplied = quotes.length;
      insertsApplied = inserts.length;
      captionsApplied = Boolean(assPath);
      ctx.log(`timeline_assemble: SINGLE-PASS finished â€” ${cueCount} caption cue(s) + ${quotesApplied} quote(s) + ${insertsApplied} insert(s) in one encode`);
    } catch (e) {
      ctx.log(`timeline_assemble: single-pass finish failed â€” sequential fallback: ${e instanceof Error ? e.message : e}`);
      try {
        let base = composed;
        if (preparedCues.length > 0) {
          const capPath = join(tmp, "video_captioned.mp4");
          await burnCaptions(base, preparedCues, capPath, { tmpDir: tmp, width: W, height: H });
          base = capPath;
          captionsApplied = true;
        }
        if (allOverlays.length > 0) {
          const withQuotes = join(tmp, "video_quotes.mp4");
          await applyQuoteOverlays(base, allOverlays, withQuotes, { blurSigma: 20 });
          base = withQuotes;
          quotesApplied = quotes.length;
          insertsApplied = inserts.length;
        }
        finalVideo = base;
        ctx.log(`timeline_assemble: sequential fallback composited ${quotesApplied} quote(s) + ${insertsApplied} insert(s)`);
      } catch (e2) {
        // Loud: feature_qa cross-checks quotesApplied vs expected and fails.
        ctx.log(`timeline_assemble: ERROR overlay compositing FAILED (clean video): ${e2 instanceof Error ? e2.message : e2}`);
      }
    }
  }

  // FINAL LOUDNESS — audio-only measured linear loudnorm (video stream
  // copied, no x264 pass). Shipped mixes previously carried whatever loudness
  // the TTS/music happened to produce; this pins every video to one target.
  try {
    const norm = join(tmp, "video_norm.mp4");
    const target = Number(ctx.params["targetLufs"] ?? -14);
    await normalizeAudioOnly(finalVideo, norm, target);
    finalVideo = norm;
    ctx.log(`timeline_assemble: final mix loudness-normalized to ${target} LUFS (audio-only pass)`);
  } catch (e) {
    ctx.log(`timeline_assemble: loudnorm skipped (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
  await putObject(videoKey, await readBytes(finalVideo), { contentType: "video/mp4" });
  // Persist the PRE-OVERLAY composed video (body + outro, NO captions/cards) so
  // the surgical heal can re-finish without re-rendering the whole timeline.
  // If the upload fails, BLANK the key+path: an advertised R2 key whose object
  // doesn't exist makes rehydrate (resume + the render-split child) report a
  // hard failure for the WHOLE block — re-rendering needlessly. preOverlay is
  // heal-only, so a blank just means "heal does a full rebuild" (safe).
  let preOverlayKey = `${ctx.keyPrefix}runs/${ctx.runId}/pre_overlay.mp4`;
  let preOverlayLocalPathOut = composed;
  try {
    await putObject(preOverlayKey, await readBytes(composed), { contentType: "video/mp4" });
  } catch (e) {
    ctx.log(`timeline_assemble: pre-overlay save failed (surgical heal unavailable): ${e instanceof Error ? e.message : e}`);
    preOverlayKey = "";
    preOverlayLocalPathOut = "";
  }
  await recordAsset(ctx, "video", videoKey, {
    durationSec: videoSec,
    narrationSec,
    introSec,
    quoteOverlays: quotes.length,
    source: "stock_footage",
    clips: footage.length,
  });
  ctx.log(`timeline_assemble ok: video ${videoSec}s (narration ${narrationSec}s, intro ${introSec}s, quotes ${quotesApplied}/${quotes.length}, captions ${captionsApplied ? cueCount : 0}, dropped overlays ${overlaysDropped})`);
  return {
    videoKey,
    videoLocalPath: finalVideo,
    videoDurationSec: videoSec,
    quotesApplied,
    insertsApplied,
    captionsApplied,
    captionCues: cueCount,
    outroApplied: o.outroApplied ?? false,
    overlaysDropped,
    preOverlayKey,
    // The composed body INCLUDING the outro â€” overlays re-apply on top of it.
    preOverlayLocalPath: preOverlayLocalPathOut,
  };
}

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
    ctx.log(`length_check ok: ${dur}s (bounds ${min}â€“${max})`);
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
    // No external dependency â€” works today (lands in the video description).
    const chaptersText = buildChapters(sections, narrationSec, introSec);
    if (chaptersText) ctx.log(`captions: ${chaptersText.split("\n").length} chapters`);

    // Captions (SRT) â€” built DETERMINISTICALLY from the ground-truth sentenceTimings
    // we already produced in narration_tts (chunked to short cues, shifted by the
    // intro offset). No more re-transcribing our OWN TTS audio via AssemblyAI (an
    // external poll-until-done service that could time out) â€” we already know the
    // exact words and their timing. No external dependency, instant, never flaky.
    let captionsKey = "";
    const capTimings = ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined;
    if (!capTimings?.length) {
      ctx.log("captions: no sentenceTimings â€” chapters only");
      return { captionsKey, chaptersText };
    }
    try {
      const cues = captionCuesFromTimings(capTimings, introSec);
      const toTs = (s: number) => {
        const ms = Math.max(0, Math.round(s * 1000));
        const p = (n: number, w = 2) => String(n).padStart(w, "0");
        return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
      };
      const srt = cues.map((c, i) => `${i + 1}\n${toTs(c.startSec)} --> ${toTs(c.endSec)}\n${c.text}`).join("\n\n") + "\n";
      captionsKey = `${ctx.keyPrefix}runs/${ctx.runId}/captions.srt`;
      await putObject(captionsKey, Buffer.from(srt, "utf8"), { contentType: "application/x-subrip" });
      await recordAsset(ctx, "captions", captionsKey, { cues: cues.length });
      ctx.log(`captions: SRT ${cues.length} cues from ground-truth timings â†’ ${captionsKey}`);
    } catch (e) {
      ctx.log(`captions: SRT build failed (continuing, chapters only): ${e instanceof Error ? e.message : e}`);
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

    // 1) Structural + resolution (hard) â€” never ship a broken file.
    const p = await probe(video);
    if (!p.hasVideo || !p.hasAudio || p.durationSec < 1) {
      throw new Error(
        `qa_visual FAILED (structural): video=${p.hasVideo} audio=${p.hasAudio} dur=${p.durationSec}s`,
      );
    }
    if ((p.width ?? 0) < 640 || (p.height ?? 0) < 360) {
      throw new Error(`qa_visual FAILED (resolution): ${p.width}x${p.height}`);
    }

    // 2) Script â†” film length: narration sets the target for narrated archetypes.
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

    // 3b) HOLISTIC WATCH â€” the reliable core of post-render QA. One intent-grounded
    // reviewer watches the FULL timeline (guaranteed first frame = title card, last =
    // outro card) instead of 3 blind spot-checks + boolean presence flags. This is
    // what catches the real defects the legacy checks missed: a missing title card,
    // a mid-video / empty outro, a missing or mis-numbered chapter, irrelevant inserts,
    // duplicate clips, and broken/obscured overlays. (The per-frame checks above are
    // now superseded by this; kept only as cheap advisory signals.)
    // AUDIO QA (advisory, opt-in â€” the ear vision QA never had): Meta's
    // audiobox-aesthetics scores production quality/enjoyment of the final
    // audio. Music channels default it on (audio IS the product).
    if (ctx.params["audioQa"] === true) {
      try {
        const { scoreAudio } = await import("@/lib/audioQa");
        const tmpA = await makeRunTempDir(ctx.runId);
        const aq = await scoreAudio(video, tmpA, p.durationSec, (m) => ctx.log(`qa_visual: ${m}`));
        if (aq && aq.productionQuality > 0 && aq.productionQuality < 5) {
          ctx.log(`qa_visual: LOW AUDIO production quality ${aq.productionQuality}/10 (ADVISORY â€” check the mix/mastering)`);
        }
      } catch (e) {
        ctx.log(`qa_visual: audio scoring skipped: ${e instanceof Error ? e.message : e}`);
      }
    }

    const watchDna = ctx.store["styleDNA"] as
      | { recurringSubject?: string; setting?: string; motifs?: string[] }
      | null;
    const watchIntent = {
      title,
      topic,
      niche: niche ?? undefined,
      expectTitleCard: ctx.store["introApplied"] === true,
      expectChapters: ctx.params["chapterCards"] === true,
      channelWorld: watchDna?.recurringSubject
        ? [watchDna.recurringSubject, watchDna.setting, ...(watchDna.motifs ?? []).slice(0, 4)]
            .filter(Boolean)
            .join("; ")
        : undefined,
    };
    // NATIVE FULL-WATCH is now OPT-IN (params.nativeWatch === true): uploading
    // the whole render for 2 Gemini video passes cost up to ~1.3M video tokens
    // on long-form, and its exclusive outputs (mood/pacing/musicFit) are
    // ADVISORY logs. The frame-sampled watch below + deterministic audio
    // meters (validateAudioCoverage, ebur128) cover everything that gates.
    let watch: Awaited<ReturnType<typeof watchRender>> & {
      moodMatch?: number; pacing?: number; musicFit?: number;
    } | null = null;
    if (ctx.params["nativeWatch"] === true) {
      watch = await nativeWatchRender(video, p.durationSec, watchIntent, { log: ctx.log });
      if (watch?.moodMatch !== undefined || watch?.musicFit !== undefined) {
        const low = [
          (watch.moodMatch ?? 10) < 6 ? `mood coherence ${watch.moodMatch}/10` : "",
          (watch.pacing ?? 10) < 6 ? `pacing ${watch.pacing}/10` : "",
          (watch.musicFit ?? 10) < 6 ? `music fit ${watch.musicFit}/10` : "",
        ].filter(Boolean);
        if (low.length) ctx.log(`qa_visual: LOW FEEL SCORES (ADVISORY): ${low.join(", ")} â€” ${watch.summary.slice(0, 120)}`);
      }
    }
    if (!watch) {
      watch = await watchRender(video, p.durationSec, watchIntent, { runId: ctx.runId, log: ctx.log });
    }

    // 4) Thumbnail (vision, separate) â€” download from R2.
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

    // 5) Stock-footage appropriateness: DROPPED as a QA re-check. Relevance is
    // enforced at the SOURCE (stock_footage gateClip + evergreen fallback) and
    // this verdict was advisory-only (logged, never gated) — pure vision spend.
    const footage: Verdict = { score: 10, issues: [], skipped: true };

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
      watch: { ran: watch.ran, verdict: watch.verdict, defects: watch.defects, summary: watch.summary },
    };

    // Hard-gate on egregious VISUAL defects (video frames + thumbnail). Footage
    // relevance is enforced at the SOURCE (stock_footage gate + evergreen
    // fallback), so here it's ADVISORY â€” a single borderline clip must not nuke a
    // fully-rendered, paid video. SEO/identity are advisory too (logged).
    const critical: string[] = [];
    // TITLE-CARD TRUCE: when the shipped thumbnail is the DELIBERATE
    // deterministic title card (operator choice or the fal-route degrade), the
    // vision judge's clickbait rubric must not gate it — it scored a clean,
    // correctly-spelled card 2/10 and the heal loop then regenerated the SAME
    // card to exhaustion (observed live: a finished $1.2 run died healing a
    // cosmetic verdict about a card that was working as designed).
    const thumbStrategy = String(ctx.store["strategy"] ?? "");
    const thumbIsDeliberateCard =
      thumbStrategy === "title_card_fallback" || String(ctx.store["thumbnailer"] ?? "") === "title_card";
    for (const [name, v] of [
      ["video", video_],
      ["thumbnail", thumbnail],
    ] as const) {
      if (!v.skipped && v.score < 4) {
        if (name === "thumbnail" && thumbIsDeliberateCard) {
          ctx.log(`qa_visual: thumbnail ${v.score}/10 on a deliberate title card (ADVISORY, not gating): ${v.issues.slice(0, 2).join("; ")}`);
          continue;
        }
        critical.push(`${name} score ${v.score}: ${v.issues.slice(0, 2).join("; ")}`);
      }
    }
    if (!footage.skipped && footage.score < 5) {
      ctx.log(`qa_visual: LOW FOOTAGE score ${footage.score} (advisory): ${footage.issues.slice(0, 2).join("; ")}`);
    }
    // PRIMARY GATE = DETERMINISTIC validateRender (no LLM, never flaky): it decides
    // the hard pass/fail from signals + plan facts (dead-air/black segments, intro
    // presence). The Gemini holistic watch is ADVISORY ONLY now â€” its 503s must never
    // block a finished, paid render (that flakiness was the whole problem).
    const rv = await validateRender({
      videoPath: video,
      durationSec: p.durationSec,
      introSec: Number(ctx.store["introSec"] ?? 0),
      tailSec: Number(ctx.params["tailSec"] ?? 3),
      introApplied: ctx.store["introApplied"] === true,
      log: ctx.log,
    });
    if (rv.verdict === "fail") {
      critical.push(`render-validate: ${rv.defects.filter((d) => d.severity === "critical").map((d) => d.issue).join(" | ")}`);
    }
    if (watch.ran && watch.verdict === "fail") {
      // CRITICAL watch findings BLOCK â€” except TITLE/OUTRO-card text claims,
      // which are ADVISORY: the watcher mis-called cards twice in live trials
      // (claimed a frame-verified outro was "blank"; demanded the full SEO
      // title on the deliberately short intro card). Card PRESENCE is owned by
      // the deterministic introApplied/outro pipeline facts; black screens,
      // frozen frames and wrong-topic-throughout still block.
      const watchCritical = watch.defects.filter((d) => d.severity === "critical");
      const isCardClaim = (d: { category?: string; issue?: string }) =>
        /title\s*card|outro/i.test(`${d.category ?? ""} ${d.issue ?? ""}`);
      const blocking = watchCritical.filter((d) => !isCardClaim(d));
      const advisoryCards = watchCritical.filter(isCardClaim);
      if (blocking.length) {
        critical.push(
          `watch: ${blocking.slice(0, 4).map((d) => `[@${d.tSec ?? "?"}s] ${d.issue}`).join(" | ")}`,
        );
      }
      if (advisoryCards.length || !blocking.length) {
        ctx.log(`qa_visual: watch ADVISORY flagged (NOT blocking): ${[...advisoryCards, ...watch.defects.filter((d) => d.severity !== "critical")].slice(0, 6).map((d) => `[${d.severity}@${d.tSec ?? "?"}s] ${d.issue}`).join(" | ")}`);
      }
    }
    // FEATURE-PRESENCE gate â€” fail loud when an intended feature silently didn't
    // land (these were the "no thumbnail" / "no quotes" bugs). Assert the
    // artifacts we meant to ship actually exist.
    if (!opt(ctx, "thumbnailKey")) {
      critical.push("thumbnail missing: no thumbnailKey produced");
    }
    const quotesExpected = (ctx.store["quoteOverlays"] as unknown[] | undefined)?.length ?? 0;
    const quotesApplied = Number(ctx.store["quotesApplied"] ?? 0);
    if (quotesExpected > 0 && quotesApplied === 0) {
      critical.push(`quotes missing: ${quotesExpected} generated but 0 composited onto the video`);
    }
    const insertsExpected = (ctx.store["insertOverlays"] as unknown[] | undefined)?.length ?? 0;
    const insertsApplied = Number(ctx.store["insertsApplied"] ?? 0);
    if (insertsExpected > 0 && insertsApplied === 0) {
      critical.push(`data inserts missing: ${insertsExpected} rendered but 0 composited onto the video`);
    }
    if (quotesExpected > 0 && quotesApplied > 0 && quotesApplied < quotesExpected) {
      ctx.log(`qa_visual: PARTIAL overlays (advisory): ${quotesApplied}/${quotesExpected} quotes composited (rest dropped/unrestorable)`);
    }
    // CAPTIONS gate — a failed caption burn used to ship silently (the coverage
    // metric is computed from timings arithmetic, not the rendered video, so it
    // could never detect the miss). timeline_assemble now reports the truth.
    const capCues = Number(ctx.store["captionCues"] ?? 0);
    if (capCues > 0 && ctx.store["captionsApplied"] === false) {
      critical.push(`captions missing: ${capCues} cues prepared but the burn failed`);
    }
    // INTRO/OUTRO presence — plan facts beat vision opinion: these are owned by
    // deterministic pipeline flags, not the watcher's card claims (which stay
    // advisory precisely because the watcher mis-called cards in live trials).
    if (ctx.store["introApplied"] === false) {
      critical.push("intro card missing: intro_card render failed upstream (introApplied=false)");
    }
    if (ctx.store["outroApplied"] === false && Number(ctx.params["tailSec"] ?? 3) >= 2) {
      critical.push("outro card missing: outro render/compose failed (outroApplied=false)");
    }
    // DETERMINISTIC EARS — the gate QA never had. Integrated loudness of the
    // final mix must land in a sane band, and when a music track was produced
    // it must be AUDIBLE in the mix (an R2 key existing is not a mix): measure
    // the narration-free intro window. null = unmeasurable = skip, never fail.
    try {
      const introW = Number(ctx.store["introSec"] ?? 0);
      const ears = await measureAudio(video, {
        windowStartSec: 0.5,
        windowDurSec: introW >= 2.5 ? introW - 1 : 0,
      });
      if (ears.integratedLufs !== null && (ears.integratedLufs < -30 || ears.integratedLufs > -8)) {
        critical.push(`audio loudness ${ears.integratedLufs.toFixed(1)} LUFS outside the sane band [-30,-8]`);
      }
      if (music.present && ears.windowMeanDb !== null && ears.windowMeanDb < -50) {
        critical.push(`music missing from mix: intro-window mean ${ears.windowMeanDb.toFixed(1)} dB despite a produced music track`);
      }
      ctx.log(`qa_visual: ears — integrated ${ears.integratedLufs ?? "?"} LUFS, intro-window ${ears.windowMeanDb ?? "?"} dB`);
    } catch (e) {
      ctx.log(`qa_visual: audio meters skipped: ${e instanceof Error ? e.message : e}`);
    }
    // 8) Critic (crew) VALIDATION SPEC â€” the per-video checklist this content must
    // pass. Deterministic assertions compare metrics we computed; vision ones are
    // judged on the sampled frames. A failed BLOCK-severity assertion fails QA;
    // un-measurable metrics are skipped (never a silent dealbreaker).
    let specOutcome: Awaited<ReturnType<typeof runValidationSpec>> | undefined;
    const spec = getValidationSpec(ctx.store);
    if (spec?.assertions?.length) {
      const metrics: Record<string, number> = { durationSec: p.durationSec };
      const timings = ctx.store["sentenceTimings"] as { start: number; end: number }[] | undefined;
      if (timings?.length && p.durationSec > 0) {
        const spoken = timings.reduce((s, t) => s + Math.max(0, (t.end ?? 0) - (t.start ?? 0)), 0);
        // PERCENT of the BODY window (intro + tail excluded) that is spoken
        // narration. Whole-duration coverage could mathematically never reach
        // the thresholds critics write (intro/outro/pauses are by design).
        const introW = Number(ctx.store["introSec"] ?? 0);
        const tailW = Number(ctx.params["tailSec"] ?? 3);
        const bodyWindow = Math.max(1, p.durationSec - introW - tailW);
        metrics.captionCoveragePct = Math.min(1, spoken / bodyWindow) * 100;
      }
      const overlapSec = Number(ctx.store["quoteOverlapSec"] ?? NaN);
      if (Number.isFinite(overlapSec)) metrics.overlapSec = overlapSec;

      // BATCHED vision judging: ALL vision assertions in ONE call (the
      // per-assertion loop cost up to 12 separate multi-image vision calls).
      const judgeFrames = (watch.framePaths.length ? watch.framePaths : vframes).slice(0, 24);
      let visionVerdicts: Map<string, boolean | null> | undefined;
      const visionAssertions = spec.assertions.filter((a) => a.check === "vision");
      if (hasGeminiKey() && judgeFrames.length && visionAssertions.length) {
        try {
          const raw = await visionLocal({
            prompt:
              `You are the QA Critic. Judge EACH requirement against the sampled video frames:\n` +
              visionAssertions.map((a) => `- id "${a.id}": ${a.description}`).join("\n") +
              `\nFor any requirement that CANNOT be judged from still frames (audio, music, loudness, voice, ` +
              `pacing, anything non-visual), use pass:null â€” never guess a fail. ` +
              `Return STRICT JSON {"verdicts":[{"id":string,"pass":boolean|null,"why":"<80 chars"}]} â€” judge every id.`,
            imagePaths: judgeFrames,
            json: true,
            maxTokens: 1600,
          });
          const v = parseJsonLoose<{ verdicts?: { id?: string; pass?: boolean | null }[] }>(raw);
          visionVerdicts = new Map(
            (v.verdicts ?? []).map((x) => [String(x.id), typeof x.pass === "boolean" ? x.pass : null]),
          );
        } catch (e) {
          ctx.log(`qa_visual: batched vision judge failed (assertions skipped): ${e instanceof Error ? e.message : e}`);
        }
      }
      const visionJudge = visionVerdicts
        ? async (a: ValidationAssertion): Promise<boolean | null> => visionVerdicts!.get(a.id) ?? null
        : undefined;

      specOutcome = await runValidationSpec(spec, { metrics, visionJudge, log: ctx.log });
      if (!specOutcome.passed) {
        const failed = specOutcome.results.filter((r) => !r.passed && !r.skipped && r.severity === "block");
        // SPLIT VERDICT: DETERMINISTIC block-severity assertions are trustworthy
        // math (durationSec, caption coverage, overlapâ€¦) â€” those now BLOCK.
        // Vision-judged assertions stay ADVISORY (LLM-authored spec judged by an
        // LLM â€” the flaky half that caused the original false rejections).
        const detFailed = failed.filter(
          (r) => spec.assertions.find((a) => a.id === r.id)?.check === "deterministic",
        );
        const visFailed = failed.filter((r) => !detFailed.includes(r));
        if (detFailed.length) {
          critical.push(
            `validation-spec (deterministic): ${detFailed.map((r) => `${r.id} (observed ${r.observed ?? "?"}, ${r.note ?? "failed"})`).join("; ")}`,
          );
        }
        if (visFailed.length) {
          ctx.log(`qa_visual: validation-spec vision ADVISORY (NOT blocking): ${visFailed.map((r) => `${r.id} (${r.note ?? "failed"})`).join("; ")}`);
        }
      }
    }

    if (critical.length > 0) {
      // Throw ONLY the critical list. The old throw appended the full JSON
      // report, and the healer's regex rules then pattern-matched ADVISORY
      // strings inside it (thumbnail critiques, watch notes) — superseding the
      // wrong blocks and even tripping UNHEALABLE on non-gating text. The full
      // report still reaches the run record via the log line below.
      ctx.log(`qa_visual FAILED — full report (advisory context): ${JSON.stringify(report).slice(0, 4000)}`);
      throw new Error(`qa_visual FAILED: ${critical.join(" | ")}`);
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
    return {
      qaPassed: true,
      qaReport: specOutcome ? { ...report, validation: specOutcome.results } : report,
    };
  },
};

/* ----------------------------- qa_refine -------------------------------- *
 * Closed-loop quality control: GEMINI WATCHES THE WHOLE RENDERED VIDEO against
 * a do/don't rubric â†’ structured findings â†’ a Mastra EDITOR agent maps the
 * fixable ones to bounded ops (drop/shorten/retime quote cards) â†’ an executor
 * re-applies the corrected overlays onto the persisted PRE-OVERLAY video and
 * overwrites the canonical output (no full re-render). Non-fixable findings are
 * recorded (refineNotes) so source-level gates can absorb them next run. Runs
 * after timeline_assemble, before qa_visual/upload. Fully guarded â€” any failure
 * leaves the original video untouched. */
const REFINE_RUBRIC =
  `You are the QUALITY DIRECTOR for a faceless Stoic-philosophy YouTube channel. WATCH the entire video and ` +
  `report every violation of these DO/DON'T rules, each with a timestamp (atSec) and a concrete fix:\n` +
  `1. QUOTE CARDS: must be fully on-screen, legible, SHORT enough to read in their time, and at least ~5s apart ` +
  `(consecutive cards must NEVER overlap or run back-to-back). Flag any card with too much text or any pair too ` +
  `close together.\n` +
  `2. NO channel name / handle on the intro title card or burned into any frame.\n` +
  `3. FOOTAGE must be on-theme and must NOT contradict the Stoic message (no luxury cars, money, brands, ` +
  `shopping/markets, busy offices, parties).\n` +
  `4. NO repeated/looped/duplicate footage; clips should feel distinct.\n` +
  `5. TEXT must never overlap a face/subject and must have strong contrast.\n` +
  `6. The intro should dissolve into the body; the video must END on a deliberate OUTRO CARD (a closing line over ` +
  `the bust) that fades cleanly to black with the music â€” flag if the ending feels abrupt or is just footage ` +
  `cutting off.\n` +
  `7. MUSIC after the intro must duck DOWN GRADUALLY (a smooth ~3s ease, never an instant drop) when the voice ` +
  `starts.\n` +
  `8. Quote-card blur and text must fade in/out SLOWLY and calmly (not snappy/jarring).\n` +
  `9. INTRO TITLE CARD must look sophisticated (elegant type, the bust faint behind at ~50% opacity, text fading ` +
  `in and out) and must NOT show the channel name.\n` +
  `10. Overall pacing, polish, and on-brand premium feel.\n` +
  `Return STRICT JSON {"findings":[{"issue":string,"severity":"low|medium|high","atSec":number,"fix":string}],"overall":string}.`;

export const qaRefine: Block = {
  id: "qa_refine",
  consumes: ["videoKey"],
  produces: ["refineNotes"],
  paid: false,
  run: async (ctx) => {
    // SUPERSEDED by qa_visual (deterministic renderValidate gate + advisory
    // watchRender). qa_refine's old full-video geminiVideo upload + auto-patch/re-
    // encode was slow and 503-prone and could HANG a render for 20+ min, for no gate
    // value. It is now a no-op; QA happens reliably in qa_visual. Kept as a block so
    // existing channel pipelines that reference it still validate.
    ctx.log("qa_refine: skipped (superseded by qa_visual deterministic gate)");
    return { refineNotes: { skipped: "superseded_by_qa_visual" } };
    // (legacy auto-refine implementation deleted — it was unreachable dead code
    // that still type-checked and broke the Vercel build. git history has it.)
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
  quoteOverlaysBlock,
  timelineAssemble,
  qaRefine,
  lengthCheck,
  captions,
  qaVisual,
];



