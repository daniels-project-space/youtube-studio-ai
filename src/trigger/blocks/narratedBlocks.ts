/**
 * Narrated-archetype text blocks (Stage 3a) â€” the "brain" shared by essay /
 * crime / shorts / meditation:
 *   script_gen  â†’ script + narrationText   (non-Google creative model)
 *   hook_craft  â†’ hook + narrationText'     (non-Google creative model; prepends a punchy opener)
 *   qa_script   â†’ scriptApproved            (independent critique; hard-gates paid narration)
 *
 * An unavailable or rejected narrative critic fails before any paid voice/video
 * work. Quality cannot quietly degrade into a polished-looking release.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import {
  assertVoiceGatePreconditions,
  qualityProfile,
} from "@/engine/qualityPolicy";
import {
  ShotRenderManifestSchema,
  validateQualifiedShotRender,
} from "@/engine/renderArtifacts";
import { laneQualityPolicy, resolveContentLane } from "@/engine/contentLane";
import {
  DATA_STORY_MIN_SOURCED_NUMERIC_SENTENCES,
  hasNamedSourceAttribution,
  hasSourceAttributedDataStoryParams,
} from "@/engine/dataStory";
import {
  assertSyntheticScenarioContract,
  syntheticScenarioWritingDirective,
} from "@/engine/syntheticScenario";
import {
  assertDataStorySourceLedger,
  dataStorySourceLedgerPrompt,
} from "@/engine/dataStorySourceLedger";
import { casefileNarrativeGroundingPrompt } from "@/engine/casefileNarrativeGrounding";
import {
  channelCritiqueBrief,
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import type { HealClass } from "@/engine/healer";
import {
  assessProductionEditorialAcceptance,
  buildQualityEvidence,
  EpisodeSpecSchema,
} from "@/engine/qualityEvidence";
import {
  assertScriptApprovedForNarration,
  assertScriptCritiqueAccepted,
} from "@/engine/scriptQualityGate";
import { narrationTtsCost, qaVisualCost, PRICE } from "@/engine/pricing";
import { visualMatterFromUnknown, visualMatterReviewLocks } from "@/engine/visualMatter";
import {
  CinematicCaseSequenceAdmissionReceiptSchema,
  CinematicCaseSequenceInputSchema,
  CinematicCreativeLocksSchema,
  CinematicEditDecisionListSchema,
  cinematicCaseSequenceContentFingerprint,
} from "@/engine/cinematicCaseSequence";
import { assertSourceBoundNarrationAlignment } from "@/engine/sourceBoundStorySpine";
import {
  assertCinematicAssemblyRoute,
  assertCinematicSequenceRenderBinding,
} from "@/engine/cinematicSequenceRenderBinding";
import { createCinematicAssemblyHandoff } from "@/lib/assembly/cinematicHandoff";
import { cinematicFinalMasterQaEvidence } from "@/engine/cinematicQaEvidence";
import {
  assertCinematicFinalMasterQaAdmission,
  assertCinematicFinalMasterQaProfile,
} from "@/engine/cinematicFinalMasterQaAdmission";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import {
  evaluateAuthoredShotEditIntegrity,
  evaluateCinematicEditIntegrity,
} from "@/engine/cinematicEditIntegrity";
import {
  cinematicFinalMasterQaPlan,
  reviewCinematicFinalMasterQaEvidence,
  type CinematicFinalMasterQaEvidenceReceipt,
} from "@/lib/cinematicQaEvidenceContract";
import { analyzeShotBoundaries, sha256ShotAnalysisSource } from "@/lib/shotAnalysis";
import {
  proveOnScreenText,
  sha256OnScreenTextSource,
  TimedOnScreenTextCueSchema,
} from "@/lib/onScreenTextProof";
import { synthScript, translateScript, type Script } from "@/lib/scriptGen";
import { parseJsonLoose } from "@/lib/gemini";
import { visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";
import { existsSync } from "node:fs";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { synthNarration, hasFishKey, stripAudioTags } from "@/lib/tts";
import { narrationPhysics } from "@/lib/voicecraft";
import {
  assertNarrationPerformanceEvidence,
  assertNarrationTimingMeasurementIntegrity,
  planNarrationCadence,
  preflightNarrationPerformance,
  reconcileNarrationCadenceAfterDurationMeasurement,
} from "@/lib/narrationPerformance";
import {
  proveNarrationTranscript,
  sha256NarrationTranscriptSource,
} from "@/lib/narrationTranscriptProof";
import {
  assertNarrationCueTimingEvidence,
  type NarrationCueTimingEvidence,
} from "@/lib/narrationCueTiming";
import {
  boundNarrationChapterHeadings,
  boundNarrationColdOpen,
} from "@/lib/narrationBounds";
import { sanitizeSpoken } from "@/lib/scriptGen";
import { buildFootageQueries, castFootage, hasAnyFootageProvider, type FootageBrief } from "@/lib/footagecraft";
import { searchWikimediaImage } from "@/lib/wikimedia";
import { makeRunTempDir, writeBytes, downloadTo, readBytes } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import { buildChapters } from "@/lib/assemblyai";
import {
  probe,
  assembleBeatBody,
  assembleAuthoredBody,
  composeWithIntro,
  concatAudioWithGaps,
  applyVoiceFx,
  applyQuoteOverlays,
  applyOverlaysAndCaptions,
  assembleStructuredBody,
  measureAudio,
  measureNarrationMixCorrelation,
  normalizeAudioOnly,
  grabFrame,
  kenBurns,
  burnCaptions,
  writeCaptionsAss,
  captionCuesFromTimings,
  type QuoteOverlaySpec,
} from "@/lib/ffmpeg";
import { renderTitleCard, renderQuoteOverlay } from "@/lib/remotionRender";
import {
  assessProductionValidationAcceptance,
  runValidationSpec,
} from "@/engine/creative/validate";
import { getVisualBrief, getMusicBrief, getValidationSpec, getStructure, getCutSheet } from "@/engine/creative/brief";
import {
  channelVisualReviewProfile,
  reviewRender,
  visualRepairSignals,
  visualReviewFailureMessage,
  VisualReviewFailure,
  type VisualReviewOverlay,
} from "@/lib/visualReview";
import { validateRender } from "@/lib/renderValidate";
import type { ValidationAssertion } from "@/engine/creative/types";

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
  let failed = false;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      for (;;) {
        // Stop admitting new paid work after the first failure, but wait for
        // already in-flight workers to settle so their billable callbacks are
        // included in the failed-stage ledger before this pool rejects.
        if (failed) return;
        const idx = next++;
        if (idx >= items.length) return;
        try {
          out[idx] = await fn(items[idx], idx);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
          return;
        }
      }
    }),
  );
  if (failed) throw firstError;
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

/**
 * CONTENT-ADDRESSED ITERATION CHECKPOINT — the cost-safety primitive behind
 * every produce→critique loop in this file that spends money.
 *
 * A produce→critique loop multiplies a block's spend by its iteration count,
 * and the self-healer re-runs blocks. Without a checkpoint, one heal of a
 * two-iteration loop re-purchases BOTH candidates. So each iteration derives a
 * hash over everything that determines its result — including the iteration
 * index and the prior critique issues, without which a regenerate would just
 * re-read the rejected candidate and change nothing — and persists its paid
 * outcome under that hash. A replay re-reads; it never re-buys.
 *
 * Deliberately JSON + R2 rather than a bespoke manifest type: what these loops
 * buy is *decisions* (which entities, which hook), not large binaries, and the
 * local derivation from those decisions (download, Ken Burns) is free.
 */
function iterationRequestHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function readIterationCheckpoint<T>(key: string, log: (msg: string) => void): Promise<T | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await getObjectBytes(key))) as T;
  } catch {
    // Absent (the normal first-run case) or unreadable — either way, produce it.
    log(`checkpoint miss: ${key.split("/").pop() ?? key}`);
    return null;
  }
}

