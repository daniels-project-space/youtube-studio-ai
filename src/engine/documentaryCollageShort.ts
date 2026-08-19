import { z } from "zod";
import {
  createShortCandidateSelection,
  createDirectShortStrategyManifest,
  parseShortStrategyManifest,
  rankShortCandidates,
  renderOrderedShortBeats,
  shortRenderDurationSec,
  ShortCandidateSetSchema,
  ShortQaCheckNameSchema,
  ShortClaimEvidenceSchema,
  ShortSourceSchema,
  type ShortCandidate,
  type ShortCandidateSelection,
  type ShortCandidateSet,
  type ShortClaimEvidence,
  type ShortBeat,
  type ShortQaCheckName,
  type ShortSource,
  type ShortStrategyManifest,
} from "./shortStrategyManifest";
import type { DocuAssetBrief, DocuPlan, DocuShotPlan } from "@/lib/documotion";
import type { DocuCamera, DocuCameraIntensity, DocuCameraMove } from "@/remotion/DocuMotion";
import type { DocuShotKind } from "@/remotion/docuStyles";

export const DOCUMENTARY_COLLAGE_SHORT_DURATION = {
  min: 35,
  default: 52,
  max: 60,
} as const;

const DOCUMENTARY_SHORT_ROLES = [
  "hook",
  "context",
  "conflict",
  "escalation",
  "reversal",
  "payoff",
  "cta",
] as const;

const DOCUMENTARY_SHORT_KINDS: readonly DocuShotKind[] = [
  "parallax_portrait",
  "evidence_board",
  "photo_slide",
  "collage_pan",
  "evidence_board",
  "depth_parallax",
  "quote_card",
];

export interface DocumentaryCollageShortStrategyInput {
  runId: string;
  channelId: string;
  topic: string;
  narrationText: string;
  targetDurationSec?: number;
  treatmentPreset?: string;
  /**
   * Required auditable sources for factual/context narration. At least one
   * externally reachable source record is required before the Short can render.
   */
  sources?: unknown;
  /** Per-claim source excerpts/locators; each locked claim requires evidence. */
  claimEvidence?: unknown;
}

const DocumentaryClaimEvidenceInputSchema = z.object({
  claimId: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  excerpt: z.string().trim().min(1),
  locator: z.string().trim().min(1).optional(),
}).strict();

/**
 * The durable timing shape produced by narrated long-form pipelines. Candidate
 * mining intentionally works only from these source timings; it never cuts or
 * reuses the long-form video master.
 */
export const DocumentarySentenceTimingSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
}).refine((value) => value.end > value.start, "sentence end must follow start");
export type DocumentarySentenceTiming = z.infer<typeof DocumentarySentenceTimingSchema>;

export interface DocumentarySpinoffCandidateMiningInput {
  /** Stable source-run/documentary identity, not the future Short run id. */
  documentaryId: string;
  title: string;
  sentenceTimings: unknown;
  sourceVideoId?: string;
  targetDurationSec?: number;
  maxCandidates?: number;
}

export interface DocumentarySpinoffCandidateMiningResult {
  candidateSet: ShortCandidateSet;
  candidateSelection: ShortCandidateSelection;
}

interface CandidateWindow {
  startIndex: number;
  endIndex: number;
  startSec: number;
  endSec: number;
  sentences: DocumentarySentenceTiming[];
}

/**
 * Mines a time-diverse, source-windowed documentary spinoff shortlist.
 *
 * This is deliberately a planning-only primitive: it does not crop the source
 * master, make a render, write to Convex, or create a publish intent. A caller
 * must launch a separate documentary-collage Short run from the selected
 * candidate, preserving independent upload/idempotency state.
 */
