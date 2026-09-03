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

/**
 * Distilled by studying the approved references directly, and several of these
 * CONTRADICT what the module was previously instructing. The prompts had been
 * asking for hard directional light, atmospheric drama and the obvious heroic
 * moment; the references win by doing almost the opposite.
 */
export const GOLDEN_THUMBNAIL_CRAFT_RULES = [
  "SET IT SOMEWHERE UNEXPECTED. The approved work does not stage the obvious moment: the Hannibal reference is not at the walls of Rome, it is an armoured elephant in an alpine blizzard. Ask what the predictable setting for this topic is, then find the moment of the same story that nobody pictures — the crossing rather than the arrival, the aftermath rather than the battle, the preparation rather than the event.",
  "THE MOST SURPRISING ELEMENT IS THE HERO, not the most important person. In that reference the elephant's armoured head owns the frame and the commander is small on its back. The famous name is the topic; the unexpected object is the image.",
  "NEAR-MONOCHROME FIELD PLUS ONE SATURATED ACCENT. The approved frames are close to two-tone — a whole field of snow-grey, newsprint-cream or ink-black — with a single hot colour carrying the accent and the type. That is what survives at 120px. A frame where every element competes at mid-saturation reads as mud, however rich it looks at full size.",
  "GIVE SCALE A DEVICE, not an adjective. A column of tiny figures receding into a valley does more for scale than any amount of atmosphere, because the eye measures the hero against something countable.",
  "PUT THE TYPE ON GENUINELY EMPTY GROUND. The reference gives its headline an entire empty half of snow. Type fighting texture is the most common way a strong scene becomes an unreadable thumbnail.",
  "MATCH THE TYPE TO THE WORLD'S MATERIAL — weathered metal in a blizzard, torn newsprint in a scandal collage — so the lettering belongs to the same physical place as the scene.",
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
  "A centered hero is a first-class composition, not a fallback: when the subject is met head-on at peak action — a face, a mask, a barrel-on object, a doorway or a corridor — centre it, build converging depth and foreground tension around it, and arrange the type in the clean pockets around its silhouette. Symmetry is welcome when the frame is charged; the only failure is a flat, evenly-lit title card with a small object floating in the middle.",
  "Do not let a detached signboard or flat black text panel become the composition. Typography must share the scene's material, light, motion, or negative space while leaving the hero dominant.",
  "Keep headline contrast immediate and physical while preserving one clean hierarchy; do not let background lore compete.",
] as const;
