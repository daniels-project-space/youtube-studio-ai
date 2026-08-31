import {
  SelfContainedStoryPlanEvidenceSchema,
  type SelfContainedStoryPlanEvidence,
} from "@/engine/qualityEvidence";
import {
  assertSelfContainedStoryReceiptBinding,
  selfContainedStoryReceiptBindingFromRoute,
  validateSelfContainedStoryReceipt,
  type SelfContainedStoryReceipt,
} from "@/engine/selfContainedStoryReceipt";
import { sha256Hex } from "@/lib/sha256";
import type { VisualReviewCreativeLock } from "@/lib/visualReview";

export const SELF_CONTAINED_STORY_PLAN_EVIDENCE_VERSION =
  "self-contained-story-plan-evidence/v1" as const;

function planCounts(receipt: SelfContainedStoryReceipt): SelfContainedStoryPlanEvidence["counts"] {
  if (receipt.storyKind === "whiteboard-storyboard/v1") {
    const panelCount = receipt.story.panels.length;
    return {
      beatCount: panelCount,
      shotCount: panelCount,
      panelCount,
      artLayerCount: receipt.story.panels.reduce((total, panel) => total + panel.layers.length, 0),
      spokenLineCount: panelCount,
    };
  }
  if (receipt.storyKind === "motion-comic-storyboard/v1") {
    const panelCount = receipt.story.panels.length;
    return {
      beatCount: panelCount,
      shotCount: panelCount,
      panelCount,
      spokenLineCount: receipt.story.panels.reduce((total, panel) => total + panel.lines.length, 0),
      characterCount: receipt.story.characters.length,
    };
  }
  const sceneCount = receipt.story.scenes.length;
  return {
    beatCount: sceneCount,
    shotCount: sceneCount,
    sceneCount,
    spokenLineCount: sceneCount,
  };
}

function resolveBoundReceipt(input: {
  readonly receipt: unknown;
  readonly route: unknown;
  readonly topic: unknown;
  readonly contentLaneKey: string;
}): SelfContainedStoryReceipt {
  // Inspect the strict, self-fingerprinted receipt first only to learn which
  // family must be rebound. The second assertion is the actual authority.
  const parsed = validateSelfContainedStoryReceipt(input.receipt);
  const binding = selfContainedStoryReceiptBindingFromRoute({
    family: parsed.family,
    route: input.route,
    topic: input.topic,
  });
  const receipt = assertSelfContainedStoryReceiptBinding({
    receipt: input.receipt,
    expected: binding,
  });
  if (receipt.contentLaneKey !== input.contentLaneKey.trim()) {
    throw new Error("self-contained story receipt content lane does not match final QA lane");
  }
  return receipt;
}

/**
 * The renderers use these exact, native text projections as their TTS input.
 * Keep tag stripping here byte-for-byte equivalent to motionComic's spoken
 * line projection. This is a narration binding only: it never claims that a
 * planned panel or drawing was visually realized in the final master.
 */
export function selfContainedStoryNarrationText(
  receipt: SelfContainedStoryReceipt,
): string | undefined {
  if (receipt.storyKind === "whiteboard-storyboard/v1") {
    return receipt.story.fullText;
  }
  if (receipt.storyKind === "motion-comic-storyboard/v1") {
    return receipt.story.panels
      .flatMap((panel) => panel.lines)
      .map((line) => line.text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim())
      .join(" ");
  }
  return undefined;
}

interface TimedText {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function parseTimedText(value: unknown): readonly TimedText[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16_000) {
    throw new Error("self-contained visual review requires a bounded non-empty narration timing map");
  }
  return Object.freeze(value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`self-contained narration timing ${index} is malformed`);
    }
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const start = Number(record.start);
    const end = Number(record.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error(`self-contained narration timing ${index} is invalid`);
    }
    return { text, start, end };
  }));
}

function textTokens(value: string): readonly string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function stripComicTags(value: string): string {
  return value.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

function timedWindow(start: number, end: number, narrationStartSec: number, label: string): {
  readonly startSec: number;
  readonly endSec: number;
} {
  const startSec = Number((narrationStartSec + start).toFixed(3));
  const endSec = Number((narrationStartSec + end).toFixed(3));
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec < startSec) {
    throw new Error(`self-contained ${label} timing cannot be mapped onto the final master`);
  }
  return { startSec, endSec };
}

function whiteboardLocks(
  receipt: Extract<SelfContainedStoryReceipt, { storyKind: "whiteboard-storyboard/v1" }>,
  timings: readonly TimedText[],
  narrationStartSec: number,
): readonly VisualReviewCreativeLock[] {
  const words = timings.flatMap((timing) => textTokens(timing.text).map((token) => ({
    token,
    start: timing.start,
    end: timing.end,
  })));
  let wordCursor = 0;
  return Object.freeze(receipt.story.panels.map((panel, index) => {
    const expectedTokens = textTokens(panel.narration);
    if (!expectedTokens.length) throw new Error(`whiteboard panel ${panel.idx} has no narratable text`);
    const first = words[wordCursor];
    if (!first) throw new Error(`whiteboard panel ${panel.idx} is absent from its renderer timing map`);
    let last = first;
    for (const token of expectedTokens) {
      const observed = words[wordCursor];
      if (!observed || observed.token !== token) {
        throw new Error(`whiteboard panel ${panel.idx} narration timing diverges from the sealed storyboard`);
      }
      last = observed;
      wordCursor += 1;
    }
    const layers = panel.layers
      .map((layer) => layer.kind === "label" ? `label \"${layer.text ?? ""}\"` : layer.draw ?? layer.cue ?? "planned drawing")
      .filter(Boolean)
      .slice(0, 8)
      .join("; ");
    const window = timedWindow(first.start, last.end, narrationStartSec, `whiteboard panel ${panel.idx}`);
    return {
      shotId: `self-contained-whiteboard-panel-${panel.idx}`,
      ...window,
      expected: `Whiteboard panel ${panel.idx + 1}: ${layers || "the sealed planned drawing"}.`,
      acceptanceCriteria: [
        "The planned whiteboard drawing or label is visibly present and inside the canvas.",
        "The panel is intentional, legible, and not a blank, duplicated, or broken canvas.",
      ],
    } satisfies VisualReviewCreativeLock;
  }));
}