export function mineDocumentarySpinoffCandidates(
  input: DocumentarySpinoffCandidateMiningInput,
): DocumentarySpinoffCandidateMiningResult {
  const documentaryId = requireIdentifier(input.documentaryId, "documentaryId");
  const title = requireText(input.title, "title");
  const sourceVideoId = input.sourceVideoId === undefined
    ? undefined
    : requireIdentifier(input.sourceVideoId, "sourceVideoId");
  const targetDurationSec = resolveDuration(input.targetDurationSec);
  const maxCandidates = resolveCandidateLimit(input.maxCandidates);
  const timings = normalizedDocumentaryTimings(input.sentenceTimings);
  const rawWindows = candidateWindows(timings, targetDurationSec);
  if (rawWindows.length === 0) {
    throw new Error(
      `documentary spinoff mining needs at least one ${DOCUMENTARY_COLLAGE_SHORT_DURATION.min}-${DOCUMENTARY_COLLAGE_SHORT_DURATION.max}s sentence-aligned source window`,
    );
  }

  const sourceStartSec = timings[0]?.start ?? 0;
  const sourceEndSec = timings.at(-1)?.end ?? sourceStartSec;
  const shortlistedWindows = diversifyCandidateWindows(rawWindows, maxCandidates, sourceStartSec, sourceEndSec);
  const candidateSet = ShortCandidateSetSchema.parse({
    id: `candidate-set:${documentaryId}`,
    version: "1.0.0",
    candidates: shortlistedWindows.map((window, index) =>
      candidateForWindow({
        documentaryId,
        sourceVideoId,
        title,
        window,
        targetDurationSec,
        sourceStartSec,
        sourceEndSec,
        index,
      }),
    ),
  });
  const selectedCandidate = rankShortCandidates(candidateSet.candidates)[0];
  if (!selectedCandidate) throw new Error("documentary spinoff mining produced no selectable candidates");
  const candidateSelection = createShortCandidateSelection(
    candidateSet,
    selectedCandidate.id,
    "Deterministic, source-windowed shortlist across available documentary timing. Planning only: create a separate native Short run before rendering or publishing.",
  );
  return { candidateSet, candidateSelection };
}

function normalizedDocumentaryTimings(value: unknown): DocumentarySentenceTiming[] {
  const parsed = z.array(DocumentarySentenceTimingSchema).min(2).parse(value);
  const sorted = [...parsed]
    .map((timing, index) => ({ ...timing, id: timing.id ?? `sentence:${index + 1}` }))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].start <= sorted[index - 1].start) {
      throw new Error("documentary sentenceTimings must have strictly increasing starts");
    }
  }
  return sorted;
}

function candidateWindows(
  timings: readonly DocumentarySentenceTiming[],
  targetDurationSec: number,
): CandidateWindow[] {
  const windows: CandidateWindow[] = [];
  for (let startIndex = 0; startIndex < timings.length; startIndex++) {
    const startSec = timings[startIndex].start;
    let best: CandidateWindow | undefined;
    for (let endIndex = startIndex; endIndex < timings.length; endIndex++) {
      const endSec = timings[endIndex].end;
      const durationSec = endSec - startSec;
      if (durationSec > DOCUMENTARY_COLLAGE_SHORT_DURATION.max) break;
      if (durationSec < DOCUMENTARY_COLLAGE_SHORT_DURATION.min) continue;
      const next: CandidateWindow = {
        startIndex,
        endIndex,
        startSec,
        endSec,
        sentences: timings.slice(startIndex, endIndex + 1),
      };
      if (!best || Math.abs(durationSec - targetDurationSec) < Math.abs((best.endSec - best.startSec) - targetDurationSec)) {
        best = next;
      }
    }
    if (best) windows.push(best);
  }
  return windows;
}

function diversifyCandidateWindows(
  windows: readonly CandidateWindow[],
  limit: number,
  sourceStartSec: number,
  sourceEndSec: number,
): CandidateWindow[] {
  const count = Math.min(limit, windows.length);
  const sourceDuration = Math.max(0.001, sourceEndSec - sourceStartSec);
  const buckets: Array<CandidateWindow | undefined> = Array.from({ length: count });
  const quality = (window: CandidateWindow) => candidateWindowQuality(window);
  for (const window of windows) {
    const midpoint = (window.startSec + window.endSec) / 2;
    const normalized = Math.max(0, Math.min(0.999999, (midpoint - sourceStartSec) / sourceDuration));
    const bucket = Math.min(count - 1, Math.floor(normalized * count));
    if (!buckets[bucket] || quality(window) > quality(buckets[bucket]!)) buckets[bucket] = window;
  }
  const selected = buckets.filter((window): window is CandidateWindow => Boolean(window));
  const used = new Set(selected.map((window) => `${window.startIndex}:${window.endIndex}`));
  for (const window of [...windows].sort((left, right) => quality(right) - quality(left))) {
    if (selected.length >= count) break;
    const id = `${window.startIndex}:${window.endIndex}`;
    if (used.has(id)) continue;
    selected.push(window);
    used.add(id);
  }
  return selected.sort((left, right) => left.startSec - right.startSec);
}

