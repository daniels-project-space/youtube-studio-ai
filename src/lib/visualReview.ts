/**
 * Evidence-driven render review.
 *
 * This is the production counterpart of the MIT `claude-video` /watch
 * pattern: extract timestamped evidence first, then let a multimodal reviewer
 * judge what is actually on screen.  It deliberately does not claim that a
 * handful of stills equals continuous video coverage.
 */
import type {
  VisualRepairAction,
  VisualRepairOwner,
  VisualRepairSignal,
} from "@/engine/healer";
import { detectSceneChanges, grabFrame } from "@/lib/ffmpeg";
import { makeRunTempDir } from "@/lib/files";
import { parseJsonLoose } from "@/lib/gemini";
import { putObject, putObjectFromFile } from "@/lib/storage";
import { hasVisionKey, visionLocal } from "@/lib/vision";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const VISUAL_REVIEW_VERSION = "video-review/v1" as const;

export type VisualReviewSeverity = "critical" | "major" | "minor";
export type VisualReviewVerdict = "pass" | "fail" | "needs_human";
export type VisualReviewCategory =
  | "overlay_off_canvas"
  | "overlay_occlusion"
  | "overlay_collision"
  | "caption_cutoff"
  | "caption_unreadable"
  | "wrong_footage"
  | "repeated_clip"
  | "black_frame"
  | "frozen_frame"
  | "transition_break"
  | "intro_card"
  | "outro_card"
  | "general_visual";
export type EvidenceReason = "intro" | "outro" | "scene" | "uniform" | "cue" | "overlay" | "focus";

export type NormalizedRect = [number, number, number, number];

export interface VisualReviewTranscriptCue {
  text: string;
  startSec: number;
  endSec: number;
}

/** A planned, timed overlay or bubble. Coordinates are normalized to its panel. */
export interface VisualReviewOverlay {
  id: string;
  startSec: number;
  endSec: number;
  kind?: "comic_bubble" | "caption" | "quote" | "insert" | "overlay";
  rect?: NormalizedRect;
  keepClear?: NormalizedRect[];
  expected?: string;
}

export interface VisualReviewWindow {
  startSec: number;
  endSec: number;
  reason: "reviewer" | "repair" | "overlay";
}

export interface VisualReviewIntent {
  title: string;
  topic?: string;
  niche?: string;
  channelWorld?: string;
  expectedStructure?: string;
  /** Intentional visual elements that must not be misclassified as defects. */
  allowedVisualConditions?: string[];
  expectTitleCard?: boolean;
  expectOutroCard?: boolean;
  expectChapters?: boolean;
  transcriptCues?: VisualReviewTranscriptCue[];
  overlays?: VisualReviewOverlay[];
  /** Defect windows from a prior repair pass; these get dense 2 fps coverage. */
  focusWindows?: VisualReviewWindow[];
}

export interface ChannelVisualReviewProfileInput {
  contentLaneKey?: string;
  primaryRenderer?: string;
  channelName?: string;
  persona?: string;
  styleGrammar?: string;
  qualityDimensions?: string[];
}

export interface ChannelVisualReviewProfile {
  channelWorld?: string;
  expectedStructure: string;
  allowedVisualConditions: string[];
}

const CHANNEL_REQUIREMENTS: Readonly<Record<string, {
  expected: string;
  allowed: readonly string[];
}>> = {
  motion_comic: {
    expected:
      "A comic-panel narrative: speech bubbles and captions must stay inside their panel, remain legible, and avoid faces and hero artwork.",
    allowed: [
      "Intentional comic page borders and deliberately cropped adjacent panels are not defects unless a planned overlay itself is clipped or obscures the subject.",
    ],
  },
  whiteboard_explainer: {
    expected:
      "A sequential whiteboard explainer: each drawing and label must be legible, the visual progression must match the narration, and no key annotation may be clipped.",
    allowed: [
      "An intentional drawing cursor or hand may enter the frame while creating the whiteboard illustration when it does not permanently hide the active explanation.",
    ],
  },
  documentary_collage_short: {
    expected:
      "A portrait documentary collage Short: source/evidence cards, captions, and subjects must stay within vertical safe areas and remain legible at phone size.",
    allowed: [],
  },
  music_loop: {
    expected:
      "A music-first visual loop: the visual world must remain coherent, the loop must not visibly jump or freeze, and music-led pacing is intentional even without narration.",
    allowed: ["A title card or spoken narration is not required for a music-first loop unless the render explicitly plans one."],
  },
  narrated_documentary: {
    expected:
      "A narration-led documentary: footage, captions, quote cards, and data inserts must support the spoken story and remain readable without covering key subjects.",
    allowed: [],
  },
  cinematic_ai: {
    expected:
      "A cinematic AI narrative: generated shots must stay visually coherent with the channel world, support the narration, and transition without visible glitches or frozen frames.",
    allowed: [],
  },
  ambient_guided: {
    expected:
      "A calm ambient guided piece: slow, intentional pacing and restrained visual changes are expected, while captions and any cards must still be legible and correctly placed.",
    allowed: [],
  },
  short_form: {
    expected:
      "A vertical short-form video: the hook, captions, inserts, and subjects must remain in mobile safe areas with deliberate, readable fast pacing.",
    allowed: [],
  },
};

