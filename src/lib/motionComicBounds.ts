export const MOTION_COMIC_MIN_PANELS = 4;

export const MOTION_COMIC_MAX_PANELS = 12;

export const MOTION_COMIC_MAX_CHARACTERS = 4;

export const MOTION_COMIC_MAX_IMAGE_CALLS_PER_PANEL = 2;

export const MOTION_COMIC_MAX_IMAGE_CALLS_PER_CHARACTER = 2;

export const MOTION_COMIC_MAX_LINES_PER_PANEL = 3;

export const MOTION_COMIC_MAX_LINE_CHARS = 320;

export const MOTION_COMIC_MAX_WORD_CHARS = 48;

export const MOTION_COMIC_MIN_DIALOGUE_CHARS_PER_PANEL = 160;

/** 2.6 spoken words/sec × roughly 6 characters including spaces. */
export const MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND = 16;

export const MOTION_COMIC_MAX_TTS_PROVIDER_RESPONSES_PER_LINE = 3;

export const MOTION_COMIC_MAX_VISION_CALLS_PER_PANEL = 2;

export const MOTION_COMIC_MAX_MUSIC_GENERATIONS = 1;

export function motionComicPanelCount(value: unknown): number {
  const parsed = Number(value ?? 8);
  return Number.isFinite(parsed)
    ? Math.max(MOTION_COMIC_MIN_PANELS, Math.min(MOTION_COMIC_MAX_PANELS, Math.floor(parsed)))
    : 8;
}

export function motionComicImageCallCeiling(panelCount: unknown, characterCount: unknown = 4): number {
  void characterCount;
  // Character model sheets were a provider-specific img2img workaround. The
  // live Novita route carries the closed character identity schema in every
  // panel prompt, so only primary + bounded recovery panels consume images.
  return motionComicPanelCount(panelCount) * MOTION_COMIC_MAX_IMAGE_CALLS_PER_PANEL;
}

export function motionComicTtsBillableCharacterCeiling(
  panelCount: unknown,
  targetSeconds: unknown = undefined,
): number {
  return (
    motionComicDialogueCharacterCeiling(panelCount, targetSeconds)
  );
}

export function motionComicVisionCallCeiling(panelCount: unknown): number {
  return motionComicPanelCount(panelCount) * MOTION_COMIC_MAX_VISION_CALLS_PER_PANEL;
}

export function motionComicTtsProviderCallCeiling(panelCount: unknown): number {
  return (
    motionComicPanelCount(panelCount) *
    MOTION_COMIC_MAX_LINES_PER_PANEL *
    MOTION_COMIC_MAX_TTS_PROVIDER_RESPONSES_PER_LINE
  );
}

export function motionComicDialogueCharacterCeiling(
  panelCount: unknown,
  targetSeconds: unknown = undefined,
): number {
  const panels = motionComicPanelCount(panelCount);
  const seconds = Number(targetSeconds);
  const requested = Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds * MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND)
    : panels * 22 * MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND;
  return Math.max(
    panels * MOTION_COMIC_MIN_DIALOGUE_CHARS_PER_PANEL,
    Math.min(panels * MOTION_COMIC_MAX_LINES_PER_PANEL * MOTION_COMIC_MAX_LINE_CHARS, requested),
  );
}