function candidateForWindow(args: {
  documentaryId: string;
  sourceVideoId?: string;
  title: string;
  window: CandidateWindow;
  targetDurationSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  index: number;
}): ShortCandidate {
  const durationSec = roundSeconds(args.window.endSec - args.window.startSec);
  const text = args.window.sentences.map((sentence) => sentence.text).join(" ");
  const hasEvidenceLanguage = /\b(evidence|record|document|archive|ledger|report|data|proof|witness)\b/i.test(text);
  const hasTurnLanguage = /\b(but|however|then|until|instead|reversed|revealed|because|why|how)\b/i.test(text);
  const hasConcreteDetail = /\b\d{1,4}\b|\b[A-Z][a-z]{2,}\b/.test(text);
  const sourceDuration = Math.max(0.001, args.sourceEndSec - args.sourceStartSec);
  const sourcePosition = ((args.window.startSec + args.window.endSec) / 2 - args.sourceStartSec) / sourceDuration;
  const spread = Math.max(0, Math.min(1, 1 - Math.abs(sourcePosition - 0.5)));
  return {
    id: `candidate:${args.documentaryId}:window:${args.index + 1}`,
    origin: "documentary_spinoff",
    hook: shortPhrase(args.window.sentences[0]?.text ?? text, 24),
    premise: briefText(text, 500),
    estimatedDurationSec: durationSec,
    score: {
      hookStrength: scoreUnit(0.42 + (hasTurnLanguage ? 0.28 : 0) + (hasConcreteDetail ? 0.18 : 0)),
      selfContainment: scoreUnit(0.45 + Math.min(0.35, args.window.sentences.length * 0.05) + (hasTurnLanguage ? 0.12 : 0)),
      factualClarity: scoreUnit(0.4 + (hasConcreteDetail ? 0.26 : 0) + (hasEvidenceLanguage ? 0.2 : 0)),
      visualPotential: scoreUnit(0.4 + (hasEvidenceLanguage ? 0.32 : 0) + (hasConcreteDetail ? 0.12 : 0)),
      novelty: scoreUnit(0.52 + Math.min(0.24, Math.abs(sourcePosition - 0.5) * 0.48)),
      completionPotential: scoreUnit(0.94 - Math.min(0.42, Math.abs(durationSec - args.targetDurationSec) / args.targetDurationSec) + spread * 0.04),
    },
    sourceDocumentary: {
      documentaryId: args.documentaryId,
      title: args.title,
      ...(args.sourceVideoId ? { sourceVideoId: args.sourceVideoId } : {}),
      sourceWindow: { startSec: args.window.startSec, endSec: args.window.endSec },
      storyBeatIds: args.window.sentences.slice(0, 20).map((sentence) => sentence.id!),
    },
  };
}

function candidateWindowQuality(window: CandidateWindow): number {
  const text = window.sentences.map((sentence) => sentence.text).join(" ");
  const duration = window.endSec - window.startSec;
  const detail = /\b\d{1,4}\b|\b(evidence|record|document|archive|ledger|report|data|proof|witness)\b/i.test(text) ? 0.2 : 0;
  const turn = /\b(but|however|then|until|instead|reversed|revealed|because|why|how)\b/i.test(text) ? 0.2 : 0;
  return detail + turn + scoreUnit(1 - Math.abs(duration - DOCUMENTARY_COLLAGE_SHORT_DURATION.default) / DOCUMENTARY_COLLAGE_SHORT_DURATION.default);
}

function resolveCandidateLimit(value: number | undefined): number {
  const limit = value ?? 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("documentary spinoff maxCandidates must be an integer from 1 to 20");
  }
  return limit;
}