async function writeIterationCheckpoint(key: string, value: unknown, log: (msg: string) => void): Promise<void> {
  try {
    await putObject(key, Buffer.from(JSON.stringify(value)), { contentType: "application/json" });
  } catch (e) {
    // A checkpoint is an optimisation, never a correctness requirement: losing
    // the write costs a future replay money, but failing the run costs more.
    log(`checkpoint write failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

const HEAL_CLASSES: readonly HealClass[] = ["overlay_finish", "body_rebuild", "asset_regen"];

/**
 * Read the healer's DECLARED repair strategy for one block out of the seed
 * store (P0-1 step 2).
 *
 * Validated rather than cast: `store.healClasses` crosses a run boundary (it is
 * re-seeded on resume), so an unrecognised value must degrade to "no declared
 * class" — which sends the caller to its conservative branch — instead of
 * type-asserting a bad string into a repair decision that costs money.
 */
function readDeclaredHealClasses(raw: unknown, blockId: string): HealClass[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const declared = (raw as Record<string, unknown>)[blockId];
  if (!Array.isArray(declared)) return [];
  return declared.filter((value): value is HealClass =>
    typeof value === "string" && (HEAL_CLASSES as readonly string[]).includes(value),
  );
}

/**
 * Assemble this channel's critique grounding from the frozen seed store (P1-1).
 *
 * `criticDoctrine` is `identity.creativeBrief.criticDoctrine`, seeded by
 * runPipeline alongside the rest of the identity. Every model-graded gate in
 * this file reads it from here, so there is exactly one place to change what a
 * per-channel critic is told.
 */
function channelCritiqueContext(ctx: StageContext): ChannelCritiqueContext {
  const laneKey = (ctx.store["contentLane"] as { key?: unknown } | null | undefined)?.key;
  return {
    ...(opt(ctx, "channelName") ? { channelName: opt(ctx, "channelName") } : {}),
    ...(opt(ctx, "persona") ? { persona: opt(ctx, "persona") } : {}),
    ...(opt(ctx, "styleGrammar") ? { styleGrammar: opt(ctx, "styleGrammar") } : {}),
    ...(opt(ctx, "criticDoctrine") ? { criticDoctrine: opt(ctx, "criticDoctrine") } : {}),
    ...(typeof laneKey === "string" && laneKey ? { contentLaneKey: laneKey } : {}),
    laneEmphasis: laneQualityPolicy(ctx.store["contentLane"]).emphasis,
  };
}

export const scriptGen: Block = {
  id: "script_gen",
  consumes: ["topic"],
  produces: ["script", "narrationText"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const sourceGrounding = [
      hasSourceAttributedDataStoryParams(ctx.params)
        ? dataStorySourceLedgerPrompt(assertDataStorySourceLedger(ctx.store["dataStorySourceLedger"]))
        : undefined,
      ctx.store["casefileSourcePacket"] !== undefined
        ? casefileNarrativeGroundingPrompt(ctx.store["casefileSourcePacket"])
        : undefined,
      ctx.store["syntheticScenario"] !== undefined
        ? syntheticScenarioWritingDirective(assertSyntheticScenarioContract(ctx.store["syntheticScenario"]))
        : undefined,
    ].filter((value): value is string => Boolean(value)).join("\n\n") || undefined;
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
      sourceAttributionRequired: ctx.params["sourceAttributionRequired"] === true,
      sourceGrounding,
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
    // EVALUATOR-OPTIMIZER: an independent non-Google critic reviews every
    // duration. A rejected draft gets one informed retry; exhaustion or a
    // reviewer outage is an admission failure, never permission to synthesize
    // an unreviewed script.
    const critiqueEnabled = hasAnthropicKey();
    const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
    const scriptChannel: ChannelCritiqueContext = channelCritiqueContext(ctx);

    let precraftedHook: Script["crafted"] | undefined;
    const loop = await produceAndCritique<Script>({
      label: "script_gen",
      threshold: laneQuality.critiqueThreshold,
      // One informed retry, exactly as before — a script regenerate is the most
      // expensive text spend in the pipeline.
      maxIters: critiqueEnabled ? 2 : 1,
      log: (message, extra) => ctx.log(message, extra),
      channel: scriptChannel,
      produce: async (priorIssues) => {
        const draft = await synthScript(
          {
            ...req,
            ...(priorIssues.length ? { priorIssues } : {}),
            // Only the narration was rejected, so the regen must not re-bill
            // hookcraft (Pro + grounded fact-checks).
            ...(priorIssues.length && precraftedHook ? { precraftedHook } : {}),
          },
          ctx.log,
        );
        precraftedHook = draft.crafted;
        return draft;
      },
      critique: async (draft, iter) => {
        if (!critiqueEnabled) return { score: 1, pass: true, issues: [] };
        try {
          const crit = await claudeJson<{ pass?: boolean; issues?: string[] }>({
            prompt:
              `Critique this YouTube narration draft for quality and on-brand voice` +
              (req.persona ? ` (channel persona: ${req.persona})` : "") +
              `. Flag dull sections, off-brand language, factual hedging, weak structure, or generic ` +
              `templated writing.` +
              (draft.hookLoop
                ? ` CRITICAL: the cold open promised "${draft.hookLoop}" — flag it as an issue if the script ` +
                  `does not EXPLICITLY pay that promise off.`
                : "") +
              channelCritiqueBrief(scriptChannel) +
              ` Return STRICT JSON {"pass": boolean, "issues": string[]} â€” at most 5 ` +
              `issues, each under 140 characters.\n\n` +
              (draft.narrationText.length <= 9000
                ? draft.narrationText
                : draft.narrationText.slice(0, 4000) + `\n\n[... OMITTED ...]\n\n` + draft.narrationText.slice(-3500)),
            maxTokens: 1200,
            temperature: 0.3,
          });
          const issues = (Array.isArray(crit.issues) ? crit.issues : []).filter(Boolean).slice(0, 6);
          const rejected = crit.pass === false;
          const rejectionIssues = issues.length
            ? issues
            : ["independent narrative critic rejected the draft without usable remediation"];
          if (rejected) ctx.log(`script_gen: draft rejected by critic â€” regenerating once`, { issues: rejectionIssues });
          // The `0.01 * iter` term preserves the legacy "keep the informed
          // second attempt" rule: produceAndCritique returns the best candidate
          // by STRICT score comparison, so without it an equally-rated retry
          // would lose the tie to the uninformed first draft.
          return rejected
            ? { score: Math.max(0, 0.5 - 0.05 * rejectionIssues.length) + 0.01 * iter, pass: false, issues: rejectionIssues }
            : { score: 1, pass: true, issues: [] };
        } catch (e) {
          // An independent critic outage cannot be treated as a quality pass.
          throw new Error(
            `script_gen FAILED: independent narrative critic unavailable — refusing an unreviewed script (${e instanceof Error ? e.message : e})`,
          );
        }
      },
    });
    if (critiqueEnabled) {
      assertScriptCritiqueAccepted({
        accepted: loop.accepted,
        issues: loop.critique.issues,
        stage: "script_gen",
      });
    }
    const script = loop.value;
    ctx.log(
      `script_gen: ${script.sections.length} sections, ~${script.estDurationSec}s ` +
      `(${loop.iterations} iter, ${loop.accepted ? "accepted" : "best-effort"})`,
    );
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
    if (!hasAnthropicKey()) return { hook: firstLine() };

    // ── PRODUCE → CRITIQUE → REGENERATE (P1-4) ───────────────────────────────
    // The hook is the title/thumbnail line — the single highest-leverage string
    // in the run — and used to be a one-shot generation that shipped whatever
    // came back, including a hook that over-promises something the narration
    // never delivers. It now runs on the shared `produceAndCritique` primitive.
    //
    // Cost safety (this block spends on every produce):
    //   - Each iteration is content-addressed and checkpointed, so a self-heal
    //     replay re-reads the drafted hook and re-purchases NOTHING.
    //   - Deterministic defects (empty, too long, markdown, or just the
    //     narration's first line echoed back) are computed in code — they cost
    //     nothing and can drive a retry with no critic at all.
    //   - A critic OUTAGE accepts the current draft instead of blind-spending
    //     another draft that would be equally ungraded.
    //   - Cap 2 (one informed retry), the established convention here.
    const hookChannel = channelCritiqueContext(ctx);
    const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
    const critiqueEnabled = hasAnthropicKey();
    const checkpointRoot = `${ctx.keyPrefix}runs/${ctx.runId}/hook-checkpoints`;
    const narrationDigest = iterationRequestHash(narration);
    let observedCostUsd = 0;

    const loop = await produceAndCritique<string>({
      label: "hook_craft",
      threshold: laneQuality.critiqueThreshold,
      maxIters: critiqueEnabled ? Math.min(2, Math.max(1, laneQuality.maxCritiqueIters)) : 1,
      log: (message, extra) => ctx.log(message, extra),
      channel: hookChannel,
      produce: async (priorIssues, iter) => {
        const requestHash = iterationRequestHash({
          contract: "hook-craft-checkpoint-v1",
          narrationDigest,
          critiqueIteration: iter,
          critiqueIssues: priorIssues,
          criticDoctrine: hookChannel.criticDoctrine ?? null,
        });
        const checkpointKey = `${checkpointRoot}/${requestHash}.json`;
        const cached = await readIterationCheckpoint<{ hook: string; costUsd: number }>(
          checkpointKey,
          (m) => ctx.log(`hook_craft: ${m}`),
        );
        if (cached && typeof cached.hook === "string") {
          observedCostUsd += Number(cached.costUsd) || 0;
          ctx.log(`hook_craft: reused checkpointed draft ${requestHash.slice(0, 12)} (no re-spend)`);
          return cached.hook;
        }
        let drafted = "";
        try {
          const out = await claudeJson<{ hook?: string }>({
            prompt:
              "Write ONE scroll-stopping hook line for this video (for the title/thumbnail). " +
              "It must be concrete and must promise ONLY something this narration actually " +
              "delivers — a hook the video does not pay off is a failure, not a win. " +
              (priorIssues.length
                ? `A previous attempt was REJECTED for: ${priorIssues.join("; ")}. Fix all of it. `
                : "") +
              channelCritiqueBrief(hookChannel) +
              'Return STRICT JSON {"hook": string}. No markdown.\n\n' +
              narration.slice(0, 2000),
            maxTokens: 200,
            temperature: 0.9,
          });
          observedCostUsd += PRICE.boundedTextPassUsd;
          drafted = typeof out.hook === "string" ? out.hook.trim() : "";
        } catch (e) {
          ctx.log(`hook_craft: permitted text planner failed (${e instanceof Error ? e.message : e})`);
        }
        const hook = drafted || firstLine();
        await writeIterationCheckpoint(
          checkpointKey,
          { hook, costUsd: drafted ? PRICE.boundedTextPassUsd : 0 },
          (m) => ctx.log(`hook_craft: ${m}`),
        );
        return hook;
      },
      critique: async (candidate, iter) => {
        // DETERMINISTIC first — free, and the primitive's contract says the
        // caller must compute countable facts rather than ask a model to count.
        const trimmed = candidate.trim();
        const deterministic = [
          trimmed.length === 0 ? "the hook is empty" : "",
          trimmed.length > 120 ? `the hook is ${trimmed.length} chars — too long for a title/thumbnail line` : "",
          /^[*_#>`]|[*_`]{2}/.test(trimmed) ? "the hook contains markdown formatting" : "",
          trimmed && trimmed === firstLine().trim()
            ? "the hook is just the narration's opening line echoed back, not a crafted hook"
            : "",
        ].filter(Boolean);
        if (deterministic.length) {
          ctx.log(`hook_craft: candidate ${iter} failed deterministic checks`, { issues: deterministic });
          return { score: 0.2, pass: false, issues: deterministic };
        }
        if (!critiqueEnabled) return { score: 1, pass: true, issues: [] };
        try {
          const verdict = await claudeJson<{ pass?: boolean; score?: number; issues?: string[] }>({
            prompt:
              `Judge ONE hook line written for a YouTube title/thumbnail. Reject it if it is generic, ` +
              `vague, clickbait that the narration does not pay off, or indistinguishable from every ` +
              `other video in its niche. Accept it if it would genuinely stop a scroll AND is honest ` +
              `about what the video delivers.` +
              channelCritiqueBrief(hookChannel) +
              ` Return STRICT JSON {"pass": boolean, "score": number 0..1, "issues": string[]} — at most ` +
              `4 issues, each under 140 characters.\n\nHOOK: ${trimmed}\n\nNARRATION (excerpt):\n` +
              narration.slice(0, 2500),
            maxTokens: 700,
            temperature: 0.3,
          });
          observedCostUsd += PRICE.boundedTextPassUsd;
          const issues = (Array.isArray(verdict.issues) ? verdict.issues : []).filter(Boolean).slice(0, 4);
          const rejected = verdict.pass === false;
          const rejectionIssues = issues.length
            ? issues
            : ["independent hook critic rejected the line without usable remediation"];
          const score = Number.isFinite(verdict.score)
            ? Math.max(0, Math.min(1, Number(verdict.score)))
            : rejected ? 0.4 : 1;
          if (rejected) {
            ctx.log(
              `hook_craft: candidate ${iter} rejected by the critic` +
              (iter < 2 ? " — regenerating with the defects fed back" : " — iteration cap reached"),
              { issues: rejectionIssues },
            );
          }
          // The +0.01*iter tiebreak keeps the INFORMED retry when it merely ties
          // the first draft (produceAndCritique picks the best by strict >).
          return rejected
            ? { score: Math.min(0.99, score) + 0.01 * iter, pass: false, issues: rejectionIssues }
            : { score, pass: true, issues: [] };
        } catch (e) {
          throw new Error(
            `hook_craft FAILED: independent hook critic unavailable — refusing an unreviewed promise (${e instanceof Error ? e.message : e})`,
          );
        }
      },
    });

    if (critiqueEnabled) {
      assertScriptCritiqueAccepted({
        accepted: loop.accepted,
        issues: loop.critique.issues,
        stage: "hook_craft",
      });
    }
    const hook = loop.value || firstLine();
    ctx.log(
      `hook_craft: "${hook.slice(0, 60)}â€¦" (${loop.iterations} iter, ` +
      `${loop.accepted ? "accepted" : "best-effort"})`,
    );
    return { hook, [COST_PATCH_KEY]: observedCostUsd };
  },
};

export const qaScript: Block = {
  id: "qa_script",
  consumes: ["narrationText"],
  produces: ["scriptApproved"],
  run: async (ctx) => {
    const narration = str(ctx, "narrationText");
    if (hasSourceAttributedDataStoryParams(ctx.params)) {
      assertDataStorySourceLedger(ctx.store["dataStorySourceLedger"], narration);
      const sourcedNumericSentences = splitSentences(narration)
        .filter((sentence) => /\d/.test(sentence) && hasNamedSourceAttribution(sentence));
      if (sourcedNumericSentences.length < DATA_STORY_MIN_SOURCED_NUMERIC_SENTENCES) {
        throw new Error(
          `qa_script FAILED: source-attributed data story requires at least ${DATA_STORY_MIN_SOURCED_NUMERIC_SENTENCES} ` +
          `numeric sentences naming a concrete source; found ${sourcedNumericSentences.length}`,
        );
      }
      ctx.log(`qa_script: source-attributed data-story evidence passed (${sourcedNumericSentences.length} sourced numeric sentences)`);
    }
    if (!hasAnthropicKey()) {
      throw new Error(
        "qa_script FAILED: independent narrative critic unavailable — refusing to synthesize an unreviewed script",
      );
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
      const pass = res.pass !== false;
      ctx.log(`qa_script: pass=${pass}`, { issues: issues.slice(0, 5) });
      // HARD GATE: a confirmed craft-quality failure must not proceed into the
      // paid narration/visual stages that follow — same pattern as the sibling
      // guard-stage blocks originality_gate / compliance_check (throw to halt
      // the pipeline; PARALLEL_GROUPS in runner.ts fails the whole group).
      if (!pass) {
        throw new Error(
          `qa_script FAILED: narration failed craft-quality critique — refusing to proceed to paid ` +
          `narration/visual stages (${issues.slice(0, 5).join(" | ") || "no specific issues returned"})`,
        );
      }
      return { scriptApproved: true };
    } catch (e) {
      // A confirmed quality failure must propagate. A model/parse/network
      // error is also fail-closed: unverified is not approved for paid media.
      if (e instanceof Error && e.message.startsWith("qa_script FAILED")) throw e;
      throw new Error(
        `qa_script FAILED: independent narrative critic unavailable — refusing paid narration (${e instanceof Error ? e.message : e})`,
      );
    }
  },
};

export const narrationTts: Block = {
  id: "narration_tts",
  consumes: ["narrationText", "scriptApproved"],
  produces: [
    "narrationKey",
    "narrationDurationSec",
    "narrationLocalPath",
    "narrationTranscriptText",
    "narrationPerformanceEvidence",
    "sentenceTimings",
    "chapterPlan",
  ],
  paid: true,
  run: async (ctx) => {
    assertScriptApprovedForNarration(ctx.store["scriptApproved"]);
    const quality = qualityProfile(ctx.params["qualityProfile"]);
    // TTS engine: fish (default) or elevenlabs (v3 expressive â€” PERFORMS inline
    // [audio tags] the script writer placed; tags survive sanitization here but
    // are stripped from all DISPLAY surfaces below).
    const ttsProvider = (ctx.params["ttsProvider"] as string) || "fish";
    const elevenVoiceId = ctx.params["elevenVoiceId"] as string | undefined;
    // sanitizeSpoken strips any markdown/slashes/stage-directions that slipped
    // through script_gen so the voice never reads a symbol aloud.
    const text = sanitizeSpoken(str(ctx, "narrationText"), { keepAudioTags: ttsProvider === "elevenlabs" });
    // Count provider-accepted TTS responses rather than estimating from the
    // final script. The local cold-open evidence is deliberately not a second
    // remote model call, so thumbnail-only Google permission cannot leak here.
    let billableTtsCharacters = 0;
    const onBillableCharacters = (characters: number) => {
      billableTtsCharacters += characters;
    };
    try {
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

    // COLD-OPEN GATE — production requires a persisted >=7 human audition, an
    // explicit voice, and physical evidence from the real take. Draft is the
    // only profile that may opt out. Google/Gemini is thumbnail-only.
    const gateEnabled = ctx.params["voiceGate"] !== false;
    const castScore = Number(ctx.params["voiceCastScore"] ?? Number.NaN);
    const selectedVoiceId = ttsProvider === "elevenlabs" ? (elevenVoiceId ?? voiceId) : voiceId;
    assertVoiceGatePreconditions({
      profile: quality,
      gateEnabled,
      judgeAvailable: false,
      localEvidenceGateAvailable: true,
      channelId: ctx.channelId,
      provider: ttsProvider,
      voiceId: selectedVoiceId,
      castScore,
      castEvidence: ctx.params["voiceCastEvidence"],
      readinessStatus: ctx.params["voiceReadinessStatus"],
      readinessReason: ctx.params["voiceReadinessReason"],
    });
    const tmp = await makeRunTempDir(ctx.runId);
    if (quality === "production" && gateEnabled) {
      // Keep the casting decision, then prove this *actual* cold-open take has a
      // real audio stream, audible loudness, and plausible spoken timing.
      const coldOpenText = boundNarrationColdOpen(splitSentences(text).slice(0, 2).join(" "));
      if (!coldOpenText.trim()) {
        throw new Error("narration_tts: production cold-open probe is empty");
      }
      const coldOpenPath = join(tmp, "cold_open_local_evidence.mp3");
      const coldOpenBytes = await synthNarration({
        text: coldOpenText,
        voiceId: selectedVoiceId,
        niche,
        speed,
        provider: ttsProvider,
        elevenVoiceId: selectedVoiceId,
        eleven: elevenSettings ? { ...elevenSettings, seed: elevenSeed } : undefined,
        onBillableCharacters,
      });
      await writeBytes(coldOpenPath, coldOpenBytes);
      const evidence = await preflightNarrationPerformance({
        audioPath: coldOpenPath,
        text: coldOpenText,
        speed,
      });
      ctx.log(
        `narration_tts: local cold-open evidence PASSED (${evidence.durationSec.toFixed(1)}s | ${evidence.wordsPerSec.toFixed(2)} words/s | ${evidence.integratedLufs.toFixed(1)} LUFS)`,
      );
    }
    // Optional stylized voice filter (e.g. "radio" â†’ vintage AM set). Applied to
    // the finished narration track before upload; no-op when unset. The Composer
    // (crew) brief can set it when the operator didn't pin one.
    const voiceFx =
      (ctx.params["voiceFx"] as string | undefined) ??
      getMusicBrief(ctx.store)?.audio?.voiceFx;
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
      const eligibleChapterSections = script.sections
        .map((sec, idx) => ({ heading: sec.heading, idx }))
        .filter(({ idx }) => idx !== lastIdx && !(idx === 0 && script.sections!.length >= 3));
      const boundedChapterHeadings = boundNarrationChapterHeadings(
        eligibleChapterSections.map(({ heading }) => heading),
      );
      const chapterBySection = new Map<number, { heading: string; chap: number }>();
      boundedChapterHeadings.forEach((heading, candidateIndex) => {
        if (!heading) return;
        chapterBySection.set(eligibleChapterSections[candidateIndex].idx, {
          heading,
          chap: chapterBySection.size + 1,
        });
      });
      script.sections.forEach((sec, idx) => {
        const chapter = chapterBySection.get(idx);
        if (chapter) items.push({ kind: "heading", text: chapter.heading, chap: chapter.chap });
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
      const chapterCadencePlan = planNarrationCadence({
        sentences: items.map(speakOf),
        baseGapSec: baseGap,
        jitterSec: jitter,
      });
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
        const bytes = await synthNarration({ text: speak, voiceId: selectedVoiceId, niche, speed, provider: ttsProvider, elevenVoiceId: selectedVoiceId, eleven: elevenSettings ? { ...elevenSettings, seed: elevenSeed } : undefined, stitch, onBillableCharacters });
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
      assertNarrationTimingMeasurementIntegrity({
        sentenceCount: items.length,
        estimatedDurationCount: probeEstimates,
      });
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
            gapAfter = chapterCadencePlan.gapsSec[i] ?? baseGap;
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
      const narrationTranscriptText = items.map(speakOf).join(" ");
      const narrationPerformanceEvidence = await preflightNarrationPerformance({
        audioPath: local,
        text: narrationTranscriptText,
        speed,
      });
      ctx.log(
        `narration_tts: local final evidence PASSED (${narrationPerformanceEvidence.durationSec.toFixed(1)}s | ${narrationPerformanceEvidence.wordsPerSec.toFixed(2)} words/s | ${narrationPerformanceEvidence.integratedLufs.toFixed(1)} LUFS)`,
      );
      const narrationKey = `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`;
      await putObject(narrationKey, await readBytes(local), { contentType: "audio/mpeg" });
      await recordAsset(ctx, "narration", narrationKey, { durationSec, chapters: chap, mode: "chapter" });
      ctx.log(`narration_tts ok (chapter mode): ${durationSec.toFixed(0)}s, ${chap} chapters, ${sentenceTimings.length} sentences`);
      return {
        narrationKey,
        narrationDurationSec: durationSec,
        narrationLocalPath: local,
        // The actually spoken sequence includes bounded chapter headings, which
        // are deliberately absent from the display-only narrationText.  Final
        // QA must compare against this exact source, not a nearby script.
        narrationTranscriptText,
        narrationPerformanceEvidence,
        sentenceTimings,
        chapterPlan,
        [COST_PATCH_KEY]: narrationTtsCost(ttsProvider, billableTtsCharacters, 0),
      };
    }

    // Synth PER SENTENCE and concat with a silence gap â†’ organic pauses, plus
    // exact per-sentence timings (used to anchor quote overlays). Gaps are
    // jittered per sentence so the pacing feels human, not metronomic.
    const sentences = splitSentences(text);
    const cadencePlan = planNarrationCadence({
      sentences,
      baseGapSec: baseGap,
      jitterSec: jitter,
    });
    const gaps = cadencePlan.gapsSec;
    ctx.log(
      `narration_tts: ${sentences.length} sentences, ${cadencePlan.purposes.filter((purpose) => purpose !== "continuation").length} planned delivery beats (deterministic semantic cadence)`,
    );

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
      const bytes = await synthNarration({ text: s, voiceId: selectedVoiceId, niche, speed, provider: ttsProvider, elevenVoiceId: selectedVoiceId, eleven: elevenSettings ? { ...elevenSettings, seed: elevenSeed } : undefined, stitch, onBillableCharacters });
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
    // Do not build an edit timeline around several estimated sentence lengths.
    // The final master can only reconcile a small, bounded probe miss; beyond
    // that captions, story beats, and Fern-style causal cuts would all be
    // planned against fiction.
    assertNarrationTimingMeasurementIntegrity({
      sentenceCount: sentences.length,
      estimatedDurationCount: probeFailures,
    });
    const partPaths: string[] = parts.map((x) => x.p);
    // Timings carry the DISPLAY text â€” audio tags are performed by the voice,
    // never shown in captions/quote cards/insert matching.
    let sentenceTimings: { text: string; start: number; end: number }[] = [];
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
    // TIMING RECONCILIATION: a failed per-sentence probe injected an ESTIMATED
    // duration into the cumulative cursor. If the final take materially differs,
    // reconcile its cue clock to measured truth AND re-prove the semantic pause
    // plan on that adjusted clock; a simple post-cadence scale would make every
    // reveal/turn pause unaccountable.
    const reconciledTiming = reconcileNarrationCadenceAfterDurationMeasurement({
      sentences,
      sentenceTimings,
      plan: cadencePlan,
      estimatedDurationSec: cursor,
      measuredDurationSec: probeFailures > 0 && durationSec > 0 ? durationSec : cursor,
    });
    if (reconciledTiming.scale !== 1) {
      sentenceTimings = sentenceTimings.map((timing, index) => ({
        ...timing,
        ...reconciledTiming.sentenceTimings[index]!,
      }));
      ctx.log(
        `narration_tts: ${probeFailures} probe failure(s) — sentence timings reconciled ×${reconciledTiming.scale.toFixed(4)} ` +
        `to the measured ${durationSec.toFixed(1)}s; cadence remains certified`,
      );
    }
    const cadence = reconciledTiming.cadence;
    ctx.log(
      `narration_tts: cadence evidence PASSED (${cadence.minGapSec.toFixed(2)}–${cadence.maxGapSec.toFixed(2)}s pauses; ${cadence.distinctGapCount} distinct delivery beats)`,
    );
    const narrationPerformanceEvidence = await preflightNarrationPerformance({ audioPath: local, text, speed });
    ctx.log(
      `narration_tts: local final evidence PASSED (${narrationPerformanceEvidence.durationSec.toFixed(1)}s | ${narrationPerformanceEvidence.wordsPerSec.toFixed(2)} words/s | ${narrationPerformanceEvidence.integratedLufs.toFixed(1)} LUFS)`,
    );

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
      narrationTranscriptText: text,
      narrationPerformanceEvidence,
      sentenceTimings,
      // Declared in `produces`, so it must ALWAYS be returned â€” an empty plan
      // means "no chapter cards". (chapterCards:false channels hit the engine's
      // undefined-produce guard here on their very first render.)
      chapterPlan: [],
      [COST_PATCH_KEY]: narrationTtsCost(ttsProvider, billableTtsCharacters, 0),
    };
    } catch (error) {
      const observedCostUsd = narrationTtsCost(
        ttsProvider,
        billableTtsCharacters,
        0,
      );
      if (observedCostUsd <= 0) throw error;
      // The provider work has already happened. Make the failure terminal so an
      // outer block/task retry cannot repurchase it, and expose the exact spend
      // for the runner's failed-stage ledger.
      const chargedError = error instanceof Error ? error : new Error(String(error));
      Object.assign(chargedError, { retryable: false, observedCostUsd });
      throw chargedError;
    }
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
    // IDEMPOTENT per run: a resume/heal that re-queries footage used to APPEND a
    // whole new clip-set to the cross-video ledger every time (one video bloated
    // it to 125 ids). Remove THIS run's previous contribution before adding the
    // new one, so re-runs replace rather than accumulate.
    try {
      const contribKey = `${ctx.keyPrefix}footage/run/${ctx.runId}/picked.json`;
      let priorContrib: string[] = [];
      try {
        priorContrib = JSON.parse(Buffer.from(await getObjectBytes(contribKey)).toString("utf8")) as string[];
      } catch { /* first run of this id */ }
      for (const id of priorContrib) usedIds.delete(id);
      for (const id of cast.pickedIds) usedIds.add(id);
      const ledger = Array.from(usedIds).slice(-3000);
      await putObject(ledgerKey, Buffer.from(JSON.stringify(ledger), "utf8"), { contentType: "application/json" });
      await putObject(contribKey, Buffer.from(JSON.stringify(cast.pickedIds), "utf8"), { contentType: "application/json" });
      ctx.log(`stock_footage: ledger updated -> ${ledger.length} used clip ids (this run: ${cast.pickedIds.length})`);
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
    if (!hasAnthropicKey()) {
      ctx.log("entity_imagery: no permitted text planner â€” skipping");
      return { entityClips: clips, entityKeys: [], attributions };
    }
    const narration = str(ctx, "narrationText");
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;

    // ── PRODUCE → CRITIQUE → REGENERATE (P1-4) ───────────────────────────────
    // Entity imagery had no judge at all: whatever four names the extractor
    // returned became on-screen visuals, so an off-topic or unillustratable
    // pick (an abstract noun, a person with no usable portrait) simply produced
    // a worse video that nothing noticed until qa_visual — after the spend.
    // The candidate here is the RESOLVED SET, which is the thing worth judging:
    // an individually plausible entity can still be a bad set (all four from one
    // paragraph, none from the argument the video actually makes).
    //
    // Cost safety (this block buys an extraction pass + a vision identity check
    // per image):
    //   - Every iteration checkpoints its RESOLUTION (chosen entities, image
    //     URLs, verify verdicts) content-addressed by narration+iteration+prior
    //     issues, so a self-heal replay re-reads those decisions and re-buys
    //     nothing. Only the free local work (download, Ken Burns) repeats.
    //   - An extraction that legitimately finds NO entities is accepted, never
    //     retried: paying again to be told the same true thing is pure waste.
    //   - A critic outage accepts the current set rather than blind-spending.
    //   - Cap 2 (one informed retry).
    const entityChannel = channelCritiqueContext(ctx);
    const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
    const critiqueEnabled = hasAnthropicKey();
    const checkpointRoot = `${ctx.keyPrefix}runs/${ctx.runId}/entity-checkpoints`;
    const narrationDigest = iterationRequestHash(narration);
    let observedCostUsd = 0;

    interface ResolvedEntity {
      entity: string;
      url: string;
      attribution?: string;
    }
    interface EntityCandidate {
      /** Everything the extractor proposed — distinguishes "found nothing" from "found nothing usable". */
      proposed: string[];
      resolved: ResolvedEntity[];
    }

    const loop = await produceAndCritique<EntityCandidate>({
      label: "entity_imagery",
      threshold: laneQuality.critiqueThreshold,
      maxIters: critiqueEnabled ? Math.min(2, Math.max(1, laneQuality.maxCritiqueIters)) : 1,
      log: (message, extra) => ctx.log(message, extra),
      channel: entityChannel,
      produce: async (priorIssues, iter): Promise<EntityCandidate> => {
        const requestHash = iterationRequestHash({
          contract: "entity-imagery-checkpoint-v1",
          narrationDigest,
          critiqueIteration: iter,
          critiqueIssues: priorIssues,
          criticDoctrine: entityChannel.criticDoctrine ?? null,
        });
        const checkpointKey = `${checkpointRoot}/${requestHash}.json`;
        const cached = await readIterationCheckpoint<EntityCandidate & { costUsd: number }>(
          checkpointKey,
          (m) => ctx.log(`entity_imagery: ${m}`),
        );
        if (cached && Array.isArray(cached.resolved) && Array.isArray(cached.proposed)) {
          observedCostUsd += Number(cached.costUsd) || 0;
          ctx.log(
            `entity_imagery: reused checkpointed resolution ${requestHash.slice(0, 12)} ` +
            `(${cached.resolved.length} entity/entities, no re-spend)`,
          );
          return { proposed: cached.proposed, resolved: cached.resolved };
        }

        let iterationCostUsd = 0;
        // Pull SPECIFIC named entities that have real imagery (people/places/artworks).
        let proposed: string[] = [];
        try {
          const out = await claudeJson<{ entities?: string[] }>({
            prompt:
              "From this narration, list up to 4 SPECIFIC named entities with well-known " +
              'real photographs/portraits (e.g. "Marcus Aurelius", "the Colosseum"). ' +
              "Skip abstract concepts. Prefer entities central to the narration's ARGUMENT, " +
              "spread across the whole piece rather than clustered in one passage. " +
              (priorIssues.length
                ? `A previous selection was REJECTED for: ${priorIssues.join("; ")}. Choose differently. `
                : "") +
              channelCritiqueBrief(entityChannel) +
              "Return STRICT JSON {\"entities\":string[]}.\n\n" +
              narration.slice(0, 3000),
            maxTokens: 250,
            temperature: 0.3,
          });
          iterationCostUsd += PRICE.boundedTextPassUsd;
          proposed = (out.entities ?? [])
            .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
            .slice(0, 4);
        } catch (e) {
          ctx.log(`entity_imagery: extraction failed (${e instanceof Error ? e.message : e})`);
        }

        const resolved: ResolvedEntity[] = [];
        for (const e of proposed) {
          try {
            const wi = await searchWikimediaImage(e);
            if (!wi) {
              ctx.log(`entity_imagery: no Wikimedia image for "${e}"`);
              continue;
            }
            const probeDir = await makeRunTempDir(ctx.runId);
            const img = await downloadTo(wi.url, join(probeDir, `entity_probe_${resolved.length}.jpg`));
            // Verify the Wikimedia image actually depicts the entity (search can
            // return the wrong person/place). Reject mismatches rather than show a
            // wrong face. Verify failure (not mismatch) keeps the image.
            try {
              const raw = await visionLocal({
                prompt:
                  `Does this image clearly depict "${e}"? Be strict about identity for ` +
                  `people and specific places. Return STRICT JSON {"match":boolean,"reason":string}.`,
                imagePaths: [img],
                json: true,
                maxTokens: VISION_GATE_MAX_TOKENS,
              });
              iterationCostUsd += PRICE.visionGraderUsd;
              const v = parseJsonLoose<{ match?: boolean; reason?: string }>(raw);
              if (v.match === false) {
                ctx.log(`entity_imagery: image for "${e}" did NOT verify (${v.reason ?? ""}) â€” skipping`);
                continue;
              }
            } catch (error) {
              ctx.log(
                `entity_imagery: image for "${e}" could not be independently verified (${error instanceof Error ? error.message : error}) — skipping`,
              );
              continue;
            }
            resolved.push({ entity: e, url: wi.url, ...(wi.attribution ? { attribution: wi.attribution } : {}) });
          } catch (err) {
            ctx.log(`entity_imagery: "${e}" failed (${err instanceof Error ? err.message : err})`);
          }
        }

        observedCostUsd += iterationCostUsd;
        await writeIterationCheckpoint(
          checkpointKey,
          { proposed, resolved, costUsd: iterationCostUsd },
          (m) => ctx.log(`entity_imagery: ${m}`),
        );
        return { proposed, resolved };
      },
      critique: async (candidate, iter) => {
        // A narration with no depictable named entities is a legitimate, common
        // outcome (abstract//essayistic scripts). Retrying buys the identical
        // answer, so accept and let the footage layer carry the visuals.
        if (candidate.proposed.length === 0) {
          ctx.log("entity_imagery: no named entities in this narration — accepting the empty set");
          return { score: 1, pass: true, issues: [] };
        }
        // DETERMINISTIC: entities were proposed but none survived lookup +
        // identity verification. That IS worth one informed retry with
        // different picks, and it costs nothing to detect.
        if (candidate.resolved.length === 0) {
          return {
            score: 0.2,
            pass: false,
            issues: [
              `none of [${candidate.proposed.join(", ")}] resolved to a verified image — ` +
              `pick entities with well-known, unambiguous photographs`,
            ],
          };
        }
        if (!critiqueEnabled) return { score: 1, pass: true, issues: [] };
        try {
          const verdict = await claudeJson<{ pass?: boolean; score?: number; issues?: string[] }>({
            prompt:
              `Judge a set of named entities chosen to be shown as on-screen imagery during this ` +
              `narration. Reject the SET if the entities are peripheral to the argument, redundant ` +
              `with each other, clustered in one passage instead of spread across the piece, or ` +
              `tonally wrong for the channel.` +
              channelCritiqueBrief(entityChannel) +
              ` Return STRICT JSON {"pass": boolean, "score": number 0..1, "issues": string[]} — at ` +
              `most 4 issues, each under 140 characters.\n\nENTITIES: ` +
              candidate.resolved.map((r) => r.entity).join(", ") +
              `\n\nNARRATION (excerpt):\n` + narration.slice(0, 3000),
            maxTokens: 700,
            temperature: 0.3,
          });
          observedCostUsd += PRICE.boundedTextPassUsd;
          const issues = (Array.isArray(verdict.issues) ? verdict.issues : []).filter(Boolean).slice(0, 4);
          const rejected = verdict.pass === false;
          const rejectionIssues = issues.length
            ? issues
            : ["independent entity-imagery critic rejected the set without usable remediation"];
          const score = Number.isFinite(verdict.score)
            ? Math.max(0, Math.min(1, Number(verdict.score)))
            : rejected ? 0.4 : 1;
          if (rejected) {
            ctx.log(
              `entity_imagery: selection ${iter} rejected by the critic` +
              (iter < 2 ? " — re-selecting with the defects fed back" : " — iteration cap reached"),
              { issues: rejectionIssues },
            );
          }
          return rejected
            ? { score: Math.min(0.99, score) + 0.01 * iter, pass: false, issues: rejectionIssues }
            : { score, pass: true, issues: [] };
        } catch (e) {
          return {
            score: 0,
            pass: false,
            issues: [
              `independent entity-imagery critic unavailable (${e instanceof Error ? e.message : e})`,
            ],
          };
        }
      },
    });

    // Materialize ONLY an independently accepted set. Ken Burns encoding is local compute, so
    // deferring it out of `produce` means a rejected candidate never pays for it.
    if (critiqueEnabled && !loop.accepted) {
      ctx.log(
        `entity_imagery: no accepted entity set after ${loop.iterations} attempt(s); ` +
          "falling back to primary footage rather than materializing unreviewed imagery",
        { issues: loop.critique.issues.slice(0, 4) },
      );
      return {
        entityClips: [],
        entityKeys: [],
        attributions: [],
        [COST_PATCH_KEY]: observedCostUsd,
      };
    }
    const tmp = await makeRunTempDir(ctx.runId);
    let i = 0;
    for (const r of loop.value.resolved) {
      try {
        const img = await downloadTo(r.url, join(tmp, `entity_${i}.jpg`));
        const clip = await kenBurns(img, join(tmp, `entity_${i}.mp4`), 5, W, H);
        clips.push(clip);
        if (r.attribution) attributions.push(`${r.entity}: ${r.attribution}`);
        ctx.log(`entity_imagery: "${r.entity}" â†’ verified Ken Burns clip`);
        i++;
      } catch (err) {
        ctx.log(`entity_imagery: "${r.entity}" failed (${err instanceof Error ? err.message : err})`);
      }
    }
    ctx.log(
      `entity_imagery: ${clips.length} entity clip(s), ${attributions.length} attribution(s) ` +
      `(${loop.iterations} iter, ${loop.accepted ? "accepted" : "best-effort"})`,
    );
    return {
      entityClips: clips,
      entityKeys: await uploadEntityKeys(clips),
      attributions,
      [COST_PATCH_KEY]: observedCostUsd,
    };
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
    if (!hasAnthropicKey() || timings.length === 0) {
      ctx.log("quote_overlays: skipping (no permitted text planner or no sentence timings)");
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
      const res = await claudeJson<{ quotes?: { index?: number; highlights?: string[] }[] }>({
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
    assertCinematicAssemblyRoute({
      useAssemblyEdl: ctx.params["useAssemblyEdl"],
      scenePlan: ctx.store["cinematicGeneratedScenePlan"],
      editDecisionList: ctx.store["cinematicEditDecisionList"],
      footageManifest: ctx.store["generatedFootageSceneManifest"],
    });
    // ========================================================================
    // ⚠️  USE_ASSEMBLY_EDL — DELIBERATELY-GATED, NOT-YET-VALIDATED CUTOVER PATH
    // ========================================================================
    // Everything BELOW this branch is the legacy god-block: the compose/heal
    // code that has rendered every video this studio has ever shipped. The
    // branch swaps it wholesale for the standalone Assembly module
    // (`assembleViaEdl` — plan → renderTimeline → ffmpeg backend).
    //
    // IT IS OFF FOR EVERY CHANNEL AND MUST STAY THAT WAY UNTIL A REAL RENDER
    // PROVES PARITY. What is actually proven today is narrow: the
    // DETERMINISTIC PLAN MATH matches (scripts/assembly-parity.ts — duration,
    // per-clip screen time, interleave order, card presence, coverage), and
    // the adapter emits all 11 keys this block `produces`
    // (src/lib/assembly/__tests__/cutover.test.ts). NOTHING has proven that
    // the finished MP4 is equivalent. The bar before this goes anywhere near a
    // default is the `essay`-preset parity claim demonstrated on a REAL RENDER,
    // compared side-by-side against the god-block's output for the same run.
    //
    // Enabling it is an OPERATOR decision, on ONE channel, reversible in one
    // config write — never an engineering default and never a code edit:
    //
    //   setModuleConfig(channelId, "timeline_assemble", { useAssemblyEdl: true })
    //
    // The switch is the `useAssemblyEdl` knob on ASSEMBLY_SURFACE
    // (src/lib/assembly/module.ts), default `false`, deliberately absent from
    // every preset. runPipeline only folds EXPLICITLY-CHOSEN knobs into
    // `ctx.params` (runPipeline.ts:488-496), so a channel that has never
    // written this knob has no `useAssemblyEdl` key here at all.
    //
    // `=== true` — not truthiness — so an absent key, a stale string "true", or
    // any half-written config falls through to the legacy path. The import is
    // DYNAMIC so the default path does not even evaluate the module.
    //
    // No `profile` is passed on purpose: with one, `assembleViaEdl` layers
    // per-account params + Editor directives on top, which ADDS divergence.
    // Params-only is the configuration the parity script actually covers.
    // ========================================================================
    if (ctx.params["useAssemblyEdl"] === true) {
      ctx.log(
        "timeline_assemble: useAssemblyEdl=true for this channel — composing through the standalone " +
          "Assembly EDL module (assembleViaEdl) instead of the legacy god-block path. " +
          "UNVALIDATED CUTOVER: no real-render parity proof exists yet.",
      );
      const { assembleViaEdl } = await import("@/lib/assembly/cutover");
      const produced = await assembleViaEdl({
        // Copies, not the live bags: the adapter can never mutate this block's
        // readonly store or the frozen run params.
        store: { ...ctx.store },
        params: { ...ctx.params },
        runId: ctx.runId,
        keyPrefix: ctx.keyPrefix,
      });
      // Spread widens the `AssembleProduces` interface (no index signature) into
      // a BlockPatch. All 11 declared `produces` keys are carried — the adapter's
      // key contract is pinned in src/lib/assembly/__tests__/cutover.test.ts.
      return { ...produced };
    }

    const footage = ctx.store["footageClips"] as string[] | undefined;
    const narration = str(ctx, "narrationLocalPath");
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 60;
    const cinematicPlanRaw = ctx.store["cinematicGeneratedScenePlan"];
    const cinematicEditRaw = ctx.store["cinematicEditDecisionList"];
    const generatedFootageRaw = ctx.store["generatedFootageSceneManifest"];
    const cinematicManifestSignaled = Boolean(
      generatedFootageRaw &&
      typeof generatedFootageRaw === "object" &&
      (generatedFootageRaw as Record<string, unknown>)["source"] === "cinematic_case_sequence",
    );
    const cinematicArtifactsPresent = cinematicPlanRaw !== undefined || cinematicEditRaw !== undefined || cinematicManifestSignaled;
    // This is the final pre-spend boundary for a source-bound cinematic body.
    // The regular binding proves the three upstream receipts agree; the durable
    // handoff additionally proves their timelines are contiguous, ordered, and
    // safe for the exact concat renderer. Do not use raw generated-footage
    // items here: matching-but-gapped timestamps would otherwise pass the
    // receipt comparison and make composeWithIntro loop a previous shot.
    const cinematicAssemblyHandoff = cinematicArtifactsPresent
      ? createCinematicAssemblyHandoff({
          scenePlan: cinematicPlanRaw,
          editDecisionList: cinematicEditRaw,
          footageManifest: generatedFootageRaw,
          narrationDurationSec: narrationSec,
        })
      : undefined;
    const cinematicFootageManifest = cinematicAssemblyHandoff?.manifest;
    // The generated-footage manifest is the only reliable signal that this
    // body came from LTX rather than ordinary stock/entity sources. Preserve
    // its in-world audio when available; cinematic Casefile is stricter and
    // requires every admitted LTX take to carry the worker-attested stream.
    const generatedLtxBodyAudio = Boolean(
      generatedFootageRaw &&
      typeof generatedFootageRaw === "object" &&
      typeof (generatedFootageRaw as Record<string, unknown>)["source"] === "string",
    );
    const bodyAudioMode: "off" | "available" | "required" = cinematicFootageManifest
      ? "required"
      : generatedLtxBodyAudio
        ? "available"
        : "off";
    const authoredManifest = ctx.store["shotRenderManifest"]
      ? validateQualifiedShotRender({
          manifest: ctx.store["shotRenderManifest"],
          qaReport: ctx.store["shotQaReport"],
          coverage: ctx.store["visualCoverage"],
        }).manifest
      : undefined;
    if (authoredManifest && cinematicFootageManifest) {
      throw new Error("timeline_assemble: cannot combine a shot-render manifest with an exact cinematic generated-footage manifest");
    }
    if ((!footage || footage.length === 0) && !authoredManifest && !cinematicFootageManifest) {
      throw new Error("timeline_assemble: no footageClips");
    }
    // Interleave entity images (Ken Burns) amongst the stock b-roll so named
    // figures (e.g. Marcus Aurelius) appear when relevant.
    const entity = authoredManifest || cinematicFootageManifest ? [] : ((ctx.store["entityClips"] as string[] | undefined) ?? []);
    const clips: string[] = [];
    const maxn = Math.max(footage?.length ?? 0, entity.length);
    for (let k = 0; k < maxn; k++) {
      if (footage?.[k]) clips.push(footage[k]);
      if (entity[k]) clips.push(entity[k]);
    }
    if (authoredManifest && Math.abs(authoredManifest.durationSec - narrationSec) > 0.02) {
      throw new Error(
        `timeline_assemble: authored story duration ${authoredManifest.durationSec}s does not match narration ${narrationSec}s`,
      );
    }
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;
    // Intro = title card over a music-only opener (no narration yet). Tail = a
    // few silent seconds past the narration, fading to black (clean ending, no
    // end text). So narration time < video time, by design.
    let introCardPath = opt(ctx, "introCardPath"); // "" if the card render failed
    // FLAG/VIDEO CONTRACT: when intro_card says applied=true, the card file
    // MUST exist here — a greedy rehydrate once dropped the path on the render
    // child, the video composed WITHOUT the card, and qa then trusted the flag
    // (a card-less video shipped "introApplied=true"). Re-fetch from the R2
    // key; still missing -> FAIL LOUD so the heal re-runs the lineage.
    if (!introCardPath && ctx.store["introApplied"] === true) {
      const icKey = ctx.store["introCardKey"] as string | undefined;
      if (icKey) {
        try {
          const p2 = join(await makeRunTempDir(ctx.runId), "introcard_refetch.mp4");
          await writeBytes(p2, await getObjectBytes(icKey));
          introCardPath = p2;
          ctx.log("timeline_assemble: intro card re-fetched from R2 (local path was lost)");
        } catch (e) {
          ctx.log(`timeline_assemble: intro card re-fetch failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (!introCardPath) {
        throw new Error("timeline_assemble: introApplied=true but the intro card cannot be materialized (intro card missing: intro_card render failed upstream)");
      }
    }
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

    // TYPED HEAL CLASS (P0-1 step 2) — the repair strategy is now DECLARED by
    // the healer's defect catalog (`HealClass` in engine/healer.ts) and read
    // here as a typed field, instead of being re-derived by running a regex
    // over the hint prose.
    //
    // The regex below it is what that replaced, and it is the reason this
    // comment exists: the hints are human-readable diagnosis strings whose
    // wording is not a contract, so a hint reworded upstream silently stopped
    // matching and EVERY overlay-class heal paid the full ~40-min recompose —
    // a permanent heal outage nothing could detect, because both branches
    // produce a correct video and only the bill differs.
    //
    // It is kept ONLY as the fallback for a heal payload that carries no
    // declared class (a run resumed from a store seeded by the previous
    // deploy). Once a class is present it is authoritative and the prose is
    // never consulted.
    const declaredHealClasses = readDeclaredHealClasses(ctx.store["healClasses"], "timeline_assemble");
    const overlayClassHeal = declaredHealClasses.length > 0
      // `every`, not `some`: a mixed diagnosis (an overlay defect AND a body
      // defect in the same failure) must take the branch that can actually fix
      // both. Re-finishing cannot repair the body, so it loses the tie.
      ? declaredHealClasses.every((healClass) => healClass === "overlay_finish")
      : healHints.length > 0 &&
        /overlay|caption|quote|insert|card text|outro text/i.test(healHints) &&
        !/black|dead.?air|footage|off.?world|cut|loop|duration|length/i.test(healHints);
    if (declaredHealClasses.length > 0) {
      ctx.log(
        `timeline_assemble: heal class declared by the healer [${declaredHealClasses.join(", ")}] → ` +
        `${overlayClassHeal ? "surgical re-finish" : "full rebuild"} (no prose matching)`,
      );
    } else if (healHints.length > 0) {
      ctx.log("timeline_assemble: heal payload carries no declared heal class — falling back to legacy hint matching");
    }
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

    if (cinematicFootageManifest) {
      const cinematicPaths: string[] = [];
      for (const [index, item] of cinematicFootageManifest.items.entries()) {
        const local = join(tmp, `cinematic_source_${String(index).padStart(4, "0")}.mp4`);
        await writeBytes(local, await getObjectBytes(item.clipKey));
        cinematicPaths.push(local);
      }
      ctx.log(
        `timeline_assemble: exact cinematic body from ${cinematicPaths.length} source-bound multi-shot clip(s); ` +
          `sequence ${cinematicFootageManifest.sequenceFingerprint.slice(0, 12)}`,
      );
      concat = await assembleAuthoredBody({
        clipPaths: cinematicPaths,
        segDurationsSec: cinematicFootageManifest.items.map((item) => item.t1 - item.t0),
        outPath: join(tmp, "body.mp4"),
        tmpDir: tmp,
        tailHoldSec: tailSec,
        width: W,
        height: H,
        bodyAudioMode,
      });
    } else if (authoredManifest) {
      const authoredPaths: string[] = [];
      for (const [index, item] of authoredManifest.items.entries()) {
        const local = join(tmp, `authored_source_${String(index).padStart(4, "0")}.mp4`);
        await writeBytes(local, await getObjectBytes(item.clipKey));
        authoredPaths.push(local);
      }
      ctx.log(`timeline_assemble: exact authored body from ${authoredPaths.length} QA-passed shot(s)`);
      concat = await assembleAuthoredBody({
        clipPaths: authoredPaths,
        segDurationsSec: authoredManifest.items.map((item) => item.t1 - item.t0),
        outPath: join(tmp, "body.mp4"),
        tmpDir: tmp,
        tailHoldSec: tailSec,
        width: W,
        height: H,
      });
    } else if (chapterPlan && chapterPlan.length > 0) {
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
        bodyAudioMode,
        maxSegSec: bodyMaxSeg,
      });
    } else {
      ctx.log(`timeline_assemble: beat-body from ${clips.length} clips (${footage?.length ?? 0} footage + ${entity.length} entity) @ ${W}x${H}â€¦`);
      concat = await assembleBeatBody({
        clipPaths: clips,
        outPath: join(tmp, "body.mp4"),
        targetSec: narrationSec + tailSec + 3,
        tmpDir: tmp,
        beats,
        width: W,
        height: H,
        bodyAudioMode,
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
      bodyAudioMode,
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
  await putObjectFromFile(videoKey, finalVideo, { contentType: "video/mp4" });
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
  produces: ["qaPassed", "qaReport", "qualityEvidence", "temporalDynamism", "visualPacing", "reviewEvidence", "reviewResult", "reviewFingerprint"],
  paid: true,
  run: async (ctx) => {
    const productionQa = ctx.params["qaProfile"] !== "draft";
    let qaCost = qaVisualCost(ctx.params);
    const video = str(ctx, "videoLocalPath");
    const title = str(ctx, "title");
    const dur = Number(ctx.store["videoDurationSec"] ?? 0);
    const topic = opt(ctx, "topic") ?? title;
    const niche = opt(ctx, "niche");
    const contentLane = resolveContentLane({
      stored: ctx.params["contentLane"],
      pipeline: [],
    });
    // P1-1 / P1-17: the two per-channel inputs the quality loop was missing —
    // the operator's critic doctrine, and the lane's own quality calibration.
    const criticDoctrine = opt(ctx, "criticDoctrine");
    const laneQuality = laneQualityPolicy(contentLane);
    // Make the channel's stored QualityBar executable where an evaluator can
    // genuinely measure it. Its historic 0..2 target maps to the 0..10 QA
    // scales; dimensions without a matching evaluator remain visible gaps,
    // never invented scores.
    const qualityBar = ctx.store["qualityBar"] as {
      target?: unknown;
      dimensions?: Array<{ id?: unknown; description?: unknown }>;
    } | null;
    const qualityFloor = (dimensionIds: readonly string[], fallback: number): number => {
      if (!productionQa) return fallback;
      const target = Number(qualityBar?.target);
      const applies = Array.isArray(qualityBar?.dimensions) && qualityBar.dimensions.some(
        (dimension) => typeof dimension?.id === "string" && dimensionIds.includes(dimension.id),
      );
      if (!applies || !Number.isFinite(target) || target < 0 || target > 2) return fallback;
      return Math.max(fallback, Math.min(10, target * 5));
    };
    // P1-17: the lane raises the model-graded floors where that is meaningful
    // (a Short is judged harder than a lo-fi loop). Draft runs keep the loose
    // draft bar, and `qualityFloor` only ever RAISES, so a lane can tighten the
    // bar but never silently ship below the historic minimum.
    const videoMinimum = productionQa
      ? qualityFloor(["footage"], Math.max(6, laneQuality.visualScoreFloor))
      : qualityFloor(["footage"], 4);
    const thumbnailMinimum = productionQa
      ? qualityFloor(["thumbnail"], Math.max(5, laneQuality.thumbnailScoreFloor))
      : qualityFloor(["thumbnail"], 4);
    const audioMinimum = qualityFloor(["music", "voice"], 5);
    const brandMinimum = qualityFloor(["identity"], 5);
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

    // Detect the cinematic route before the overview vision call. A partial
    // cinematic handoff must not be able to hide behind qaProfile=draft and
    // spend on an advisory review before the stricter final-master contract
    // rejects it later in this block.
    const cinematicQaArtifactsPresent =
      ctx.store["cinematicGeneratedScenePlan"] !== undefined ||
      ctx.store["cinematicEditDecisionList"] !== undefined ||
      ctx.store["generatedFootageSceneManifest"] !== undefined;
    if (cinematicQaArtifactsPresent) {
      assertCinematicFinalMasterQaProfile(ctx.params["qaProfile"]);
    }

    // 3) Video frames (vision, separate).
    const vframes: string[] = [];
    for (const frac of [0.2, 0.5, 0.8]) {
      const f = join(tmp, `qa_v${Math.round(frac * 100)}.jpg`);
      try {
        await grabFrame(video, Math.max(0, dur * frac), f);
        vframes.push(f);
      } catch (e) {
        if (productionQa) {
          throw new Error(`qa_visual FAILED (required frame extraction @${frac}): ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    if (productionQa && vframes.length !== 3) {
      throw new Error(`qa_visual FAILED: required 3 overview frames, extracted ${vframes.length}`);
    }
    const video_ = await evaluateVisualFrames(vframes, { topic, niche });
    if (productionQa && video_.skipped) {
      throw new Error("qa_visual FAILED: required overview vision grader did not run");
    }

    // 3b) CHRONOLOGICAL RENDER WATCH. This is a sampled review, not a claim to
    // have watched every video frame. It catches defects spanning the sampled
    // timeline; the evidence ledger below records its coverage honestly.
    // AUDIO QA: Meta's audiobox-aesthetics scores production quality/enjoyment
    // of the final audio. Music lanes require it because audio is the product.
    let audioAestheticScore: number | undefined;
    if (ctx.params["audioQa"] === true) {
      try {
        const { scoreAudio } = await import("@/lib/audioQa");
        const tmpA = await makeRunTempDir(ctx.runId);
        const aq = await scoreAudio(video, tmpA, p.durationSec, (m) => ctx.log(`qa_visual: ${m}`));
        if (aq && Number.isFinite(aq.productionQuality)) {
          audioAestheticScore = aq.productionQuality;
        }
        if (aq && aq.productionQuality > 0 && aq.productionQuality < 5) {
          ctx.log(`qa_visual: LOW AUDIO production quality ${aq.productionQuality}/10`);
        }
      } catch (e) {
        if (productionQa) {
          throw new Error(`qa_visual FAILED: required audio aesthetic grader failed: ${e instanceof Error ? e.message : e}`);
        }
        ctx.log(`qa_visual: audio scoring skipped: ${e instanceof Error ? e.message : e}`);
      }
    }

    const watchDna = ctx.store["styleDNA"] as
      | { recurringSubject?: string; setting?: string; motifs?: string[] }
      | null;
    const transcriptCues = ((ctx.store["sentenceTimings"] as Array<{ text?: unknown; start?: unknown; end?: unknown }> | undefined) ?? [])
      .flatMap((cue) => {
        const startSec = Number(cue.start);
        const endSec = Number(cue.end);
        const text = typeof cue.text === "string" ? cue.text.trim() : "";
        return Number.isFinite(startSec) && Number.isFinite(endSec) && endSec >= startSec && text
          ? [{ text, startSec, endSec }]
          : [];
      });
    const reviewOverlays: VisualReviewOverlay[] = [];
    const rect = (value: unknown): [number, number, number, number] | undefined => {
      if (!Array.isArray(value) || value.length < 4) return undefined;
      const values = value.slice(0, 4).map(Number);
      return values.every(Number.isFinite) ? values as [number, number, number, number] : undefined;
    };
    const comicTimeline = ctx.store["motionComicTimeline"] as {
      bubbles?: Array<{ id?: unknown; startSec?: unknown; endSec?: unknown; rect?: unknown; keepClear?: unknown }>;
    } | undefined;
    for (const [index, bubble] of (comicTimeline?.bubbles ?? []).entries()) {
      const startSec = Number(bubble.startSec);
      const endSec = Number(bubble.endSec);
      const bubbleRect = rect(bubble.rect);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) continue;
      reviewOverlays.push({
        id: typeof bubble.id === "string" ? bubble.id : `comic-bubble-${index}`,
        startSec,
        endSec,
        kind: "comic_bubble",
        ...(bubbleRect ? { rect: bubbleRect } : {}),
        keepClear: Array.isArray(bubble.keepClear)
          ? bubble.keepClear.flatMap((box) => rect(box) ? [rect(box)!] : [])
          : [],
        expected: "A speech bubble that is fully inside its panel and does not cover a face or hero object",
      });
    }
    const addTimedOverlays = (raw: unknown, kind: VisualReviewOverlay["kind"]) => {
      if (!Array.isArray(raw)) return;
      raw.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        const startSec = Number(record["startSec"] ?? record["start"] ?? record["at"]);
        const duration = Number(record["durSec"] ?? record["durationSec"] ?? record["duration"] ?? 1.5);
        if (!Number.isFinite(startSec) || !Number.isFinite(duration)) return;
        reviewOverlays.push({
          id: `${kind ?? "overlay"}-${index}`,
          startSec,
          endSec: Math.max(startSec + 0.2, startSec + duration),
          kind,
        });
      });
    };
    addTimedOverlays(ctx.store["quoteOverlays"], "quote");
    addTimedOverlays(ctx.store["insertOverlays"], "insert");
    const repairFocus = Array.isArray(ctx.store["visualRepair"])
      ? ctx.store["visualRepair"].flatMap((signal) => {
          if (!signal || typeof signal !== "object") return [];
          const record = signal as Record<string, unknown>;
          const startSec = Number(record["startSec"]);
          const endSec = Number(record["endSec"] ?? startSec);
          return Number.isFinite(startSec) && Number.isFinite(endSec)
            ? [{ startSec, endSec, reason: "repair" as const }]
            : [];
        })
      : [];
    const channelReviewProfile = channelVisualReviewProfile({
      contentLaneKey: contentLane.key,
      primaryRenderer: contentLane.primaryRenderer,
      channelName: opt(ctx, "channelName"),
      persona: opt(ctx, "persona"),
      styleGrammar: opt(ctx, "styleGrammar"),
      // P1-1: the channel's own critic doctrine now reaches the mandatory
      // holistic gate. P1-17: the lane supplies what this lane's critic must
      // actively scrutinise.
      ...(criticDoctrine ? { criticDoctrine } : {}),
      laneEmphasis: laneQuality.emphasis,
      qualityDimensions: (qualityBar?.dimensions ?? []).flatMap((dimension) =>
        typeof dimension?.id === "string" ? [dimension.id] : [],
      ),
      // Reference-quality mechanics are appended to the persisted QualityBar
      // descriptions. Sending only short IDs made the final review generic;
      // these bounded criteria become reviewer input and fingerprint evidence.
      qualityCriteria: (qualityBar?.dimensions ?? []).flatMap((dimension) =>
        typeof dimension?.id === "string" && typeof dimension?.description === "string"
          ? [`${dimension.id}: ${dimension.description}`]
          : [],
      ),
    });
    const visualMatter = visualMatterFromUnknown(ctx.store["visualMatterManifest"]);
    const visualMatterLocks = visualMatterReviewLocks(visualMatter);
    // Assembly checks this binding on its legacy path, but QA must re-check it
    // too: Assembly EDL cutover and future assemblers must never turn a
    // source-bound sequence into a final master without retaining every
    // accepted keyframe and moving-clip review receipt.
    const cinematicPlanRaw = ctx.store["cinematicGeneratedScenePlan"];
    const cinematicEdlRaw = ctx.store["cinematicEditDecisionList"];
    const generatedFootageRaw = ctx.store["generatedFootageSceneManifest"];
    const cinematicManifestSignaled = Boolean(
      generatedFootageRaw &&
      typeof generatedFootageRaw === "object" &&
      (generatedFootageRaw as Record<string, unknown>)["source"] === "cinematic_case_sequence",
    );
    const cinematicArtifactsPresent = cinematicPlanRaw !== undefined || cinematicEdlRaw !== undefined || cinematicManifestSignaled;
    const cinematicBinding = cinematicArtifactsPresent
      ? assertCinematicSequenceRenderBinding({
          scenePlan: cinematicPlanRaw,
          editDecisionList: cinematicEdlRaw,
          footageManifest: generatedFootageRaw,
          narrationDurationSec: target,
        })
      : undefined;
    const cinematicSequenceInput = cinematicBinding
      ? CinematicCaseSequenceInputSchema.parse(ctx.store["cinematicCaseSequenceInput"])
      : undefined;
    const cinematicSequenceAdmission = cinematicBinding
      ? CinematicCaseSequenceAdmissionReceiptSchema.parse(ctx.store["cinematicCaseSequenceAdmission"])
      : undefined;
    if (cinematicBinding && (
      cinematicCaseSequenceContentFingerprint(cinematicSequenceInput!) !== cinematicBinding.scenePlan.sequenceFingerprint ||
      cinematicSequenceAdmission!.sequenceFingerprint !== cinematicBinding.scenePlan.sequenceFingerprint
    )) {
      throw new Error(
        "qa_visual FAILED: cinematic source sequence/admission do not bind the generated scenes retained in the final master",
      );
    }
    const authoredShotManifest = !cinematicBinding && ctx.store["shotRenderManifest"] !== undefined
      ? ShotRenderManifestSchema.parse(ctx.store["shotRenderManifest"])
      : undefined;
    const cinematicSequencePresent = cinematicBinding !== undefined;
    const cinematicReceiptEvidence = cinematicBinding
      ? [
          `cinematicSequence=${cinematicBinding.scenePlan.sequenceFingerprint}`,
          `acceptedKeyframes=${cinematicBinding.footageManifest.items.filter((item) => item.keyframeReview?.pass).length}/${cinematicBinding.footageManifest.items.length}`,
          `acceptedMovingTakes=${cinematicBinding.footageManifest.items.filter((item) => item.clipReview?.pass).length}/${cinematicBinding.footageManifest.items.length}`,
          `acceptedTransitions=${cinematicBinding.footageManifest.items.filter((item) => item.transitionToNextReview?.pass).length}/${Math.max(0, cinematicBinding.footageManifest.items.length - 1)}`,
        ]
      : [];
    const cinematicCreativeLocksRaw = ctx.store["cinematicCreativeLocks"];
    const cinematicCreativeLocks = cinematicCreativeLocksRaw === undefined
      ? undefined
      : CinematicCreativeLocksSchema.parse(cinematicCreativeLocksRaw);
    const cinematicEdl = cinematicEdlRaw === undefined
      ? undefined
      : CinematicEditDecisionListSchema.parse(cinematicEdlRaw);
    if (cinematicSequencePresent && (!cinematicCreativeLocks || !cinematicEdl)) {
      throw new Error(
        "qa_visual FAILED: cinematic sequence requires its reviewer-facing creative locks and exact edit decision list",
      );
    }
    if (
      cinematicCreativeLocks && cinematicEdl &&
      cinematicCreativeLocks.sequenceFingerprint !== cinematicEdl.sequenceFingerprint
    ) {
      throw new Error("qa_visual FAILED: cinematic creative locks and edit decision list do not bind the same sequence");
    }
    const cinematicFinalMasterQaAdmission = cinematicSequencePresent
      ? assertCinematicFinalMasterQaAdmission({
          admission: ctx.store["cinematicFinalMasterQaAdmission"],
          creativeLocks: cinematicCreativeLocks,
          editDecisionList: cinematicEdl,
        })
      : undefined;
    // The exact lock/cut count was admitted before Novita rendered. Charge the
    // same durable envelope here so the runner's stage ceiling and recorded
    // QA spend cannot silently diverge on a resumed final-master review.
    qaCost = qaVisualCost(ctx.params, cinematicFinalMasterQaAdmission?.reviewCostUsd);
    const cinematicBodyOffsetSec = ctx.store["introApplied"] === true && Number(ctx.store["introSec"]) > 0
      ? Number(ctx.store["introSec"])
      : 0;
    const cinematicQaEvidence = cinematicCreativeLocks && cinematicEdl
      ? cinematicFinalMasterQaEvidence({
          creativeLocks: cinematicCreativeLocks,
          editDecisionList: cinematicEdl,
          bodyOffsetSec: cinematicBodyOffsetSec,
        })
      : { creativeLocks: [], focusWindows: [] };
    const cinematicReviewLocks = cinematicQaEvidence.creativeLocks;
    const cinematicFocus = cinematicQaEvidence.focusWindows;
    // A Casefile cinematic sequence is stronger evidence than a family label:
    // it has source-admission and claim→shot-map receipts. Apply the existing
    // Fern-calibrated documentary mechanics to that final review only in this
    // state. This is not a similarity claim and does not impose true-crime
    // requirements on ordinary fiction that also uses the cinematic renderer.
    const casefileCinematicReference = cinematicSequencePresent &&
      ctx.store["casefileSourceAdmission"] !== undefined &&
      ctx.store["casefileEvidenceShotMapAdmission"] !== undefined
      ? referenceQualityContractFor("documentary_collage_short")
      : undefined;
    const casefileCinematicQualityCriteria = casefileCinematicReference
      ? casefileCinematicReference.requirements.map((requirement) => {
          const sources = requirement.sourceIds
            .map((id) => casefileCinematicReference.sources.find((source) => source.id === id)?.label ?? id)
            .join(", ");
          return [
            `Casefile cinematic reference-quality ${requirement.area} (${sources}; mechanics only, no automatic comparison): ${requirement.standard}`,
            `Required evidence: ${requirement.evidence.join(", ")}`,
          ].join(" ");
        })
      : [];
    const casefileCinematicReferenceEvidence = casefileCinematicReference
      ? [
          `casefileReferenceMechanics=${casefileCinematicReference.sources.map((source) => source.id).join(",")}`,
          `casefileReferenceRequirements=${casefileCinematicReference.requirements.map((requirement) => requirement.id).join(",")}`,
          "casefileReferenceComparison=mechanics-only-no-automatic-comparison",
        ]
      : [];
    const cinematicQualityEvidence = [
      ...cinematicReceiptEvidence,
      ...casefileCinematicReferenceEvidence,
    ];
    const channelWorld = [
      watchDna?.recurringSubject
        ? [watchDna.recurringSubject, watchDna.setting, ...(watchDna.motifs ?? []).slice(0, 4)]
            .filter(Boolean)
            .join("; ")
        : "",
      channelReviewProfile.channelWorld ?? "",
      visualMatter?.status !== "disabled" ? visualMatter?.channelWorld ?? "" : "",
      cinematicSequencePresent
        ? "source-bound faceless mannequin reconstruction; wardrobe, role, prop, camera, evidence, and cut rationale are locked per reviewed scene"
        : "",
    ].filter(Boolean).join("; ") || undefined;
    const reviewIntent = {
      title,
      topic,
      niche: niche ?? undefined,
      expectTitleCard: ctx.store["introApplied"] === true,
      expectOutroCard: ctx.store["outroApplied"] === true,
      expectChapters: ctx.params["chapterCards"] === true,
      channelWorld,
      expectedStructure: channelReviewProfile.expectedStructure,
      allowedVisualConditions: channelReviewProfile.allowedVisualConditions,
      ...(channelReviewProfile.criticDoctrine
        ? { criticDoctrine: channelReviewProfile.criticDoctrine }
        : {}),
      criticEmphasis: channelReviewProfile.criticEmphasis,
      qualityCriteria: [...channelReviewProfile.qualityCriteria, ...casefileCinematicQualityCriteria],
      transcriptCues,
      overlays: reviewOverlays,
      creativeLocks: [...visualMatterLocks, ...cinematicReviewLocks],
      focusWindows: [...repairFocus, ...cinematicFocus],
    };
    // This is the visual release gate. It persists timestamped scene/cue/overlay
    // evidence, reviews <=12-image chronological batches, then creates a dense
    // 2-fps focus pass for suspect or previously repaired intervals.
    // A cinematic master is a file, not just a logical scene plan. Hash its
    // exact bytes before extracting any final-review evidence so the persisted
    // frames and their fingerprint cannot later be paired with a replacement.
    const finalMasterSha256BeforeVisualReview = cinematicBinding && productionQa
      ? await sha256ShotAnalysisSource(video)
      : undefined;
    const visualReview = await reviewRender(video, p.durationSec, reviewIntent, {
      runId: ctx.runId,
      keyPrefix: ctx.keyPrefix,
      sourceSha256: finalMasterSha256BeforeVisualReview,
      required: productionQa,
      maxFrames: Number(ctx.params["visualReviewFrames"] ?? 48),
      maxFocusFrames: Number(ctx.params["visualReviewFocusFrames"] ?? 24),
      // A source-bound cinematic sequence has an accepted receipt for every
      // planned join. Its final review must inspect every one at 2fps; the
      // normal 24-frame repair cap would silently skip later cuts.
      requireCompleteFocusCoverage: cinematicSequencePresent,
      log: (message) => ctx.log(message),
    });
    // Close the final-master TOCTOU window opened by frame extraction and the
    // independent visual reviewer. A changed master cannot retain this review.
    const finalMasterSha256AfterVisualReview = cinematicBinding && productionQa
      ? await sha256ShotAnalysisSource(video)
      : undefined;
    if (cinematicBinding && productionQa && (
      !finalMasterSha256BeforeVisualReview ||
      visualReview.evidence.source.sha256 !== finalMasterSha256BeforeVisualReview ||
      finalMasterSha256AfterVisualReview !== finalMasterSha256BeforeVisualReview
    )) {
      throw new Error("qa_visual FAILED: cinematic final master changed during evidence-backed visual review");
    }
    if (productionQa && !visualReview.ran) {
      throw new Error("qa_visual FAILED: required evidence-backed visual reviewer did not run");
    }
    // Generic evidence review catches defects across the whole master. A
    // source-bound cinematic sequence also needs a second, strict semantic
    // receipt for every identity/wardrobe lock, factual claim, causal cut, and
    // tension transition. It receives only the exact evidence frames already
    // selected by reviewRender, never a new or partial frame sample.
    let cinematicFinalMasterQaReceipt: CinematicFinalMasterQaEvidenceReceipt | undefined;
    const cinematicFinalMasterSha256: string | undefined = finalMasterSha256AfterVisualReview;
    if (cinematicBinding && productionQa) {
      if (visualReview.verdict !== "pass") {
        throw new Error(
          `qa_visual FAILED: cinematic final-master evidence requires a passing general visual review (got ${visualReview.verdict})`,
        );
      }
      try {
        // The visual plan can only earn its causal cuts if the master still
        // speaks the exact reviewed Story Spine. Generic narration QA verifies
        // audio against its own transcript; this closes the source-bound gap.
        assertSourceBoundNarrationAlignment({
          sourceBoundStorySpine: ctx.store["sourceBoundStorySpine"],
          sentenceTimings: ctx.store["sentenceTimings"],
          narrationDurationSec: target,
          expectedCinematicBinding: {
            caseId: cinematicSequenceInput!.caseId,
            sourcePacketFingerprint: cinematicSequenceInput!.sourcePacketFingerprint,
            evidenceShotMapFingerprint: cinematicSequenceInput!.evidenceShotMapFingerprint,
            shotPlanFingerprint: cinematicSequenceInput!.shotPlanFingerprint,
          },
        });
        if (!cinematicFinalMasterSha256 || !visualReview.evidence.source.sha256) {
          throw new Error("cinematic final-master evidence is missing its mandatory source SHA-256");
        }
        const cinematicQaPlan = cinematicFinalMasterQaPlan({
          sequence: cinematicSequenceInput!,
          creativeLocks: cinematicCreativeLocks!,
          editDecisionList: cinematicEdl!,
          bodyOffsetSec: cinematicBodyOffsetSec,
        });
        cinematicFinalMasterQaReceipt = await reviewCinematicFinalMasterQaEvidence({
          plan: cinematicQaPlan,
          evidence: visualReview.evidence,
          framePaths: visualReview.framePaths,
          visualReviewFingerprint: visualReview.reviewFingerprint,
          finalMasterSha256: cinematicFinalMasterSha256,
        });
        if (cinematicFinalMasterQaReceipt.finalMasterSha256 !== visualReview.evidence.source.sha256) {
          throw new Error("cinematic final-master receipt SHA-256 does not match the visual-review evidence source");
        }
        // The strict cinematic receipt itself can take time to collect. Hash
        // once more before admitting it so both review layers attest the exact
        // file that will move into the remaining release checks.
        const finalMasterSha256AfterCinematicReceipt = await sha256ShotAnalysisSource(video);
        if (finalMasterSha256AfterCinematicReceipt !== cinematicFinalMasterSha256) {
          throw new Error("cinematic final master changed while its strict evidence receipt was being collected");
        }
        ctx.log(
          `qa_visual: cinematic final-master evidence PASS (${cinematicFinalMasterQaReceipt.locks.length} locks, ` +
            `${cinematicFinalMasterQaReceipt.claims.length} claim views, ${cinematicFinalMasterQaReceipt.cuts.length} causal cuts)`,
        );
      } catch (error) {
        throw new Error(
          `qa_visual FAILED: cinematic final-master continuity/cut/claim evidence was not accepted: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // The old native-video escalation uploaded the full master to Gemini. It is
    // retired under the no-Gemini production policy; the evidence-backed frame
    // review above remains the required, repairable quality path.
    if (ctx.params["nativeWatch"] === true) {
      ctx.log("qa_visual: nativeWatch is retired; using the configured no-Gemini QA routes only");
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
      if (productionQa) {
        throw new Error(`qa_visual FAILED: required thumbnail grader failed: ${e instanceof Error ? e.message : e}`);
      }
      ctx.log(`qa_visual: thumbnail check skipped (${e instanceof Error ? e.message : e})`);
    }
    if (productionQa && thumbnail.skipped) {
      throw new Error("qa_visual FAILED: required thumbnail grader did not run");
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
      visualReview: {
        ran: visualReview.ran,
        verdict: visualReview.verdict,
        defects: visualReview.defects,
        evidence: visualReview.evidence,
        summary: visualReview.summary,
        reviewFingerprint: visualReview.reviewFingerprint,
      },
    };

    // Hard-gate on egregious VISUAL defects (video frames + thumbnail). Footage
    // relevance is enforced at the SOURCE (stock_footage gate + evergreen
    // fallback), so here it's ADVISORY â€” a single borderline clip must not nuke a
    // fully-rendered, paid video. SEO/identity are advisory too (logged).
    const critical: string[] = [];
    // There is no title-card exemption: every executable thumbnail is a
    // Nano Banana scene plus deterministic typography, so the same visual bar
    // applies to every channel and every retry.
    if (!video_.skipped && video_.score < videoMinimum) {
      // Three overview frames are retained as a cheap health signal, but they
      // cannot overrule the evidence-backed chronological reviewer.
      ctx.log(`qa_visual: LOW overview score ${video_.score}/10 (advisory; visual review is authoritative): ${video_.issues.slice(0, 2).join("; ")}`);
    }
    if (!thumbnail.skipped && thumbnail.score < thumbnailMinimum) {
      critical.push(`thumbnail score ${thumbnail.score} below ${thumbnailMinimum}: ${thumbnail.issues.slice(0, 2).join("; ")}`);
    }
    if (!footage.skipped && footage.score < 5) {
      ctx.log(`qa_visual: LOW FOOTAGE score ${footage.score} (advisory): ${footage.issues.slice(0, 2).join("; ")}`);
    }
    // Deterministic FFmpeg/file/audio checks remain hard technical safety rails.
    // The visual release decision itself comes from visualReview below.
    const rv = await validateRender({
      videoPath: video,
      durationSec: p.durationSec,
      introSec: Number(ctx.store["introSec"] ?? 0),
      tailSec: Number(ctx.params["tailSec"] ?? 3),
      introApplied: ctx.store["introApplied"] === true,
      outroApplied: ctx.store["outroApplied"] === true,
      // Lane-aware dead-air threshold only: this gate stays deterministic and
      // the doctrine is carried for evidence, never to flip a verdict.
      channel: {
        contentLaneKey: contentLane.key,
        blackSegmentMinSec: laneQuality.blackSegmentMinSec,
        maxStaticHoldSec: laneQuality.maxStaticHoldSec,
        visualPacingPolicy: laneQuality.visualPacing,
        ...(criticDoctrine ? { criticDoctrine } : {}),
      },
      log: ctx.log,
    });
    let cinematicEditIntegrity: ReturnType<typeof evaluateCinematicEditIntegrity> | undefined;
    let authoredShotEditIntegrity: ReturnType<typeof evaluateAuthoredShotEditIntegrity> | undefined;
    // Adaptive PySceneDetect sees true shot boundaries rather than only large
    // FFmpeg marker deltas. It is required for every production lane whose
    // pacing policy expects moving/editable visuals; ambient and music lanes
    // remain explicitly exempt because their long continuous holds are the
    // deliberate product.
    let finalShotAnalysis: ReturnType<typeof analyzeShotBoundaries> | undefined;
    const requiresAdaptiveShotAnalysis = productionQa && rv.visualPacing.policy.mode !== "exempt";
    if (requiresAdaptiveShotAnalysis || cinematicBinding || authoredShotManifest) {
      try {
        const finalMasterSha256 = cinematicFinalMasterSha256 ?? await sha256ShotAnalysisSource(video);
        finalShotAnalysis = analyzeShotBoundaries({ videoPath: video, sourceSha256: finalMasterSha256 });
        if (cinematicBinding) {
          cinematicEditIntegrity = evaluateCinematicEditIntegrity({
            editDecisionList: cinematicBinding.editDecisionList,
            shotAnalysis: finalShotAnalysis,
            bodyOffsetSec: cinematicBodyOffsetSec,
          });
          if (!cinematicEditIntegrity.pass) {
            const missed = cinematicEditIntegrity.cuts
              .filter((cut) => !cut.matched)
              .map((cut) => `${cut.shotId}@${cut.expectedSec.toFixed(2)}s`)
              .join(", ");
            critical.push(
              `cinematic edit integrity: ${cinematicEditIntegrity.matchedCutCount}/${cinematicEditIntegrity.plannedCutCount} ` +
                `planned causal cuts were observed in the final master (missing ${missed})`,
            );
          }
        }
        if (authoredShotManifest) {
          authoredShotEditIntegrity = evaluateAuthoredShotEditIntegrity({
            manifest: authoredShotManifest,
            shotAnalysis: finalShotAnalysis,
            bodyOffsetSec: cinematicBodyOffsetSec,
          });
          if (!authoredShotEditIntegrity.pass) {
            const missed = authoredShotEditIntegrity.cuts
              .filter((cut) => !cut.matched)
              .map((cut) => `${cut.shotId}@${cut.expectedSec.toFixed(2)}s`)
              .join(", ");
            critical.push(
              `LTX edit integrity: ${authoredShotEditIntegrity.matchedCutCount}/${authoredShotEditIntegrity.plannedCutCount} ` +
                `authored shot boundaries were observed in the final master (missing ${missed})`,
            );
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (productionQa) {
          critical.push(
            requiresAdaptiveShotAnalysis
              ? `adaptive scene-analysis evidence unavailable: ${detail}`
              : `LTX edit integrity evidence unavailable: ${detail}`,
          );
        } else {
          ctx.log(`qa_visual: adaptive scene analysis unavailable in draft: ${detail}`);
        }
      }
    }
    const adaptiveSceneEvidence = finalShotAnalysis
      ? [
          `adaptiveSceneDetector=${finalShotAnalysis.provider}/${finalShotAnalysis.detector}`,
          `adaptiveSceneSource=${finalShotAnalysis.source.sha256}`,
          `adaptiveSceneCount=${finalShotAnalysis.scenes.length}`,
          `adaptiveSceneMaxSec=${Math.max(...finalShotAnalysis.scenes.map((scene) => scene.endSecExclusive - scene.startSec), 0).toFixed(2)}`,
        ]
      : [];
    // Any renderer can declare exact words and their intended frame times.
    // Treat malformed declarations or unavailable OCR as release blockers in
    // production: visible text is often the entire instructional payload.
    const rawOnScreenTextCues = ctx.store["onScreenTextCues"];
    const parsedOnScreenTextCues = rawOnScreenTextCues === undefined
      ? { success: true as const, data: [] as const }
      : TimedOnScreenTextCueSchema.array().safeParse(rawOnScreenTextCues);
    let onScreenTextEvidence: string[] = [];
    if (!parsedOnScreenTextCues.success) {
      if (productionQa) {
        critical.push(
          `on-screen text evidence is malformed: ${parsedOnScreenTextCues.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
    } else if (parsedOnScreenTextCues.data.length) {
      try {
        const sourceSha256 = await sha256OnScreenTextSource(video);
        const proof = await proveOnScreenText({
          videoPath: video,
          sourceSha256,
          cues: parsedOnScreenTextCues.data,
        });
        const failed = proof.cues.filter((cue) => !cue.passed);
        onScreenTextEvidence = [
          `onScreenTextOcr=${proof.engine.name}/${proof.engine.version}`,
          `onScreenTextCues=${proof.cues.length}`,
          `onScreenTextPass=${proof.passed}`,
          ...failed.slice(0, 3).map((cue) => `unreadable:${cue.id}=${cue.tokenCoverage.toFixed(2)}/${cue.minTokenCoverage.toFixed(2)}`),
        ];
        if (!proof.passed) {
          critical.push(
            `on-screen text legibility failure: ${failed.map((cue) => `${cue.id} ${cue.tokenCoverage.toFixed(2)} < ${cue.minTokenCoverage.toFixed(2)}`).join(", ")}`,
          );
        }
        ctx.log(`qa_visual: on-screen text OCR ${proof.passed ? "PASSED" : "FAILED"} (${proof.cues.length} required frame(s))`);
      } catch (error) {
        if (productionQa) {
          critical.push(`on-screen text evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
        } else {
          ctx.log(`qa_visual: on-screen text evidence skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const ltxEditIntegrityEvidence = cinematicEditIntegrity
      ? [
          `cinematicCuts=${cinematicEditIntegrity.matchedCutCount}/${cinematicEditIntegrity.plannedCutCount}`,
          `sceneMarkers=${cinematicEditIntegrity.observedCutCount}`,
        ]
      : authoredShotEditIntegrity
        ? [
            `authoredLtxCuts=${authoredShotEditIntegrity.matchedCutCount}/${authoredShotEditIntegrity.plannedCutCount}`,
            `sceneMarkers=${authoredShotEditIntegrity.observedCutCount}`,
          ]
        : [];
    if (rv.verdict === "fail") {
      critical.push(`render-validate: ${rv.defects.filter((d) => d.severity === "critical").map((d) => d.issue).join(" | ")}`);
    }
    if (!rv.ran) {
      critical.push("render-validate: deterministic evidence did not complete; release is fail-closed");
    }
    if (rv.visualPacing.verdict === "needs_human") {
      // A sparse scene-marker receipt is deliberately not mislabelled as a
      // cut-count failure. In production it does mean the final master needs
      // an accountable human confirmation that its continuous visual evolution
      // really matches the lane, rather than auto-publishing an uncalibrated
      // pacing claim.
      const pacingReview = `visual pacing ${rv.visualPacing.signal}: ${rv.visualPacing.detail ?? "scene-marker calibration requires human confirmation"}`;
      if (productionQa) {
        critical.push(pacingReview);
      } else {
        ctx.log(`qa_visual: ${pacingReview} (draft retained for review)`);
      }
    }
    if (visualReview.verdict === "fail") {
      critical.push(visualReviewFailureMessage(visualReview));
    } else if (visualReview.verdict === "needs_human") {
      critical.push(`visual review needs human confirmation: ${visualReview.summary}`);
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
    let finalAudioMeters: { integratedLufs: number | null; windowMeanDb: number | null } | undefined;
    try {
      const introW = Number(ctx.store["introSec"] ?? 0);
      const ears = await measureAudio(video, {
        windowStartSec: 0.5,
        windowDurSec: introW >= 2.5 ? introW - 1 : 0,
      });
      finalAudioMeters = ears;
      if (productionQa && ears.integratedLufs === null) {
        critical.push("audio loudness unavailable: production QA requires a measurable final mix");
      }
      if (ears.integratedLufs !== null && (ears.integratedLufs < -30 || ears.integratedLufs > -8)) {
        critical.push(`audio loudness ${ears.integratedLufs.toFixed(1)} LUFS outside the sane band [-30,-8]`);
      }
      if (productionQa && music.present && introW >= 2.5 && ears.windowMeanDb === null) {
        critical.push("music audibility unavailable: production QA requires a measurable intro window");
      }
      if (music.present && ears.windowMeanDb !== null && ears.windowMeanDb < -50) {
        critical.push(`music missing from mix: intro-window mean ${ears.windowMeanDb.toFixed(1)} dB despite a produced music track`);
      }
      ctx.log(`qa_visual: ears — integrated ${ears.integratedLufs ?? "?"} LUFS, intro-window ${ears.windowMeanDb ?? "?"} dB`);
    } catch (e) {
      if (productionQa) {
        critical.push(`audio meters unavailable: ${e instanceof Error ? e.message : e}`);
      } else {
        ctx.log(`qa_visual: audio meters skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Whole-mix loudness cannot prove that dialogue survived a music/FX pass.
    // Compare the actual authored narration waveform with the final master
    // after the planned intro offset. This is local signal-presence evidence,
    // not a claim that a waveform metric proves intelligibility.
    const narrationDuration = Number(ctx.store["narrationDurationSec"] ?? 0);
    const storedNarrationPath = typeof ctx.store["narrationLocalPath"] === "string"
      ? ctx.store["narrationLocalPath"]
      : undefined;
    const narrationKey = opt(ctx, "narrationKey");
    const expectsNarrationMixEvidence = narrationDuration >= 1.5 && Boolean(storedNarrationPath || narrationKey);
    let finalNarrationMix: { correlation: number | null; narrationStartSec: number } | undefined;
    let finalNarrationTranscript: { wordErrorRate: number; lexicalRecall: number; passed: boolean } | undefined;
    let narrationCueTiming: NarrationCueTimingEvidence | undefined;
    let narrationPerformance: ReturnType<typeof assertNarrationPerformanceEvidence> | undefined;
    const narrationPerformanceEvidence: string[] = [];
    const narrationCueTimingEvidence: string[] = [];
    if (expectsNarrationMixEvidence) {
      try {
        narrationPerformance = assertNarrationPerformanceEvidence(ctx.store["narrationPerformanceEvidence"]);
        if (Math.abs(narrationPerformance.durationSec - narrationDuration) > 0.75) {
          critical.push(
            `narration performance evidence duration ${narrationPerformance.durationSec.toFixed(2)}s does not bind the authored narration ${narrationDuration.toFixed(2)}s`,
          );
        }
        narrationPerformanceEvidence.push(
          `narrationPerformance=local_ffmpeg`,
          `narrationWps=${narrationPerformance.wordsPerSec.toFixed(2)}`,
          `narrationLufs=${narrationPerformance.integratedLufs.toFixed(1)}`,
        );
      } catch (error) {
        if (productionQa) {
          critical.push(`narration performance evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      try {
        let narrationPath = storedNarrationPath && existsSync(storedNarrationPath)
          ? storedNarrationPath
          : undefined;
        if (!narrationPath) {
          if (!narrationKey) throw new Error("narration local path is unavailable and no narrationKey can rehydrate it");
          narrationPath = join(tmp, "qa-narration-source.mp3");
          await writeBytes(narrationPath, await getObjectBytes(narrationKey));
        }
        // Prove that the authored narration source says the approved spoken
        // script. FFmpeg correlation below then proves that this same source
        // survived into the final master. Neither signal alone can establish
        // both facts.
        const expectedNarrationText = typeof ctx.store["narrationTranscriptText"] === "string"
          ? ctx.store["narrationTranscriptText"].trim()
          : "";
        if (productionQa && !expectedNarrationText) {
          critical.push("narration transcript evidence unavailable: narration_tts did not preserve the exact spoken script");
        } else if (expectedNarrationText) {
          try {
            const sourceSha256 = await sha256NarrationTranscriptSource(narrationPath);
            const proof = proveNarrationTranscript({
              audioPath: narrationPath,
              expectedText: expectedNarrationText,
              sourceSha256,
            });
            finalNarrationTranscript = {
              wordErrorRate: proof.assessment.wordErrorRate,
              lexicalRecall: proof.assessment.lexicalRecall,
              passed: proof.assessment.passed,
            };
            if (!proof.assessment.passed) {
              critical.push(
                `narration transcript fidelity failure: WER ${proof.assessment.wordErrorRate.toFixed(3)} / recall ${proof.assessment.lexicalRecall.toFixed(3)} outside certified bounds`,
              );
            }
            ctx.log(
              `qa_visual: narration transcript WER ${proof.assessment.wordErrorRate.toFixed(3)}, recall ${proof.assessment.lexicalRecall.toFixed(3)} ` +
              `(${proof.assessment.passed ? "passed" : "failed"})`,
            );
            try {
              narrationCueTiming = assertNarrationCueTimingEvidence({
                sentenceTimings: ctx.store["sentenceTimings"],
                transcriptProof: proof,
                narrationDurationSec: narrationPerformance?.durationSec ?? narrationDuration,
              });
              narrationCueTimingEvidence.push(
                `narrationCueTiming=${narrationCueTiming.timingAlignedTokenCount}/${narrationCueTiming.matchedTokenCount}`,
                `narrationCueMatch=${narrationCueTiming.matchedTokenRatio.toFixed(3)}`,
                `narrationCueAlignment=${narrationCueTiming.timingAlignedTokenRatio.toFixed(3)}`,
                `narrationCueMaxDriftSec=${narrationCueTiming.maxTimingDriftSec.toFixed(3)}`,
                "narrationCueEvaluator=faster-whisper-small.en/timestamped-source",
              );
              ctx.log(
                `qa_visual: narration cue timing ${narrationCueTiming.timingAlignedTokenCount}/${narrationCueTiming.matchedTokenCount} ` +
                `source words aligned (max drift ${narrationCueTiming.maxTimingDriftSec.toFixed(2)}s)`,
              );
            } catch (error) {
              if (productionQa) {
                critical.push(`narration cue timing evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
              } else {
                ctx.log(`qa_visual: narration cue timing evidence skipped: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          } catch (error) {
            if (productionQa) {
              critical.push(`narration transcript evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
            } else {
              ctx.log(`qa_visual: narration transcript evidence skipped: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
        const narrationStartSec = ctx.store["introApplied"] === true
          ? Math.max(0, Number(ctx.store["introSec"] ?? 0))
          : 0;
        const evidence = await measureNarrationMixCorrelation({
          narrationPath,
          masterPath: video,
          narrationStartSec,
        });
        finalNarrationMix = { ...evidence, narrationStartSec };
        if (productionQa && evidence.correlation === null) {
          critical.push("narration-mix evidence unavailable: production QA requires source-to-master correlation");
        } else if (evidence.correlation !== null && evidence.correlation < 0.2) {
          critical.push(`narration missing or masked in final mix: source correlation ${evidence.correlation.toFixed(2)} < 0.20`);
        }
        ctx.log(
          `qa_visual: narration-to-master correlation ${evidence.correlation?.toFixed(3) ?? "unmeasured"} ` +
            `(start ${narrationStartSec.toFixed(2)}s)`,
        );
      } catch (error) {
        if (productionQa) {
          critical.push(`narration-mix evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
        } else {
          ctx.log(`qa_visual: narration-mix evidence skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const narrationMixEvidence = finalNarrationMix
      ? [
          `narrationMixCorrelation=${finalNarrationMix.correlation ?? "unmeasured"}`,
          `narrationMixStartSec=${finalNarrationMix.narrationStartSec.toFixed(2)}`,
          "narrationMixEvaluator=ffmpeg/axcorrelate-presence-only",
        ]
      : [];
    const narrationTranscriptEvidence = finalNarrationTranscript
      ? [
          `narrationTranscriptWer=${finalNarrationTranscript.wordErrorRate.toFixed(3)}`,
          `narrationTranscriptRecall=${finalNarrationTranscript.lexicalRecall.toFixed(3)}`,
          `narrationTranscriptProof=${finalNarrationTranscript.passed ? "passed" : "failed"}`,
          "narrationTranscriptEvaluator=faster-whisper-small.en/offline",
        ]
      : [];
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
      if (Number.isFinite(overlapSec)) {
        metrics.overlapSec = overlapSec;
      } else if (!Array.isArray(ctx.store["quoteOverlays"]) || ctx.store["quoteOverlays"].length === 0) {
        // No quote overlays means there is no possible quote overlap. Supplying
        // the measured zero keeps a valid narrator-family critic assertion from
        // degrading into an unnecessary skipped result.
        metrics.overlapSec = 0;
      }
      const loopSeamDiff = Number(ctx.store["loopSeamDiff"] ?? NaN);
      if (Number.isFinite(loopSeamDiff)) metrics.loopSeamDiff = loopSeamDiff;

      // BATCHED vision judging: ALL vision assertions in ONE call (the
      // per-assertion loop cost up to 12 separate multi-image vision calls).
      // visionLocal has a hard 12-image input cap. The review module already
      // batches the full evidence ledger; the critic gets a bounded subset
      // here instead of silently dropping unseen paths.
      const judgeFrames = (visualReview.framePaths.length ? visualReview.framePaths : vframes).slice(0, 12);
      let visionVerdicts: Map<string, boolean | null> | undefined;
      const visionAssertions = spec.assertions.filter((a) => a.check === "vision");
      if (judgeFrames.length && visionAssertions.length) {
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
          if (productionQa) {
            critical.push(`validation-spec vision grader failed: ${e instanceof Error ? e.message : e}`);
          } else {
            ctx.log(`qa_visual: batched vision judge failed (assertions skipped): ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      if (productionQa) {
        for (const assertion of visionAssertions.filter((item) => item.severity === "block")) {
          if (typeof visionVerdicts?.get(assertion.id) !== "boolean") {
            critical.push(`validation-spec vision assertion ${assertion.id} was not graded`);
          }
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
          if (productionQa) {
            critical.push(
              `validation-spec (vision): ${visFailed.map((r) => `${r.id} (${r.note ?? "failed"})`).join("; ")}`,
            );
          } else {
            ctx.log(`qa_visual: validation-spec vision ADVISORY (NOT blocking): ${visFailed.map((r) => `${r.id} (${r.note ?? "failed"})`).join("; ")}`);
          }
        }
      }
    }

    const narrativeValidation = assessProductionValidationAcceptance(specOutcome);

    // A release result is evidence, not a marketing label. The raw receipt
    // records exactly what ran and leaves unmeasured axes visible; the
    // lane-aware production editorial contract below decides whether that
    // evidence is sufficient to upload.
    const assetQa = ctx.store["assetQaReport"] as Record<string, unknown> | undefined;
    const shotQa = ctx.store["shotQaReport"] as Record<string, unknown> | undefined;
    const storyCoverage = ctx.store["storyCoverage"] as Record<string, unknown> | undefined;
    const shotGrades = Array.isArray(shotQa?.["shots"])
      ? shotQa["shots"] as Array<Record<string, unknown>>
      : [];
    const scoredShots = shotGrades
      .map((grade) => ({ score: Number(grade["score"]), threshold: Number(grade["threshold"]) }))
      .filter((grade) => Number.isFinite(grade.score) && Number.isFinite(grade.threshold));
    const shotScore = scoredShots.length
      ? (scoredShots.reduce((sum, grade) => sum + grade.score, 0) / scoredShots.length) * 10
      : undefined;
    const shotMinimum = scoredShots.length
      ? (scoredShots.reduce((sum, grade) => sum + grade.threshold, 0) / scoredShots.length) * 10
      : undefined;
    const candidateCount = Number(assetQa?.["candidateCount"]);
    const selectedCandidates = Array.isArray(assetQa?.["selected"])
      ? assetQa!["selected"].length
      : undefined;
    const storyRatio = Number(storyCoverage?.["ratio"]);
    // A renderer-specific planning block may have already produced the durable
    // episode receipt (for example story_spine or short_strategy). Reuse its
    // measured provenance rather than reconstructing a weaker story claim from
    // final QA state. A mismatched/legacy receipt is ignored and cannot leak
    // provenance across content lanes.
    const storedEpisode = EpisodeSpecSchema.safeParse(ctx.store["episodeSpec"]);
    const storedStory = storedEpisode.success &&
      storedEpisode.data.lane.key === contentLane.key &&
      (storedEpisode.data.lane.renderer === undefined ||
        storedEpisode.data.lane.renderer === contentLane.primaryRenderer) &&
      storedEpisode.data.story.status === "measured"
      ? storedEpisode.data.story
      : undefined;
    const temporalDynamismPassed = rv.temporalDynamism.verdict === "pass" || rv.temporalDynamism.verdict === "not_required";
    const visualPacingPassed = rv.visualPacing.verdict === "pass" || rv.visualPacing.verdict === "not_required";
    const temporalDynamismEvidence = [
      `source=${rv.temporalDynamism.source}`,
      `verdict=${rv.temporalDynamism.verdict}`,
      `thresholdSec=${rv.temporalDynamism.thresholdSec ?? "exempt"}`,
      `maxFrozenHoldSec=${rv.temporalDynamism.maxFrozenHoldSec.toFixed(2)}`,
      `rawFrozenIntervals=${rv.temporalDynamism.frozenIntervals.length}`,
      `evaluatedFrozenIntervals=${rv.temporalDynamism.evaluatedIntervals.length}`,
      ...rv.temporalDynamism.violatingIntervals.slice(0, 6).map((interval) => (
        `repair=${interval.startSec.toFixed(2)}-${interval.endSec.toFixed(2)}s (${interval.durationSec.toFixed(2)}s frozen)`
      )),
    ];
    const visualPacingEvidence = [
      `source=${rv.visualPacing.source}`,
      `usable=${rv.visualPacing.usable}`,
      `verdict=${rv.visualPacing.verdict}`,
      `signal=${rv.visualPacing.signal}`,
      `mode=${rv.visualPacing.policy.mode}`,
      `changeCount=${rv.visualPacing.changeCount}`,
      `maxMarkerHoldSec=${rv.visualPacing.maxHoldSec.toFixed(2)}`,
      `medianMarkerHoldSec=${rv.visualPacing.medianHoldSec.toFixed(2)}`,
      `targetMarkerHoldSec=${rv.visualPacing.policy.maxMarkerHoldSec ?? "exempt"}`,
      `meetsPolicy=${rv.visualPacing.meetsPolicy ?? "exempt"}`,
      ...rv.visualPacing.changeTimestampsSec.slice(0, 8).map((timeSec) => `change@${timeSec.toFixed(2)}s`),
      ...(rv.visualPacing.detail ? [rv.visualPacing.detail] : []),
    ];
    const qualityEvidence = buildQualityEvidence({
      episode: {
        lane: { key: contentLane.key, renderer: contentLane.primaryRenderer },
        topic,
        title,
        durationSec: p.durationSec,
        story: storedStory
          ? {
              source: storedStory.source,
              beatCount: storedStory.beatCount,
              shotCount: storedStory.shotCount,
              coverageRatio: storedStory.coverageRatio,
            }
          : {
              source: Array.isArray(ctx.store["shotList"]) ? "validated-story-spine/v1" : undefined,
              beatCount: Array.isArray(ctx.store["narrativeBeats"]) ? ctx.store["narrativeBeats"].length : undefined,
              shotCount: Array.isArray(ctx.store["shotList"]) ? ctx.store["shotList"].length : undefined,
              coverageRatio: Number.isFinite(storyRatio) ? storyRatio : undefined,
            },
        candidateSelection: Number.isFinite(candidateCount) && selectedCandidates !== undefined
          ? {
              generated: candidateCount,
              selected: selectedCandidates,
              rejected: Math.max(0, candidateCount - selectedCandidates),
              evidence: ["assetQaReport"],
            }
          : undefined,
      },
      technical: {
        passed: rv.ran && rv.verdict === "pass" && p.hasVideo && p.hasAudio && lengthOk,
        evaluator: "ffprobe + deterministic render validation",
        evidence: [
          `render=${rv.verdict}`,
          `renderEvidence=${rv.ran ? "complete" : "incomplete"}`,
          `resolution=${p.width}x${p.height}`,
          `duration=${p.durationSec.toFixed(2)}s`,
          ...(finalAudioMeters ? [`loudness=${finalAudioMeters.integratedLufs ?? "unmeasured"}`] : []),
          ...narrationMixEvidence,
          ...narrationTranscriptEvidence,
          ...narrationPerformanceEvidence,
          ...narrationCueTimingEvidence,
          ...onScreenTextEvidence,
        ],
      },
      visual: visualReview.ran
        ? {
            passed: visualReview.verdict === "pass",
            evaluator: "scene/cue-aware evidence-backed visual review",
            evidence: [
              `frames=${visualReview.evidence.frames.length}`,
              `manifest=${visualReview.evidence.manifestKey ?? "not-persisted"}`,
              ...cinematicQualityEvidence,
              ...ltxEditIntegrityEvidence,
              ...adaptiveSceneEvidence,
              ...visualReview.defects.slice(0, 3).map((defect) => `@${defect.startSec.toFixed(1)} ${defect.category}`),
            ],
          }
        : undefined,
      temporal: shotScore !== undefined && shotMinimum !== undefined
        ? {
            passed: shotScore >= shotMinimum && temporalDynamismPassed && visualPacingPassed,
            score: shotScore,
            minimumScore: shotMinimum,
            evaluator: "qualified per-shot render QA + deterministic temporal dynamism + final-master visual pacing",
            evidence: [
              `gradedShots=${scoredShots.length}`,
              ...cinematicQualityEvidence,
              ...ltxEditIntegrityEvidence,
              ...adaptiveSceneEvidence,
              ...temporalDynamismEvidence,
              ...visualPacingEvidence,
            ],
          }
        : visualReview.ran
          ? {
              passed: visualReview.verdict === "pass" && temporalDynamismPassed && visualPacingPassed,
              evaluator: "scene/cue-aware visual review + deterministic temporal dynamism + final-master visual pacing",
              evidence: [
                `reviewedFrames=${visualReview.evidence.frames.length}`,
                `maxGapSec=${visualReview.evidence.coverage.maxGapSec}`,
                `manifest=${visualReview.evidence.manifestKey ?? "not-persisted"}`,
                visualReview.summary,
                ...cinematicQualityEvidence,
                ...ltxEditIntegrityEvidence,
                ...adaptiveSceneEvidence,
                ...temporalDynamismEvidence,
                ...visualPacingEvidence,
              ],
            }
          : undefined,
      narrative: specOutcome
        ? {
            passed: narrativeValidation.ready,
            evaluator: "critic validation specification",
            evidence: [
              `assertions=${specOutcome.results.length}`,
              `evaluated=${narrativeValidation.evaluatedAssertionCount}`,
              ...(narrativeValidation.blockers.length
                ? narrativeValidation.blockers
                : ["required critic assertions were measured and passed"]),
            ],
          }
        : undefined,
      audio: audioAestheticScore !== undefined
        ? {
            passed: audioAestheticScore >= audioMinimum && (
              !expectsNarrationMixEvidence || (finalNarrationMix?.correlation ?? 0) >= 0.2
            ),
            score: audioAestheticScore,
            minimumScore: audioMinimum,
            evaluator: "audio aesthetics grader",
            evidence: ["audiobox production quality", ...narrationMixEvidence, ...narrationTranscriptEvidence, ...narrationPerformanceEvidence, ...narrationCueTimingEvidence],
          }
        : finalAudioMeters
          ? {
              passed: finalAudioMeters.integratedLufs !== null && (
                !expectsNarrationMixEvidence || (finalNarrationMix?.correlation ?? 0) >= 0.2
              ),
              evaluator: "final-mix loudness meter (not an aesthetics score)",
              evidence: [
                `integratedLufs=${finalAudioMeters.integratedLufs ?? "unmeasured"}`,
                `introWindowDb=${finalAudioMeters.windowMeanDb ?? "unmeasured"}`,
                ...narrationMixEvidence,
                ...narrationTranscriptEvidence,
                ...narrationPerformanceEvidence,
                ...narrationCueTimingEvidence,
              ],
            }
          : undefined,
      brand: identity.skipped
        ? undefined
        : {
            passed: identity.score >= brandMinimum,
            score: identity.score,
            minimumScore: brandMinimum,
            evaluator: "channel identity grader",
            evidence: [
              `identityScore=${identity.score.toFixed(2)}`,
              `minimum=${brandMinimum.toFixed(2)}`,
              ...identity.issues.slice(0, 3),
            ],
          },
      requiredAudio: contentLane.key === "music_loop" || contentLane.key === "ambient_guided"
        ? { required: true, minimumScore: audioMinimum, label: "music-lane audio aesthetics" }
        : undefined,
    });
    if (!qualityEvidence.release.hardGateReady) {
      critical.push(`quality evidence: ${qualityEvidence.release.blockers.join("; ")}`);
    }
    if (productionQa && !narrativeValidation.ready) {
      critical.push(`critic evidence: ${narrativeValidation.blockers.join("; ")}`);
    }
    const editorialAcceptance = assessProductionEditorialAcceptance(qualityEvidence);
    if (productionQa && !editorialAcceptance.ready) {
      critical.push(`editorial acceptance: ${editorialAcceptance.blockers.join("; ")}`);
    } else if (!productionQa && !editorialAcceptance.ready) {
      ctx.log(`qa_visual: draft editorial gaps retained for review: ${editorialAcceptance.blockers.join(" | ")}`);
    }

    if (critical.length > 0) {
      // Throw ONLY the critical list. The old throw appended the full JSON
      // report, and the healer's regex rules then pattern-matched ADVISORY
      // strings inside it (thumbnail critiques, watch notes) — superseding the
      // wrong blocks and even tripping UNHEALABLE on non-gating text. The full
      // report still reaches the run record via the log line below.
      ctx.log(`qa_visual FAILED — full report (advisory context): ${JSON.stringify(report).slice(0, 4000)}`);
      throw new VisualReviewFailure(
        `qa_visual FAILED: ${critical.join(" | ")}`,
        visualRepairSignals(visualReview, reviewIntent),
      );
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
      qaReport: {
        ...report,
        ...(specOutcome ? { validation: specOutcome.results } : {}),
        renderValidation: {
          verdict: rv.verdict,
          ran: rv.ran,
          temporalDynamism: rv.temporalDynamism,
          visualPacing: rv.visualPacing,
          cinematicFinalMasterQaEvidence: cinematicFinalMasterQaReceipt,
          adaptiveShotAnalysis: finalShotAnalysis
            ? {
                provider: finalShotAnalysis.provider,
                detector: finalShotAnalysis.detector,
                sourceSha256: finalShotAnalysis.source.sha256,
                sceneCount: finalShotAnalysis.scenes.length,
              }
            : undefined,
          narrationMix: finalNarrationMix ?? undefined,
          narrationCueTiming,
        },
      },
      qualityEvidence,
      temporalDynamism: rv.temporalDynamism,
      visualPacing: rv.visualPacing,
      reviewEvidence: visualReview.evidence,
      reviewResult: {
        verdict: visualReview.verdict,
        defects: visualReview.defects,
        summary: visualReview.summary,
        focusWindows: visualReview.focusWindows,
      },
      reviewFingerprint: visualReview.reviewFingerprint,
      [COST_PATCH_KEY]: qaCost,
    };
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
  lengthCheck,
  captions,
  qaVisual,
];
