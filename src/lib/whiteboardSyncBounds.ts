import { SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL } from "@/engine/selfContainedStoryReceipt";

export const WHITEBOARD_MAX_PANELS = 16;

export const WHITEBOARD_MAX_ART_IMAGES_PER_PANEL = SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL;

export const WHITEBOARD_MAX_WORDS_PER_PANEL = 120;

export const WHITEBOARD_MAX_CHARS_PER_WORD = 12;

export const WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES = 3;

/** Dense hand-drawn boards need their own time budget; this is not a generic slideshow cadence. */
export const WHITEBOARD_MIN_SECONDS_PER_DENSE_PANEL = 34;

export function whiteboardPanelCount(value: unknown): number {
  const parsed = Number(value ?? 6);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(WHITEBOARD_MAX_PANELS, Math.floor(parsed)))
    : 6;
}

/**
 * Derives a production-safe number of boards from a requested runtime.  The
 * prior 22-second rule was inherited from a sparse two-art layout; it forced
 * the richer plan to either compress the hand or waste paid images.  A short
 * whiteboard now uses fewer, fuller boards rather than pretending both goals
 * can be met at once.
 */
export function whiteboardPanelsForTargetSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return whiteboardPanelCount(undefined);
  return whiteboardPanelCount(Math.max(2, Math.floor(seconds / WHITEBOARD_MIN_SECONDS_PER_DENSE_PANEL)));
}

/**
 * A six-panel board needs room for dense narration and layer JSON, but not an
 * unbounded reasoning/completion window. Keeping the response proportional to
 * the requested panel count protects the planner connection and preserves a
 * useful final-answer reserve for the whole storyboard.
 */
export function whiteboardStoryboardTokenCeiling(panelCount: unknown): number {
  return Math.max(3_000, Math.min(8_000, whiteboardPanelCount(panelCount) * 1_100));
}

export function whiteboardImageCallCeiling(panelCount: unknown): number {
  return whiteboardPanelCount(panelCount) * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL;
}

export function whiteboardNarrationCharacterCeiling(panelCount: unknown, targetWords: unknown): number {
  const panels = whiteboardPanelCount(panelCount);
  const parsedWords = Number(targetWords ?? 150);
  const requestedWords = Number.isFinite(parsedWords) && parsedWords > 0 ? Math.ceil(parsedWords) : 150;
  const boundedWords = Math.max(
    panels * 8,
    Math.min(panels * WHITEBOARD_MAX_WORDS_PER_PANEL, requestedWords),
  );
  return boundedWords * WHITEBOARD_MAX_CHARS_PER_WORD;
}

export function whiteboardTtsBillableCharacterCeiling(
  panelCount: unknown,
  targetWords: unknown,
): number {
  return (
    whiteboardNarrationCharacterCeiling(panelCount, targetWords)
  );
}

export function whiteboardTtsProviderCallCeiling(): number {
  return WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES;
}