function scoreUnit(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

/**
 * Turns the approved script into a deterministic 7-beat vertical treatment.
 * The renderer receives this locked object; it is not allowed to invent a new
 * story structure downstream.
 */
export function buildDocumentaryCollageShortStrategy(
  input: DocumentaryCollageShortStrategyInput,
): ShortStrategyManifest {
  const topic = requireText(input.topic, "topic");
  const narrationText = requireText(input.narrationText, "narrationText");
  const targetDurationSec = resolveDuration(input.targetDurationSec);
  const lines = splitNarrationIntoBeats(narrationText, DOCUMENTARY_SHORT_ROLES.length);
  const wordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const minimumWords = Math.ceil(targetDurationSec * 1.84);
  if (wordCount < minimumWords) {
    throw new Error(
      `documentary collage Short needs at least ${minimumWords} narration words for ${targetDurationSec}s; received ${wordCount}`,
    );
  }

  const sources = resolveSources(input.sources, input.runId, topic);
  const claimIds = lines.map((_, index) => `claim:${index + 1}`);
  const evidenceByClaimId = resolveClaimEvidence(input.claimEvidence, claimIds, sources);
  const step = targetDurationSec / DOCUMENTARY_SHORT_ROLES.length;
  const durationAt = (index: number) => {
    const start = roundSeconds(index * step);
    return roundSeconds(index === DOCUMENTARY_SHORT_ROLES.length - 1 ? targetDurationSec - start : step);
  };

  const claims = lines.map((text, index) => {
    const id = claimIds[index];
    const evidence = evidenceByClaimId.get(id) ?? [];
    return {
      id,
      kind: index === 0 || index === lines.length - 1 ? "interpretation" as const : "context" as const,
      text,
      sourceIds: [...new Set(evidence.map((entry) => entry.sourceId))],
      evidence,
    };
  });

  const assets = lines.map((text, index) => ({
    id: `asset:${index + 1}`,
    kind: "image" as const,
    description: `Portrait-safe documentary collage plate for: ${briefText(text, 180)}`,
    provenance: {
      license: "generated" as const,
      // This expected receipt id is reconciled against the renderer's actual
      // approval hashes before release; raw provider URLs never enter the
      // durable strategy artifact.
      generationReceiptId: `documotion-render:${input.runId}:beat:${index + 1}`,
    },
    claimIds: [`claim:${index + 1}`],
  }));

  const beats = lines.map((text, index) => {
    const startSec = roundSeconds(index * step);
    const durationSec = durationAt(index);
    const role = DOCUMENTARY_SHORT_ROLES[index];
    const primaryLayerId = `layer:${index + 1}:primary`;
    const motion = motionForRole(role, index);
    return {
      id: `beat:${index + 1}`,
      order: index + 1,
      role,
      timing: { startSec, endSec: roundSeconds(startSec + durationSec) },
      claimIds: [`claim:${index + 1}`],
      scene: {
        id: `scene:${index + 1}`,
        durationSec,
        primaryVisualEvent: `Make the ${role} legible with an authored documentary collage: ${briefText(text, 240)}`,
        layers: [
          {
            id: `layer:${index + 1}:background`,
            role: "background" as const,
            content: "Native 9:16 text-free environment plate with clear central subject space.",
            opacity: 1,
          },
          {
            id: primaryLayerId,
            role: "primary" as const,
            assetId: `asset:${index + 1}`,
            opacity: 1,
          },
          {
            id: `layer:${index + 1}:texture`,
            role: "texture" as const,
            content: "Subtle archival paper grain and film texture, applied as a deterministic treatment.",
            opacity: 0.22,
          },
        ],
        motion: {
          primary: { ...motion, subjectLayerId: primaryLayerId },
          ambient: { family: "drift" as const, easing: "ease_in_out" as const, startPercent: 0, endPercent: 1, intensity: 0.18 },
        },
        caption: {
          text: overlayText(text),
          placement: index === 0 ? "top" as const : "lower_third" as const,
          maxLines: 2,
        },
      },
      audio: {
        narration: { text, delivery: role === "hook" ? "urgent" as const : role === "payoff" ? "reflective" as const : "measured" as const },
        musicCue: musicCueForRole(role),
        sfx: [{ cue: sfxForRole(role), offsetSec: 0.18, gainDb: -16 }],
      },
    };
  });

  const hardGates = [
    "caption_safe_zone",
    "claim_provenance",
    "asset_provenance",
    "narration_timing",
    "motion_alignment",
    "audio_mix",
    "visual_legibility",
    "no_baked_text",
  ] as const;

  return createDirectShortStrategyManifest({
    strategy: {
      shortId: `short:${input.runId}`,
      channelId: requireIdentifier(input.channelId, "channelId"),
      headline: overlayText(lines[0]),
      premise: `A source-traceable documentary Short about ${topic}.`,
      targetDurationSec,
      aspectRatio: "9:16",
      treatmentPreset: input.treatmentPreset?.trim() || "archival_collage_short/v1",
    },
    sources,
    claims,
    assets,
    beats,
    audioMix: {
      narratorProfile: "documentary foreground narration",
      targetLufs: -16,
      musicDuckUnderNarrationDb: -14,
      truePeakDb: -1,
    },
    qa: {
      plan: {
        hardGates: [...hardGates],
        sceneChecks: beats.map((beat) => ({ beatId: beat.id, checks: [...hardGates] })),
      },
    },
  });
}

/** Converts a locked beat manifest into DocuMotion's existing verified shot grammar. */
export function docuPlanForDocumentaryCollageShort(
  manifestInput: unknown,
  styleId = "archival_collage",
): DocuPlan {
  const manifest = parseShortStrategyManifest(manifestInput);
  const beats = renderOrderedShortBeats(manifest);
  return {
    title: manifest.strategy.headline,
    styleId,
    shots: beats.map((beat, index) => docuShotForBeat(beat, index)),
  };
}

export const ShortRetentionManifestSchema = z.object({
  version: z.literal("short-retention/v1"),
  lane: z.literal("documentary_collage_short"),
  durationSec: z.number().finite().positive(),
  fps: z.literal(30),
  beats: z.array(z.object({
    id: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
    purpose: z.string().min(1),
    motionRecipe: z.string().min(1),
    claimIds: z.array(z.string().min(1)),
    assetProvenanceIds: z.array(z.string().min(1)),
    captionCueId: z.string().min(1).optional(),
  }).strict()).min(5).max(7),
  variants: z.object({ hook: z.string().min(1).optional(), visual: z.string().min(1).optional() }).strict().optional(),
}).strict();
export type ShortRetentionManifest = z.infer<typeof ShortRetentionManifestSchema>;

/** Compact analytics handoff: identifiers and timing only, never asset URLs or render payloads. */
export function shortRetentionManifestForStrategy(manifestInput: unknown): ShortRetentionManifest {
  const manifest = parseShortStrategyManifest(manifestInput);
  const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  return ShortRetentionManifestSchema.parse({
    version: "short-retention/v1",
    lane: "documentary_collage_short",
    durationSec: shortRenderDurationSec(manifest),
    fps: 30,
    beats: renderOrderedShortBeats(manifest).map((beat) => ({
      id: beat.id,
      startFrame: Math.round(beat.timing.startSec * 30),
      endFrame: Math.max(1, Math.round(beat.timing.endSec * 30)),
      purpose: beat.role,
      motionRecipe: beat.scene.motion.primary.family,
      claimIds: beat.claimIds,
      assetProvenanceIds: beat.scene.layers
        .flatMap((layer) => (layer.assetId ? [assetById.get(layer.assetId)] : []))
        .flatMap((asset) => asset ? [asset.provenance.generationReceiptId ?? asset.provenance.sourceId ?? asset.id] : []),
      captionCueId: `caption:${beat.id}`,
    })),
    variants: { hook: manifest.strategy.headline, visual: manifest.strategy.treatmentPreset },
  });
}

export const ShortSceneQaSchema = z.object({
  version: z.literal("short-scene-qa/v1"),
  status: z.enum(["passed", "failed"]),
  checks: z.array(z.object({
    name: ShortQaCheckNameSchema,
    status: z.enum(["passed", "failed"]),
    detail: z.string().min(1),
  }).strict()),
  blockers: z.array(z.string().min(1)),
  geometry: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), layout: z.literal("short") }).strict(),
}).strict();
export type ShortSceneQa = z.infer<typeof ShortSceneQaSchema>;