function comicLocks(
  receipt: Extract<SelfContainedStoryReceipt, { storyKind: "motion-comic-storyboard/v1" }>,
  timings: readonly TimedText[],
  narrationStartSec: number,
): readonly VisualReviewCreativeLock[] {
  let timingCursor = 0;
  return Object.freeze(receipt.story.panels.map((panel, index) => {
    const plannedLines = panel.lines.map((line) => stripComicTags(line.text));
    if (!plannedLines.length) throw new Error(`motion-comic panel ${index} has no narratable line`);
    const panelTimings = plannedLines.map((line, lineIndex) => {
      const observed = timings[timingCursor];
      if (!observed || textTokens(observed.text).join(" ") !== textTokens(line).join(" ")) {
        throw new Error(`motion-comic panel ${index} line ${lineIndex} diverges from the sealed storyboard timing`);
      }
      timingCursor += 1;
      return observed;
    });
    const visual = panel.visual;
    const subjects = visual.subjects.length ? visual.subjects.join(", ") : "the planned subject";
    const window = timedWindow(
      panelTimings[0]!.start,
      panelTimings[panelTimings.length - 1]!.end,
      narrationStartSec,
      `motion-comic panel ${index}`,
    );
    return {
      shotId: `self-contained-comic-panel-${index}`,
      ...window,
      expected: `Motion-comic panel ${index + 1}: ${panel.shot} shot in ${visual.environment}; ${visual.action}; ${subjects}; ${visual.mood} mood and ${visual.lighting} lighting.`,
      acceptanceCriteria: [
        "The planned panel subject, action, environment, and shot staging are visibly recognizable.",
        "The panel is coherent and intentional, without broken, duplicated, or empty comic art.",
      ],
    } satisfies VisualReviewCreativeLock;
  }));
}

/**
 * Creates final-master sampling locks from the sealed native panel plan and
 * renderer-produced source timings. They guarantee a review frame per planned
 * visual beat, but remain sampled visual evidence—not a claim of continuous
 * or pixel-perfect panel coverage.
 */
export function selfContainedStoryVisualReviewLocksFromReceipt(input: {
  readonly receipt: unknown;
  readonly route: unknown;
  readonly topic: unknown;
  readonly contentLaneKey: string;
  readonly sentenceTimings: unknown;
  readonly narrationStartSec: number;
}): readonly VisualReviewCreativeLock[] {
  if (!Number.isFinite(input.narrationStartSec) || input.narrationStartSec < 0) {
    throw new Error("self-contained visual review requires a valid renderer-declared narration start");
  }
  const receipt = resolveBoundReceipt(input);
  // Lore's native plan has no current narration renderer contract. It remains
  // unadmitted, and must not be forced through a whiteboard/comic timing
  // assertion it cannot truthfully emit when that lane is revisited later.
  if (receipt.storyKind === "lore-plan/v1") return Object.freeze([]);
  const timings = parseTimedText(input.sentenceTimings);
  if (receipt.storyKind === "whiteboard-storyboard/v1") {
    return whiteboardLocks(receipt, timings, input.narrationStartSec);
  }
  return comicLocks(receipt, timings, input.narrationStartSec);
}

/**
 * Projects a sealed self-contained receipt into generic QA without promoting
 * the pre-render plan into final-master coverage. The receipt is rebound to
 * the active frozen route, content lane, and topic at the point of use.
 */
export function selfContainedStoryPlanEvidenceFromReceipt(input: {
  readonly receipt: unknown;
  readonly route: unknown;
  readonly topic: unknown;
  readonly contentLaneKey: string;
}): SelfContainedStoryPlanEvidence {
  const receipt = resolveBoundReceipt(input);
  const binding = selfContainedStoryReceiptBindingFromRoute({
    family: receipt.family,
    route: input.route,
    topic: input.topic,
  });
  const narrationText = selfContainedStoryNarrationText(receipt);

  return SelfContainedStoryPlanEvidenceSchema.parse({
    version: SELF_CONTAINED_STORY_PLAN_EVIDENCE_VERSION,
    measurementScope: "plan",
    family: receipt.family,
    storyKind: receipt.storyKind,
    contentLaneKey: receipt.contentLaneKey,
    topic: binding.topic,
    topicFingerprint: receipt.topicFingerprint,
    routeFingerprint: receipt.routeFingerprint,
    programBriefFingerprint: receipt.programBriefFingerprint,
    receiptFingerprint: receipt.fingerprint,
    storyFingerprint: receipt.storyFingerprint,
    plannerId: receipt.planner.id,
    receiptVersion: receipt.version,
    ...(narrationText === undefined ? {} : { narrationTextSha256: sha256Hex(narrationText) }),
    counts: planCounts(receipt),
  });
}
