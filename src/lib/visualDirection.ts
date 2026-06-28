/**
 * VISUAL DIRECTION — the shared cinematographer doctrine for turning a SPECIFIC
 * narration line into a SPECIFIC, composed image, instead of a generic gist.
 *
 * The failure this fixes: the narration is rich and concrete ("a French diplomat
 * stares at a map of the desert and sees an ocean") but the visual brief was a
 * lossy compression ("a desert; a portrait") that dropped the map, the action,
 * the idea — and the on-screen text was an empty label ("THE VISIONARY"). The
 * picture must REALISE the line, and the text must carry real information.
 *
 * This module holds the doctrine + types; each engine adapts it to its own asset
 * structure (documotion = roles, loreshort = one scene, …) so the same standard
 * of specificity applies across the relevant pipelines.
 */

/** What a directed shot must depict, derived from its narration line. */
export interface DirectedVisual {
  /** The rewritten, specific, composed image brief (no baked-in text). */
  brief: string;
  /** 2–4 concrete elements the rendered frame MUST contain (for QA cue-checking). */
  cues: string[];
}

/**
 * The cinematographer's standard. Injected into the per-shot art-direction prompt
 * of any narrated visual engine. It does NOT pick the shot KIND or pacing — only
 * how to REALISE a line as a rich, faithful, composed image + purposeful text.
 */
export const CINEMATOGRAPHER_DOCTRINE = [
  "You are the CINEMATOGRAPHER. Turn each narration line into a SPECIFIC, composed image — not a generic stock gist. Laws:",
  "",
  "1. CUE FIDELITY — the picture must SHOW the concrete things the line says. List the line's depictable elements (the SUBJECT, the ACTION, the key OBJECTS, the SETTING) and put them ON SCREEN. If the line says 'stares at a map', a MAP is visible and the subject is looking at it. If it says 'sees an ocean', evoke that ocean (even surreally — the desert map bleeding into open sea on the horizon). NEVER silently drop the line's key visual elements.",
  "2. NAME THE SPECIFIC — ground every shot in the REAL subject of this video: the actual person (by name + period-accurate dress/age), the actual place, the actual era, the actual object. Not 'a man' but the specific figure; not 'a city' but that city in that decade. Use the topic to know who/what/when.",
  "3. COMPOSE THE SHOT — direct it like a DP: framing to the scale, camera angle, lens feel, lighting and mood, where the subject sits in frame, foreground/background depth. A deliberate photograph, not a flat plate. When a shot has multiple layers (foreground subject + background), make them TOGETHER realise the moment (foreground = the subject doing the action; background = the setting or the idea).",
  "4. RICHNESS — specific props, textures, period detail, atmosphere, weather, light direction. The details that make a frame feel FINISHED and authored, never thin or empty.",
  "5. PURPOSEFUL TEXT — on-screen text must carry INFORMATION: a real NAME, a DATE, a PLACE, a NUMBER, or a sharp phrase that lands the idea. Never a generic chapter label ('THE VISIONARY', 'THE DIG') when a specific one ('FERDINAND DE LESSEPS', '1.5 MILLION LABOURERS') is available. If the image speaks for itself, prefer no text over a filler label.",
  "6. NO TEXT INSIDE THE IMAGE — the engine renders all text as overlays; image briefs describe PICTURE only, never letters or captions.",
].join("\n");