export interface DocumentaryShortSceneQaInput {
  manifest: unknown;
  width: number;
  height: number;
  layout: string;
  durationSec: number;
  beatWindows: Array<{ id: string; durationSec: number }>;
  captionSafeFrame: { top: number; right: number; bottom: number; left: number };
  assetReceipts: Array<{
    receiptId: string;
    assetId: string;
    rendererAssetId: string;
    beatId: string;
    approvalSha256: string[];
  }>;
  visualVerifierPassed: boolean;
  audioOk: boolean;
}

/** Scene-level release gate aligned to the exact vertical render receipt. */
export function evaluateDocumentaryShortSceneQa(input: DocumentaryShortSceneQaInput): ShortSceneQa {
  const manifest = parseShortStrategyManifest(input.manifest);
  const expectedBeats = renderOrderedShortBeats(manifest);
  const expectedDuration = shortRenderDurationSec(manifest);
  const actualBeatIds = input.beatWindows.map((beat) => beat.id);
  const expectedBeatIds = expectedBeats.map((beat) => beat.id);
  const sameBeatOrder = actualBeatIds.length === expectedBeatIds.length && actualBeatIds.every((id, index) => id === expectedBeatIds[index]);
  const sameDuration = Math.abs(input.durationSec - expectedDuration) <= 0.1 &&
    input.beatWindows.every((window, index) => Math.abs(window.durationSec - (expectedBeats[index]?.scene.durationSec ?? 0)) <= 0.1);
  const sourcesById = new Map(manifest.sources.map((source) => [source.id, source]));
  const hasClaimProvenance = manifest.claims.every((claim) =>
    claim.evidence.length > 0 &&
    claim.evidence.every((evidence) => {
      const source = sourcesById.get(evidence.sourceId);
      return (
        claim.sourceIds.includes(evidence.sourceId) &&
        source?.type !== "internal_research" &&
        Boolean(source?.url)
      );
    }),
  );
  const expectedAssetIds = new Set(manifest.assets.map((asset) => asset.id));
  const receiptAssetIds = input.assetReceipts.map((receipt) => receipt.assetId);
  const receiptsByAssetId = new Map(input.assetReceipts.map((receipt) => [receipt.assetId, receipt]));
  const hasExactAssetReceiptSet =
    input.assetReceipts.length === manifest.assets.length &&
    receiptsByAssetId.size === manifest.assets.length &&
    receiptAssetIds.every((assetId) => expectedAssetIds.has(assetId));
  const hasAssetProvenance = hasExactAssetReceiptSet && manifest.assets.every((asset, index) => {
    const receipt = receiptsByAssetId.get(asset.id);
    return Boolean(
      receipt &&
      receipt.receiptId === asset.provenance.generationReceiptId &&
      receipt.rendererAssetId === asset.id &&
      receipt.beatId === expectedBeats[index]?.id &&
      receipt.approvalSha256.length > 0 &&
      receipt.approvalSha256.every((hash) => /^[a-f0-9]{64}$/i.test(hash)),
    );
  });
  const portraitGeometry = input.width === 1080 && input.height === 1920 && input.layout === "short";
  const safeFrame = input.captionSafeFrame;
  const captionSafeZone = portraitGeometry &&
    safeFrame.top >= input.height * 0.075 &&
    safeFrame.right >= input.width * 0.075 &&
    safeFrame.bottom >= input.height * 0.18 &&
    safeFrame.left >= input.width * 0.075 &&
    expectedBeats.every((beat) => beat.scene.caption.maxLines <= 2);

  const checks: Array<{ name: ShortQaCheckName; status: "passed" | "failed"; detail: string }> = [
    { name: "caption_safe_zone", status: captionSafeZone ? "passed" : "failed", detail: captionSafeZone ? "Native 1080x1920 renderer reserved the portrait safe frame and each beat is capped at two overlay lines." : "Short caption geometry or overlay-line constraints are outside the portrait safe frame." },
    { name: "claim_provenance", status: hasClaimProvenance ? "passed" : "failed", detail: hasClaimProvenance ? "Every beat claim links to an externally auditable source URL." : "One or more claims lack an external, auditable source URL." },
    { name: "asset_provenance", status: hasAssetProvenance ? "passed" : "failed", detail: hasAssetProvenance ? "Every planned asset reconciles to an actual renderer approval hash." : "One or more planned assets lack a matching renderer approval receipt." },
    { name: "narration_timing", status: sameDuration ? "passed" : "failed", detail: sameDuration ? "Rendered beat windows match the locked narration beat timing." : "Rendered beat timing drifted from the locked manifest." },
    { name: "motion_alignment", status: sameBeatOrder ? "passed" : "failed", detail: sameBeatOrder ? "Renderer preserved the ordered beat-to-motion mapping." : "Renderer beat order differs from the locked manifest." },
    { name: "audio_mix", status: input.audioOk ? "passed" : "failed", detail: input.audioOk ? "Narration/mix coverage verification passed." : "Narration/mix coverage verification failed." },
    { name: "visual_legibility", status: input.visualVerifierPassed ? "passed" : "failed", detail: input.visualVerifierPassed ? "DocuMotion visual verifier passed the portrait scene set." : "DocuMotion visual verifier rejected one or more scenes." },
    { name: "no_baked_text", status: input.visualVerifierPassed ? "passed" : "failed", detail: input.visualVerifierPassed ? "Text-free asset gate and deterministic overlay renderer passed." : "Visual verifier could not confirm the text-free asset treatment." },
  ];
  const blockers = checks.filter((check) => check.status === "failed").map((check) => `${check.name}: ${check.detail}`);
  return ShortSceneQaSchema.parse({
    version: "short-scene-qa/v1",
    status: blockers.length ? "failed" : "passed",
    checks,
    blockers,
    geometry: { width: input.width, height: input.height, layout: "short" },
  });
}

