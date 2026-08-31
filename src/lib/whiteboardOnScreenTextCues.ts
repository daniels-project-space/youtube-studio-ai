import {
  TimedOnScreenTextCueSchema,
  type TimedOnScreenTextCue,
} from "@/lib/onScreenTextProof";

/**
 * The whiteboard renderer already aligns each drawn layer to narration. This
 * converts its retained timeline into bounded final-master OCR checkpoints so
 * instructional labels are proven readable instead of being assumed from the
 * pre-render storyboard.
 *
 * One substantial label per text-bearing panel is sampled. The complete visual
 * review still covers the whole master; these local OCR anchors prove that
 * every teaching panel has readable on-screen text.
 */
export interface WhiteboardTextTimelineLayer {
  readonly kind: "art" | "label";
  readonly text?: string;
  readonly cueStartMs: number;
}

export interface WhiteboardTextTimelinePanel {
  readonly idx: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly layers: readonly WhiteboardTextTimelineLayer[];
}

const MIN_REVIEWABLE_LABEL_WINDOW_MS = 750;

function requireFiniteMs(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`whiteboard text timeline ${label} must be a non-negative finite millisecond value`);
  }
  return value;
}

function normalizedText(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\s+/g, " ");
  return text || undefined;
}

function hasAtLeastTwoTokens(value: string): boolean {
  return value.split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Derive OCR samples from the actual renderer timeline, not storyboard timing
 * estimates. A label that has no stable review window is a production error:
 * it cannot be relied on as readable instructional content.
 */
export function buildWhiteboardOnScreenTextCues(input: {
  readonly panels: readonly WhiteboardTextTimelinePanel[];
  readonly durationMs: number;
}): readonly TimedOnScreenTextCue[] {
  const durationMs = requireFiniteMs(input.durationMs, "duration");
  if (durationMs <= 0) throw new Error("whiteboard text timeline duration must be positive");

  const seenPanels = new Set<number>();
  const cues: TimedOnScreenTextCue[] = [];
  for (const panel of input.panels) {
    if (!Number.isInteger(panel.idx) || panel.idx < 0 || seenPanels.has(panel.idx)) {
      throw new Error("whiteboard text timeline panel indexes must be unique non-negative integers");
    }
    seenPanels.add(panel.idx);
    const panelStartMs = requireFiniteMs(panel.startMs, `panel ${panel.idx} start`);
    const panelEndMs = Math.min(
      requireFiniteMs(panel.endMs, `panel ${panel.idx} end`),
      durationMs,
    );
    if (panelEndMs <= panelStartMs) {
      throw new Error(`whiteboard text timeline panel ${panel.idx} has no positive final-master window`);
    }

    const label = panel.layers.find((layer) => {
      const text = normalizedText(layer.text);
      return layer.kind === "label" && text !== undefined && hasAtLeastTwoTokens(text);
    });
    if (!label) continue;

    const expectedText = normalizedText(label.text)!;
    const cueStartMs = Math.max(
      panelStartMs,
      requireFiniteMs(label.cueStartMs, `panel ${panel.idx} label start`),
    );
    const visibleWindowMs = panelEndMs - cueStartMs;
    if (visibleWindowMs < MIN_REVIEWABLE_LABEL_WINDOW_MS) {
      throw new Error(
        `whiteboard label in panel ${panel.idx} has only ${Math.round(visibleWindowMs)}ms for final-master OCR review`,
      );
    }
    // Sampling at 70% of the remaining window lets the write-on reveal settle
    // while staying safely inside the displayed panel.
    const sampleSec = (cueStartMs + visibleWindowMs * 0.7) / 1_000;
    cues.push(TimedOnScreenTextCueSchema.parse({
      id: `whiteboard.panel-${panel.idx}.label`,
      sampleSec,
      expectedText,
      minTokenCoverage: 0.8,
    }));
  }
  return Object.freeze(cues);
}
