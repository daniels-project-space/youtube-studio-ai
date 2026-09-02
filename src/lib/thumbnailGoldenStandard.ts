/**
 * User-reviewed thumbnail craft references. These are visual-calibration
 * evidence only; they do not grant rights to copy a subject, likeness, logo,
 * or wording. Rejected legacy samples must never be silently promoted here.
 */
export const APPROVED_GOLDEN_THUMBNAIL_IDS = [
  "thumbnail-hannibal-image",
  "thumbnail-rich-image",
  "thumbnail-samurai-image",
  "thumbnail-scandal-image",
  "thumbnail-stoic-anger-image",
  "thumbnail-stoic-memento-image",
] as const;

export const GOLDEN_THUMBNAIL_CRAFT_RULES = [
  "One unmistakable, story-specific hero dominates at phone size and is cropped decisively at the frame edge; a centered hero is optional only when the surrounding type and action read more strongly that way.",
  "Use only two or three meaningful visual elements with real foreground, hero, and background depth.",
  "Avoid a dead 50/50 picture-and-copy split: one hero contour or atmospheric layer should overlap the future type zone.",
  "Headline typography is oversized and treated as a physical visual object, never a generic clean font floating in empty space.",
  "Keep one forceful contrast system and one restrained accent; reject muddy, generic, or product-render imagery.",
  "Channel identity is compact and secondary in a corner; it must never compete with the hook.",
] as const;

/**
 * Cross-video traits extracted from the owner's explicit A/B selections.
 * These are preference signals, not scene templates: never copy the selected
 * characters, wording, or historical setup into another topic.
 */
export const OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES = [
  "Prefer a two-word concrete tension or payoff hook over a longer sentence; make the decisive noun visibly dominant.",
  "Stage the hero at the peak of action with readable emotion in face, eyes, or hands—not a calm pose after the event.",
  "Show cause and consequence together: one close hero action plus one smaller proof detail that completes the story.",
  "Bring one consequential hand, object, rupture, or release into the near foreground so the viewer feels the action before decoding the subject.",
  "Use a strong diagonal or edge crop to pull the eye from hook to hero to consequence in under one second.",
  "Allow a centered hero only for a genuinely stronger peak-action image; arrange supporting type around its silhouette and never turn it into a default symmetrical poster.",
  "Do not let a detached signboard or flat black text panel become the composition. Typography must share the scene's material, light, motion, or negative space while leaving the hero dominant.",
  "Keep headline contrast immediate and physical while preserving one clean hierarchy; do not let background lore compete.",
] as const;