function docuShotForBeat(beat: ShortBeat, index: number): DocuShotPlan {
  const kind = DOCUMENTARY_SHORT_KINDS[index] ?? "photo_slide";
  const caption = overlayText(beat.scene.caption.text);
  const camera = cameraForMotion(beat.scene.motion.primary.family, beat.scene.motion.primary.intensity, index);
  const visualCues = [beat.scene.primaryVisualEvent, ...beat.scene.layers.flatMap((layer) => layer.content ? [layer.content] : [])]
    .map((cue) => briefText(cue, 220));
  const primaryAssetId = beat.scene.layers.find((layer) => layer.role === "primary")?.assetId;
  if (!primaryAssetId) throw new Error(`documentary collage Short beat ${beat.id} has no primary manifest asset`);
  const shot: DocuShotPlan = {
    kind,
    narration: beat.audio.narration.text,
    scale: index === 0 ? "establishing" : index === 1 ? "wide" : index === 6 ? "close" : index % 2 ? "medium" : "wide",
    beat: beat.scene.primaryVisualEvent,
    durationSec: beat.scene.durationSec,
    camera,
    title: caption,
    kicker: beat.role,
    labels: kind === "evidence_board" ? [
      { text: caption },
      { text: beat.role.toUpperCase() },
      { text: "SOURCE-TRACEABLE" },
    ] : [{ text: beat.role.toUpperCase(), sub: caption }],
    // Reuse the manifest asset id for the primary generated plate. The render
    // receipt can therefore prove this exact planned asset—not merely some
    // image generated in the same beat—passed the approval gate.
    assets: assetBriefsForShot(kind, index, visualCues, primaryAssetId),
    visualCues,
  };
  if (kind === "quote_card") {
    shot.quote = shortPhrase(beat.audio.narration.text, 16);
    delete shot.title;
    delete shot.labels;
  }
  return shot;
}