function compactReviewContext(value: string | undefined, max: number): string | undefined {
  const compact = value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return compact || undefined;
}

/**
 * Converts the frozen channel identity and content-lane contract into bounded
 * reviewer instructions. This is explicit input to the visual model, not a
 * vague request to judge an arbitrary YouTube video.
 */
export function channelVisualReviewProfile(
  input: ChannelVisualReviewProfileInput,
): ChannelVisualReviewProfile {
  const laneKey = compactReviewContext(input.contentLaneKey, 80) ?? "legacy_unclassified";
  const renderer = compactReviewContext(input.primaryRenderer, 100);
  const requirement = CHANNEL_REQUIREMENTS[laneKey] ?? {
    expected:
      "A finished channel video: planned overlays, captions, and inserts must be readable, in-frame, and support the intended story without hiding key subjects.",
    allowed: [],
  };
  const channelName = compactReviewContext(input.channelName, 120);
  const persona = compactReviewContext(input.persona, 180);
  const styleGrammar = compactReviewContext(input.styleGrammar, 240);
  const qualityDimensions = (input.qualityDimensions ?? [])
    .map((dimension) => compactReviewContext(dimension, 60))
    .filter((dimension): dimension is string => Boolean(dimension))
    .slice(0, 8);
  const channelWorld = [
    channelName ? `Channel: ${channelName}` : "",
    persona ? `Audience/persona: ${persona}` : "",
    styleGrammar ? `Style grammar: ${styleGrammar}` : "",
    `Content lane: ${laneKey}${renderer ? ` via ${renderer}` : ""}`,
    qualityDimensions.length ? `Channel quality priorities: ${qualityDimensions.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return {
    ...(channelWorld ? { channelWorld } : {}),
    expectedStructure: requirement.expected,
    allowedVisualConditions: [...requirement.allowed],
  };
}

export interface VisualReviewFrame {
  id: string;
  tSec: number;
  selectionReasons: EvidenceReason[];
  r2Key?: string;
}

export interface VisualReviewEvidence {
  version: typeof VISUAL_REVIEW_VERSION;
  source: { durationSec: number };
  frames: VisualReviewFrame[];
  coverage: { maxGapSec: number; focusedWindows: VisualReviewWindow[] };
  manifestKey?: string;
}

export interface VisualReviewDefect {
  id: string;
  startSec: number;
  endSec: number;
  severity: VisualReviewSeverity;
  category: VisualReviewCategory;
  confidence: number;
  observed: string;
  expected: string;
  evidenceFrameIds: string[];
  suggestedRepair: string;
  /** Geometry checks are deterministic; model findings are evidence-backed. */
  source: "geometry" | "vision";
}

export interface VisualReviewResult {
  ran: boolean;
  verdict: VisualReviewVerdict;
  defects: VisualReviewDefect[];
  evidence: VisualReviewEvidence;
  summary: string;
  focusWindows: VisualReviewWindow[];
  reviewFingerprint: string;
  /** Ephemeral paths for same-stage critic checks only; never persist these. */
  framePaths: string[];
}

export class VisualReviewFailure extends Error {
  readonly retryable = false;
  readonly visualRepair: VisualRepairSignal[];

  constructor(message: string, visualRepair: VisualRepairSignal[]) {
    super(message);
    this.name = "VisualReviewFailure";
    this.visualRepair = visualRepair;
  }
}

interface FrameCandidate {
  tSec: number;
  reasons: Set<EvidenceReason>;
}

interface ExtractedFrame {
  descriptor: VisualReviewFrame;
  localPath: string;
}

export interface VisualReviewerInput {
  prompt: string;
  phase: "broad" | "focus";
  frames: Array<VisualReviewFrame & { localPath: string }>;
}

export type VisualReviewer = (input: VisualReviewerInput) => Promise<string>;

export interface ReviewRenderOptions {
  runId: string;
  keyPrefix?: string;
  required?: boolean;
  /** Broad evidence cap. Each vision request is always <= 12 images. */
  maxFrames?: number;
  /** Extra evidence cap for reviewer-requested or repair-focused windows. */
  maxFocusFrames?: number;
  persistEvidence?: boolean;
  reviewer?: VisualReviewer;
  log?: (message: string) => void;
}

const DEFAULT_STRUCTURE =
  "opening title card; a coherent body with relevant footage and readable overlays/captions; one closing outro near the end";

const REASON_PRIORITY: Record<EvidenceReason, number> = {
  focus: 100,
  overlay: 90,
  intro: 80,
  outro: 80,
  scene: 55,
  cue: 45,
  uniform: 25,
};

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTime(value: number): number {
  return Math.round(value * 10) / 10;
}

function sortedReasons(reasons: Set<EvidenceReason>): EvidenceReason[] {
  return [...reasons].sort((a, b) => REASON_PRIORITY[b] - REASON_PRIORITY[a] || a.localeCompare(b));
}

function priority(candidate: FrameCandidate): number {
  return Math.max(...[...candidate.reasons].map((reason) => REASON_PRIORITY[reason]));
}

function evenlyPick<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values];
  return Array.from({ length: count }, (_, index) => values[Math.floor((index * values.length) / count)]);
}

function normalizeWindow(window: Pick<VisualReviewWindow, "startSec" | "endSec">, durationSec: number): VisualReviewWindow {
  const startSec = clamp(finite(window.startSec, 0), 0, durationSec);
  const endSec = clamp(finite(window.endSec, startSec), startSec, durationSec);
  return { startSec, endSec, reason: (window as VisualReviewWindow).reason ?? "reviewer" };
}

function mergeWindows(windows: readonly VisualReviewWindow[], durationSec: number): VisualReviewWindow[] {
  const sorted = windows
    .map((window) => normalizeWindow(window, durationSec))
    .filter((window) => window.endSec >= window.startSec)
    .sort((a, b) => a.startSec - b.startSec);
  const merged: VisualReviewWindow[] = [];
  for (const window of sorted) {
    const prior = merged.at(-1);
    if (prior && window.startSec <= prior.endSec + 0.35) {
      prior.endSec = Math.max(prior.endSec, window.endSec);
      if (window.reason === "repair") prior.reason = "repair";
      continue;
    }
    merged.push({ ...window });
  }
  return merged;
}

/**
 * Plan broad evidence before extracting frames.  The planner is pure so it can
 * be regression-tested without an API key or a rendered video.
 */
export function planVisualReviewEvidence(input: {
  durationSec: number;
  sceneTimes?: readonly number[];
  transcriptCues?: readonly VisualReviewTranscriptCue[];
  overlays?: readonly VisualReviewOverlay[];
  focusWindows?: readonly VisualReviewWindow[];
  maxFrames?: number;
}): VisualReviewFrame[] {
  const durationSec = Math.max(0, finite(input.durationSec, 0));
  const maxFrames = Math.max(8, Math.floor(finite(input.maxFrames, 48)));
  const candidates = new Map<string, FrameCandidate>();
  const add = (raw: number, reason: EvidenceReason) => {
    if (!Number.isFinite(raw) || raw < 0 || raw > durationSec) return;
    const tSec = roundTime(raw);
    const key = tSec.toFixed(1);
    const existing = candidates.get(key);
    if (existing) existing.reasons.add(reason);
    else candidates.set(key, { tSec, reasons: new Set([reason]) });
  };

  // Dense endpoints protect short title/outro text from being sampled around.
  for (const tSec of [0.2, 0.7, 1.5, 2.8, 4.6]) add(Math.min(tSec, durationSec), "intro");
  for (const delta of [4.6, 2.8, 1.5, 0.7, 0.2]) add(Math.max(0, durationSec - delta), "outro");

  const uniformStep = clamp(durationSec / 16, 4, 14);
  for (let tSec = uniformStep; tSec < durationSec; tSec += uniformStep) add(tSec, "uniform");

  for (const tSec of evenlyPick(
    (input.sceneTimes ?? []).filter((time) => Number.isFinite(time) && time > 0.5 && time < durationSec - 0.5),
    24,
  )) add(tSec, "scene");

  for (const cue of evenlyPick(input.transcriptCues ?? [], 24)) {
    add(cue.startSec + 0.15, "cue");
    add((cue.startSec + cue.endSec) / 2, "cue");
  }

  for (const overlay of input.overlays ?? []) {
    add(overlay.startSec + 0.1, "overlay");
    add((overlay.startSec + overlay.endSec) / 2, "overlay");
    add(overlay.endSec - 0.1, "overlay");
  }

  for (const window of mergeWindows(input.focusWindows ?? [], durationSec)) {
    for (let tSec = window.startSec; tSec <= window.endSec + 0.001; tSec += 0.5) add(tSec, "focus");
    add(window.endSec, "focus");
  }

  const chosen = [...candidates.values()]
    .sort((a, b) => priority(b) - priority(a) || a.tSec - b.tSec)
    .slice(0, maxFrames)
    .sort((a, b) => a.tSec - b.tSec);
  return chosen.map((candidate, index) => ({
    id: `f${String(index + 1).padStart(3, "0")}`,
    tSec: candidate.tSec,
    selectionReasons: sortedReasons(candidate.reasons),
  }));
}

function focusOnlyEvidence(durationSec: number, windows: readonly VisualReviewWindow[], maxFrames: number): VisualReviewFrame[] {
  const planned = planVisualReviewEvidence({
    durationSec,
    focusWindows: windows,
    // The capped planner retains endpoint/uniform samples too; select only the
    // dense focus candidates so this really is a targeted 2 fps re-watch.
    maxFrames: Math.max(8, maxFrames * 3),
  }).filter((frame) => frame.selectionReasons.includes("focus"));
  return planned.slice(0, Math.max(0, maxFrames));
}

function maxGap(times: readonly number[], durationSec: number): number {
  const all = [0, ...times, durationSec].sort((a, b) => a - b);
  let max = 0;
  for (let index = 1; index < all.length; index++) max = Math.max(max, all[index] - all[index - 1]);
  return Number(max.toFixed(2));
}

async function extractFrames(
  videoPath: string,
  frames: readonly VisualReviewFrame[],
  runId: string,
  phase: "broad" | "focus",
  log: (message: string) => void,
): Promise<ExtractedFrame[]> {
  const dir = await makeRunTempDir(runId, `visual-review-${phase}`);
  const extracted: ExtractedFrame[] = [];
  for (const frame of frames) {
    const localPath = join(dir, `${frame.id}_${frame.tSec.toFixed(1).replace(".", "_")}.jpg`);
    try {
      await grabFrame(videoPath, frame.tSec, localPath);
      extracted.push({ descriptor: frame, localPath });
    } catch (error) {
      log(`visualReview: could not extract ${frame.id} @${frame.tSec.toFixed(1)}s: ${error instanceof Error ? error.message : error}`);
    }
  }
  return extracted;
}

function cueForFrame(cues: readonly VisualReviewTranscriptCue[], tSec: number): string | undefined {
  const cue = cues.find((item) => item.startSec <= tSec && item.endSec >= tSec) ??
    cues.reduce<VisualReviewTranscriptCue | undefined>((nearest, item) => {
      if (!nearest) return item;
      const a = Math.abs((item.startSec + item.endSec) / 2 - tSec);
      const b = Math.abs((nearest.startSec + nearest.endSec) / 2 - tSec);
      return a < b ? item : nearest;
    }, undefined);
  return cue?.text?.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
}

function reviewerPrompt(
  intent: VisualReviewIntent,
  frames: readonly ExtractedFrame[],
  phase: "broad" | "focus",
): string {
  const timeline = frames.map((frame) => {
    const transcript = cueForFrame(intent.transcriptCues ?? [], frame.descriptor.tSec);
    const reasons = frame.descriptor.selectionReasons.join(",");
    return `- ${frame.descriptor.id} @${frame.descriptor.tSec.toFixed(1)}s [${reasons}]${transcript ? ` narration: "${transcript}"` : ""}`;
  }).join("\n");
  const allowedVisualConditions = (intent.allowedVisualConditions ?? [])
    .map((condition) => condition.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean);
  return (
    `You are the production visual QA director for a rendered YouTube video. Review only what is visible in the ` +
    `timestamped frames below. This is the ${phase} pass; do not claim continuous-frame coverage.\n\n` +
    `INTENT\n- Title: "${intent.title}"\n` +
    (intent.topic ? `- Topic: "${intent.topic}"\n` : "") +
    (intent.niche ? `- Niche: ${intent.niche}\n` : "") +
    (intent.channelWorld ? `- Channel visual world: ${intent.channelWorld}\n` : "") +
    `- Expected structure: ${intent.expectedStructure ?? DEFAULT_STRUCTURE}\n` +
    (allowedVisualConditions.length
      ? `- Approved intentional visual conditions (do NOT report these as a defect): ${allowedVisualConditions.map((condition) => `"${condition}"`).join("; ")}\n`
      : "") +
    (intent.expectTitleCard === false ? "- A title card is not required.\n" : "- An opening title card is expected.\n") +
    (intent.expectOutroCard === false ? "- An outro card is not required.\n" : "- Confirm the planned ending/outro is present and intentional.\n") +
    (intent.expectChapters ? "- Chapter cards are expected and must be readable/in order.\n" : "") +
    `\nFRAME LEDGER\n${timeline}\n\n` +
    `Find only viewer-noticeable defects: overlays/captions clipped, off-canvas, colliding, covering a face or key subject, ` +
    `unreadable text, wrong/repeated footage, black/frozen frames, broken transitions, or missing/broken intro/outro. ` +
    `Never flag a short on-screen hook merely because it differs from the SEO title. Do not invent defects outside the supplied evidence.\n\n` +
    `Return STRICT JSON {"defects":[{"startSec":number,"endSec":number,"severity":"critical|major|minor",` +
    `"category":"overlay_off_canvas|overlay_occlusion|overlay_collision|caption_cutoff|caption_unreadable|wrong_footage|repeated_clip|black_frame|frozen_frame|transition_break|intro_card|outro_card|general_visual",` +
    `"confidence":0..1,"observed":"what is visibly wrong","expected":"what should be visible",` +
    `"evidenceFrameIds":["f001"],"suggestedRepair":"short safe repair"}],"summary":"<=100 words"}.`
  );
}

function normalizeSeverity(value: unknown): VisualReviewSeverity {
  const raw = String(value ?? "minor").toLowerCase();
  return raw === "critical" || raw === "major" ? raw : "minor";
}

function normalizeCategory(value: unknown, observed: string): VisualReviewCategory {
  const raw = `${String(value ?? "")} ${observed}`.toLowerCase();
  if (/off.?canvas|out.?of.?frame|clipp|cut.?off|overflow/.test(raw) && /overlay|bubble|caption|text/.test(raw)) return "overlay_off_canvas";
  // Providers often describe this visually as "covering the face" or
  // "obscures the main character" rather than using the category word
  // "occlusion". Preserve that grounded observation as a repairable overlay
  // defect instead of downgrading it to general_visual.
  if (
    /overlay|bubble|caption|text|box|rectangle|graphic/.test(raw) &&
    /occlud|cover(?:s|ed|ing)?|obscur|block(?:s|ed|ing)?|hid(?:e|es|den|ing)|mask/.test(raw) &&
    /(?:the\s+)?(?:face|subject|hero|character|object|person|figure|artwork|panel)/.test(raw)
  ) return "overlay_occlusion";
  if (/collision|overlap/.test(raw) && /overlay|bubble|caption|text/.test(raw)) return "overlay_collision";
  if (/caption/.test(raw) && /cut.?off|clip/.test(raw)) return "caption_cutoff";
  if (/caption/.test(raw) && /unread|illegible|tiny|blur/.test(raw)) return "caption_unreadable";
  if (/wrong|irrelevant|off.?world|unrelated/.test(raw) && /footage|clip|insert|visual/.test(raw)) return "wrong_footage";
  if (/repeat|duplicate/.test(raw) && /clip|footage|insert/.test(raw)) return "repeated_clip";
  if (/black|empty|blank/.test(raw) && /frame|screen|segment|video/.test(raw)) return "black_frame";
  if (/frozen|freeze|stuck/.test(raw)) return "frozen_frame";
  if (/transition|abrupt cut|jump cut/.test(raw)) return "transition_break";
  if (/intro|title card/.test(raw)) return "intro_card";
  if (/outro|end card/.test(raw)) return "outro_card";
  return "general_visual";
}

function nearestFrameId(frames: readonly ExtractedFrame[], tSec: number): string[] {
  const nearest = frames.reduce<ExtractedFrame | undefined>((best, frame) => {
    if (!best || Math.abs(frame.descriptor.tSec - tSec) < Math.abs(best.descriptor.tSec - tSec)) return frame;
    return best;
  }, undefined);
  return nearest ? [nearest.descriptor.id] : [];
}

function parseModelDefects(
  raw: string,
  frames: readonly ExtractedFrame[],
  intent: VisualReviewIntent,
  phase: "broad" | "focus",
): { defects: VisualReviewDefect[]; summary: string } {
  const parsed = parseJsonLoose<{
    defects?: Array<Record<string, unknown>>;
    summary?: unknown;
  }>(raw);
  const known = new Set(frames.map((frame) => frame.descriptor.id));
  const defects = (parsed?.defects ?? []).flatMap((item) => {
    const observed = String(item["observed"] ?? item["issue"] ?? "").trim();
    if (!observed) return [];
    const startSec = clamp(finite(item["startSec"] ?? item["tSec"], frames[0]?.descriptor.tSec ?? 0), 0, Number.MAX_SAFE_INTEGER);
    const endSec = Math.max(startSec, finite(item["endSec"], startSec));
    const ids = Array.isArray(item["evidenceFrameIds"])
      ? item["evidenceFrameIds"].map(String).filter((id) => known.has(id))
      : [];
    const evidenceFrameIds = ids.length ? [...new Set(ids)] : nearestFrameId(frames, startSec);
    const category = normalizeCategory(item["category"], observed);
    const severity = normalizeSeverity(item["severity"]);
    const confidence = clamp(finite(item["confidence"], 0.65), 0, 1);
    const key = `${phase}|${category}|${roundTime(startSec)}|${observed.slice(0, 120)}`;
    return [{
      id: createHash("sha256").update(key).digest("hex").slice(0, 16),
      startSec,
      endSec,
      severity,
      category,
      confidence,
      observed,
      expected: String(item["expected"] ?? intent.expectedStructure ?? DEFAULT_STRUCTURE).slice(0, 300),
      evidenceFrameIds,
      suggestedRepair: String(item["suggestedRepair"] ?? "Inspect and repair the owning render stage").slice(0, 240),
      source: "vision" as const,
    } satisfies VisualReviewDefect];
  });
  return { defects, summary: String(parsed?.summary ?? "").slice(0, 500) };
}

function rectIntersection(a: NormalizedRect, b: NormalizedRect): number {
  const width = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return width * height;
}

function rectArea(rect: NormalizedRect): number {
  return Math.max(0, rect[2]) * Math.max(0, rect[3]);
}

function geometryDefects(overlays: readonly VisualReviewOverlay[], frames: readonly ExtractedFrame[]): VisualReviewDefect[] {
  const defects: VisualReviewDefect[] = [];
  const add = (overlay: VisualReviewOverlay, category: VisualReviewCategory, observed: string, expected: string) => {
    const key = `geometry|${overlay.id}|${category}|${roundTime(overlay.startSec)}`;
    defects.push({
      id: createHash("sha256").update(key).digest("hex").slice(0, 16),
      startSec: overlay.startSec,
      endSec: Math.max(overlay.startSec, overlay.endSec),
      severity: "major",
      category,
      confidence: 1,
      observed,
      expected,
      evidenceFrameIds: nearestFrameId(frames, overlay.startSec),
      suggestedRepair: "Reflow the overlay inside the safe panel region",
      source: "geometry",
    });
  };
  for (const overlay of overlays) {
    const rect = overlay.rect;
    if (!rect) continue;
    if (rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > 1 || rect[1] + rect[3] > 1) {
      add(overlay, "overlay_off_canvas", `Overlay ${overlay.id} extends outside its visible panel/frame`, "The full overlay must remain inside the safe panel bounds");
    }
    for (const keepClear of overlay.keepClear ?? []) {
      const overlap = rectIntersection(rect, keepClear);
      if (overlap > 0.01 * Math.min(rectArea(rect), rectArea(keepClear))) {
        add(overlay, "overlay_occlusion", `Overlay ${overlay.id} intersects a declared face or hero-object keep-clear zone`, "The overlay must not cover a face or key subject");
        break;
      }
    }
  }
  for (let left = 0; left < overlays.length; left++) {
    const a = overlays[left];
    if (!a.rect) continue;
    for (let right = left + 1; right < overlays.length; right++) {
      const b = overlays[right];
      if (!b.rect || a.endSec < b.startSec || b.endSec < a.startSec) continue;
      const overlap = rectIntersection(a.rect, b.rect);
      if (overlap > 0.08 * Math.min(rectArea(a.rect), rectArea(b.rect))) {
        add(a, "overlay_collision", `Overlay ${a.id} visibly collides with overlay ${b.id}`, "Overlays that are live together must have separate readable space");
      }
    }
  }
  return defects;
}

function dedupeDefects(defects: readonly VisualReviewDefect[]): VisualReviewDefect[] {
  const result: VisualReviewDefect[] = [];
  const rank: Record<VisualReviewSeverity, number> = { minor: 1, major: 2, critical: 3 };
  for (const defect of [...defects].sort((a, b) => a.startSec - b.startSec || rank[b.severity] - rank[a.severity])) {
    const prior = result.find((item) => item.category === defect.category && Math.abs(item.startSec - defect.startSec) <= 1.2);
    if (!prior) {
      result.push({ ...defect, evidenceFrameIds: [...defect.evidenceFrameIds] });
      continue;
    }
    if (rank[defect.severity] > rank[prior.severity]) prior.severity = defect.severity;
    prior.confidence = Math.max(prior.confidence, defect.confidence);
    prior.endSec = Math.max(prior.endSec, defect.endSec);
    prior.evidenceFrameIds = [...new Set([...prior.evidenceFrameIds, ...defect.evidenceFrameIds])];
    if (defect.source === "geometry") prior.source = "geometry";
  }
  return result;
}

function focusForDefects(defects: readonly VisualReviewDefect[], durationSec: number): VisualReviewWindow[] {
  return mergeWindows(
    defects
      .filter((defect) => defect.severity === "critical" || defect.severity === "major")
      .slice(0, 4)
      .map((defect) => ({
        startSec: Math.max(0, defect.startSec - 1.2),
        endSec: Math.min(durationSec, defect.endSec + 1.2),
        reason: "reviewer" as const,
      })),
    durationSec,
  );
}

async function reviewBatches(
  reviewer: VisualReviewer,
  intent: VisualReviewIntent,
  frames: readonly ExtractedFrame[],
  phase: "broad" | "focus",
): Promise<{ defects: VisualReviewDefect[]; summaries: string[] }> {
  const defects: VisualReviewDefect[] = [];
  const summaries: string[] = [];
  for (let index = 0; index < frames.length; index += 12) {
    const batch = frames.slice(index, index + 12);
    const raw = await reviewer({
      prompt: reviewerPrompt(intent, batch, phase),
      phase,
      frames: batch.map((frame) => ({ ...frame.descriptor, localPath: frame.localPath })),
    });
    const parsed = parseModelDefects(raw, batch, intent, phase);
    defects.push(...parsed.defects);
    if (parsed.summary) summaries.push(parsed.summary);
  }
  return { defects, summaries };
}

function defaultReviewer(input: VisualReviewerInput): Promise<string> {
  return visionLocal({
    prompt: input.prompt,
    imagePaths: input.frames.map((frame) => frame.localPath),
    json: true,
    maxTokens: 2200,
  });
}

function fingerprint(intent: VisualReviewIntent, durationSec: number, frames: readonly VisualReviewFrame[]): string {
  return createHash("sha256")
    // A render must never reuse review evidence that was judged against a
    // different channel world, lane structure, transcript, overlay receipt, or
    // repair focus range. The full typed intent is compact and deterministic.
    .update(JSON.stringify({ version: VISUAL_REVIEW_VERSION, intent, durationSec, frames: frames.map((frame) => [frame.tSec, frame.selectionReasons]) }))
    .digest("hex")
    .slice(0, 24);
}

async function persistEvidence(
  evidence: VisualReviewEvidence,
  extracted: readonly ExtractedFrame[],
  opts: Required<Pick<ReviewRenderOptions, "runId" | "keyPrefix">>,
  reviewFingerprint: string,
): Promise<VisualReviewEvidence> {
  const prefix = opts.keyPrefix.replace(/\/?$/, "/");
  const root = `${prefix}runs/${opts.runId}/visual-review/${reviewFingerprint}`;
  const frameById = new Map(extracted.map((frame) => [frame.descriptor.id, frame]));
  const frames: VisualReviewFrame[] = [];
  for (const frame of evidence.frames) {
    const extractedFrame = frameById.get(frame.id);
    if (!extractedFrame) continue;
    const r2Key = `${root}/frames/${frame.id}.jpg`;
    await putObjectFromFile(r2Key, extractedFrame.localPath, { contentType: "image/jpeg" });
    frames.push({ ...frame, r2Key });
  }
  const manifestKey = `${root}/manifest.json`;
  const persisted = { ...evidence, frames, manifestKey };
  await putObject(manifestKey, Buffer.from(JSON.stringify(persisted, null, 2)), {
    contentType: "application/json",
  });
  return persisted;
}

/**
 * Review a render with broad evidence followed by a dense, model-requested
 * focus pass.  A repair run supplies focusWindows, which makes its second
 * review inspect the changed range at 2 fps plus the normal endpoints.
 */
export async function reviewRender(
  videoPath: string,
  durationSec: number,
  intent: VisualReviewIntent,
  opts: ReviewRenderOptions,
): Promise<VisualReviewResult> {
  const log = opts.log ?? (() => {});
  const required = opts.required === true;
  const reviewer = opts.reviewer ?? defaultReviewer;
  if (!opts.reviewer && !hasVisionKey()) {
    if (required) throw new Error("visualReview required grader unavailable (no configured vision provider)");
    return {
      ran: false,
      verdict: "needs_human",
      defects: [],
      evidence: { version: VISUAL_REVIEW_VERSION, source: { durationSec }, frames: [], coverage: { maxGapSec: durationSec, focusedWindows: [] } },
      summary: "vision unavailable",
      focusWindows: [],
      reviewFingerprint: fingerprint(intent, durationSec, []),
      framePaths: [],
    };
  }

  const sceneTimes = await detectSceneChanges(videoPath);
  const planned = planVisualReviewEvidence({
    durationSec,
    sceneTimes,
    transcriptCues: intent.transcriptCues,
    overlays: intent.overlays,
    focusWindows: intent.focusWindows,
    maxFrames: finite(opts.maxFrames, 48),
  });
  const broad = await extractFrames(videoPath, planned, opts.runId, "broad", log);
  if (broad.length < 3) {
    if (required) throw new Error(`visualReview required 3+ evidence frames, extracted ${broad.length}`);
    return {
      ran: false,
      verdict: "needs_human",
      defects: [],
      evidence: { version: VISUAL_REVIEW_VERSION, source: { durationSec }, frames: planned, coverage: { maxGapSec: maxGap(planned.map((frame) => frame.tSec), durationSec), focusedWindows: [] } },
      summary: "insufficient extracted evidence",
      focusWindows: [],
      reviewFingerprint: fingerprint(intent, durationSec, planned),
      framePaths: broad.map((frame) => frame.localPath),
    };
  }

  const firstPass = await reviewBatches(reviewer, intent, broad, "broad");
  const geometry = geometryDefects(intent.overlays ?? [], broad);
  const initialDefects = dedupeDefects([...geometry, ...firstPass.defects]);
  const focusWindows = mergeWindows([
    ...(intent.focusWindows ?? []),
    ...focusForDefects(initialDefects, durationSec),
  ], durationSec);
  const focusCandidates = focusOnlyEvidence(durationSec, focusWindows, Math.max(0, Math.floor(finite(opts.maxFocusFrames, 24))))
    .filter((candidate) => !broad.some((frame) => Math.abs(frame.descriptor.tSec - candidate.tSec) < 0.11))
    .map((candidate, index) => ({ ...candidate, id: `x${String(index + 1).padStart(3, "0")}` }));
  const focused = focusCandidates.length
    ? await extractFrames(videoPath, focusCandidates, opts.runId, "focus", log)
    : [];
  const focusPass = focused.length ? await reviewBatches(reviewer, intent, focused, "focus") : { defects: [], summaries: [] };
  const allExtracted = [...broad, ...focused];
  const defects = dedupeDefects([...geometry, ...firstPass.defects, ...focusPass.defects]);
  const allFrames = allExtracted.map((frame) => frame.descriptor);
  const reviewFingerprint = fingerprint(intent, durationSec, allFrames);
  let evidence: VisualReviewEvidence = {
    version: VISUAL_REVIEW_VERSION,
    source: { durationSec },
    frames: allFrames,
    coverage: {
      maxGapSec: maxGap(allFrames.map((frame) => frame.tSec), durationSec),
      focusedWindows: focusWindows,
    },
  };
  if (opts.persistEvidence !== false) {
    if (!opts.keyPrefix) throw new Error("visualReview cannot persist evidence without keyPrefix");
    evidence = await persistEvidence(evidence, allExtracted, { runId: opts.runId, keyPrefix: opts.keyPrefix }, reviewFingerprint);
  }

  const blocking = defects.filter((defect) =>
    (defect.severity === "critical" || defect.severity === "major") &&
    defect.category !== "general_visual" &&
    defect.confidence >= 0.6,
  );
  const uncertain = defects.some((defect) =>
    (defect.severity === "critical" || defect.severity === "major") &&
    (defect.category === "general_visual" || defect.confidence < 0.6),
  );
  const verdict: VisualReviewVerdict = blocking.length ? "fail" : uncertain ? "needs_human" : "pass";
  const summary = [...firstPass.summaries, ...focusPass.summaries].filter(Boolean).join(" | ").slice(0, 1000) ||
    `${defects.length} evidence-backed defect(s); ${allFrames.length} frames reviewed`;
  log(`visualReview: ${allFrames.length} frames (${Math.ceil(allFrames.length / 12)} batch(es)), ${defects.length} defect(s) → ${verdict.toUpperCase()}`);
  return {
    ran: true,
    verdict,
    defects,
    evidence,
    summary,
    focusWindows,
    reviewFingerprint,
    framePaths: allExtracted.map((frame) => frame.localPath),
  };
}

function routeForDefect(
  defect: VisualReviewDefect,
  overlays: readonly VisualReviewOverlay[],
): { owner: VisualRepairOwner; action: VisualRepairAction; target?: VisualReviewOverlay } | null {
  const activeComic = overlays.find((overlay) =>
    overlay.kind === "comic_bubble" && overlay.startSec <= defect.endSec && overlay.endSec >= defect.startSec,
  );
  if (["overlay_off_canvas", "overlay_occlusion", "overlay_collision", "caption_cutoff", "caption_unreadable"].includes(defect.category)) {
    if (activeComic) return { owner: "motion_comic", action: "reflow_bubble", target: activeComic };
    return { owner: "timeline_assemble", action: "recompose_overlay" };
  }
  if (["wrong_footage", "repeated_clip"].includes(defect.category)) return { owner: "stock_footage", action: "resample_footage" };
  if (defect.category === "intro_card") return { owner: "intro_card", action: "rerender_card" };
  if (["black_frame", "frozen_frame", "transition_break", "outro_card"].includes(defect.category)) {
    return { owner: "timeline_assemble", action: "rebuild_timeline" };
  }
  return null;
}

/** Convert bounded categories into runner-safe repair instructions. */
export function visualRepairSignals(result: VisualReviewResult, intent: VisualReviewIntent): VisualRepairSignal[] {
  return result.defects.flatMap((defect) => {
    if (defect.severity === "minor") return [];
    const route = routeForDefect(defect, intent.overlays ?? []);
    if (!route) return [];
    return [{
      schemaVersion: 1,
      owner: route.owner,
      action: route.action,
      category: defect.category,
      severity: defect.severity,
      startSec: defect.startSec,
      endSec: defect.endSec,
      observed: defect.observed,
      expected: defect.expected,
      confidence: defect.confidence,
      ...(result.evidence.manifestKey ? { evidenceKey: result.evidence.manifestKey } : {}),
      frameIds: defect.evidenceFrameIds,
      ...(route.target?.id ? { targetId: route.target.id } : {}),
      ...(route.owner === "motion_comic" && route.target?.rect ? { forbiddenRects: [route.target.rect] } : {}),
    } satisfies VisualRepairSignal];
  });
}

export function visualReviewFailureMessage(result: VisualReviewResult): string {
  const blocking = result.defects.filter((defect) =>
    (defect.severity === "critical" || defect.severity === "major") && defect.category !== "general_visual",
  );
  if (!blocking.length) return `visual review ${result.verdict}: ${result.summary}`;
  return blocking.slice(0, 6).map((defect) =>
    `visual-review [@${defect.startSec.toFixed(1)}s] ${defect.category}: ${defect.observed}`,
  ).join(" | ");
}