function assetBriefsForShot(
  kind: DocuShotKind,
  shotIndex: number,
  cues: string[],
  primaryAssetId: string,
): DocuAssetBrief[] {
  const subject = cues.join("; ");
  const make = (role: DocuAssetBrief["role"], count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => ({
      id: `s${shotIndex + 1}-${role}-${index + 1}`,
      role,
      source: "generate" as const,
      brief: `${prefix}: ${subject}`,
    }));
  const assets = (() => {
    switch (kind) {
    case "parallax_portrait":
      return [...make("bg", 1, "text-free establishing documentary environment"), ...make("fg", 1, "single portrait cutout subject")];
    case "evidence_board":
      return [...make("bg", 1, "text-free evidence-board background"), ...make("image", 3, "individual evidence photograph")];
    case "photo_slide":
      return [...make("bg", 1, "text-free documentary background plate"), ...make("image", 2, "tall editorial documentary photograph")];
    case "collage_pan":
      return [...make("bg", 1, "text-free collage board background"), ...make("image", 6, "tall archival collage photograph")];
    case "depth_parallax":
      return make("image", 1, "single sharp deep-focus documentary plate");
    case "quote_card":
      return make("bg", 1, "text-free atmospheric conclusion plate with negative space");
    default:
      return make("bg", 1, "text-free documentary plate");
    }
  })();
  const primaryRole: DocuAssetBrief["role"] = kind === "parallax_portrait"
    ? "fg"
    : ["evidence_board", "photo_slide", "collage_pan", "depth_parallax"].includes(kind)
      ? "image"
      : "bg";
  const primary = assets.find((asset) => asset.role === primaryRole) ?? assets[0];
  if (!primary) throw new Error(`documentary collage Short shot ${shotIndex + 1} has no renderer asset`);
  return assets.map((asset) => asset === primary ? { ...asset, id: primaryAssetId } : asset);
}

function cameraForMotion(family: ShortBeat["scene"]["motion"]["primary"]["family"], intensity: number, index: number): DocuCamera {
  const move: DocuCameraMove =
    family === "push_in" || family === "punch_in" || family === "reveal"
      ? "push_in"
      : family === "pull_out"
        ? "pull_back"
        : family === "pan" || family === "match_cut"
          ? index % 2 ? "pan_left" : "pan_right"
          : "drift";
  const level: DocuCameraIntensity = intensity >= 0.72 ? "strong" : intensity >= 0.36 ? "medium" : "subtle";
  return { move, intensity: level };
}

function motionForRole(role: typeof DOCUMENTARY_SHORT_ROLES[number], index: number) {
  const family = role === "hook" ? "punch_in" as const
    : role === "context" ? "reveal" as const
      : role === "conflict" ? "pan" as const
        : role === "escalation" ? "parallax" as const
          : role === "reversal" ? "pull_out" as const
            : role === "payoff" ? "push_in" as const
              : "hold" as const;
  return { family, easing: index % 2 ? "ease_out" as const : "ease_in_out" as const, startPercent: 0, endPercent: 1, intensity: role === "hook" ? 0.78 : 0.48 };
}

function musicCueForRole(role: typeof DOCUMENTARY_SHORT_ROLES[number]) {
  return role === "hook" ? "intro" as const
    : role === "conflict" || role === "escalation" ? "tension" as const
      : role === "reversal" || role === "payoff" ? "release" as const
        : role === "cta" ? "outro" as const
          : "build" as const;
}

function sfxForRole(role: typeof DOCUMENTARY_SHORT_ROLES[number]): string {
  return role === "hook" ? "paper-impact" : role === "conflict" ? "evidence-pin" : role === "reversal" ? "tape-rip" : "subtle-film-tick";
}

function splitNarrationIntoBeats(text: string, count: number): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length < count * 6) {
    throw new Error(`documentary collage Short needs enough narration for ${count} authored beats`);
  }
  if (sentences.length >= count) {
    const targetWords = Math.ceil(words.length / count);
    const lines: string[] = [];
    let current: string[] = [];
    for (const sentence of sentences) {
      const slotsLeft = count - lines.length - 1;
      if (current.length && current.join(" ").split(/\s+/).length >= targetWords && slotsLeft > 0) {
        lines.push(current.join(" "));
        current = [];
      }
      current.push(sentence);
    }
    if (current.length) lines.push(current.join(" "));
    if (lines.length === count) return lines;
  }
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor((index * words.length) / count);
    const end = Math.floor(((index + 1) * words.length) / count);
    lines.push(words.slice(start, end).join(" "));
  }
  return lines;
}

function resolveSources(value: unknown, _runId: string, _topic: string): ShortSource[] {
  void _runId;
  void _topic;
  if (value === undefined || value === null) {
    throw new Error(
      "documentary collage Shorts require sourceReferences: provide at least one externally auditable source record before factual/context narration can render",
    );
  }
  const sourceValue = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(sourceValue) || sourceValue.length === 0) {
    throw new Error("sourceReferences must be a non-empty JSON array of source records");
  }
  const sources = sourceValue.map((source) => ShortSourceSchema.parse(source));
  if (!sources.some((source) => source.type !== "internal_research" && Boolean(source.url))) {
    throw new Error(
      "documentary collage Shorts require at least one external sourceReference with a stable URL; internal research alone cannot substantiate factual/context claims",
    );
  }
  return sources;
}

function resolveClaimEvidence(
  value: unknown,
  expectedClaimIds: readonly string[],
  sources: readonly ShortSource[],
): Map<string, ShortClaimEvidence[]> {
  if (value === undefined || value === null) {
    throw new Error(
      "documentary collage Shorts require claimEvidence: provide an external source excerpt for every locked claim before narration can render",
    );
  }
  let evidenceValue: unknown = value;
  if (typeof value === "string") {
    try {
      evidenceValue = JSON.parse(value);
    } catch {
      throw new Error("claimEvidence must be a valid JSON array of claim/source excerpt records");
    }
  }
  if (!Array.isArray(evidenceValue) || evidenceValue.length === 0) {
    throw new Error("claimEvidence must be a non-empty JSON array of claim/source excerpt records");
  }
  const expected = new Set(expectedClaimIds);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const grouped = new Map<string, ShortClaimEvidence[]>();
  for (const rawEvidence of evidenceValue) {
    const entry = DocumentaryClaimEvidenceInputSchema.parse(rawEvidence);
    if (!expected.has(entry.claimId)) {
      throw new Error(`claimEvidence references unknown locked claim ${entry.claimId}`);
    }
    const source = sourcesById.get(entry.sourceId);
    if (!source || source.type === "internal_research" || !source.url) {
      throw new Error(
        `claimEvidence for ${entry.claimId} must reference an external sourceReference with a stable URL`,
      );
    }
    const evidence = ShortClaimEvidenceSchema.parse({
      sourceId: entry.sourceId,
      excerpt: entry.excerpt,
      ...(entry.locator ? { locator: entry.locator } : {}),
    });
    const claimEvidence = grouped.get(entry.claimId) ?? [];
    if (claimEvidence.some((candidate) => candidate.sourceId === evidence.sourceId)) {
      throw new Error(`claimEvidence duplicates source ${evidence.sourceId} for ${entry.claimId}`);
    }
    claimEvidence.push(evidence);
    grouped.set(entry.claimId, claimEvidence);
  }
  for (const claimId of expectedClaimIds) {
    if (!grouped.get(claimId)?.length) {
      throw new Error(`claimEvidence is missing external evidence for ${claimId}`);
    }
  }
  return grouped;
}

function resolveDuration(value: number | undefined): number {
  const duration = value ?? DOCUMENTARY_COLLAGE_SHORT_DURATION.default;
  if (!Number.isFinite(duration) || duration < DOCUMENTARY_COLLAGE_SHORT_DURATION.min || duration > DOCUMENTARY_COLLAGE_SHORT_DURATION.max) {
    throw new Error(`documentary collage Short target duration must be ${DOCUMENTARY_COLLAGE_SHORT_DURATION.min}-${DOCUMENTARY_COLLAGE_SHORT_DURATION.max}s`);
  }
  return roundSeconds(duration);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} must be a stable identifier`);
  }
  return normalized;
}

function overlayText(value: string): string {
  return shortPhrase(value, 10).toUpperCase();
}

function shortPhrase(value: string, maxWords: number): string {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, maxWords);
  return words.join(" ").replace(/[,:;]+$/g, "") || "DOCUMENTARY BEAT";
}

function briefText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
