/**
 * shotComposition — ONE job: decide HOW A SHOT IS FRAMED.
 *
 * Not what happens in it (that is the script), not who is in it (that is
 * src/lib/channelCharacter.ts), not which model draws it (that is the render
 * farm) and not when it cuts (that is the story spine's timing maths). Only the
 * camera's relationship to the subject: where the lens is, who is holding it,
 * what the move vocabulary is, and what must never appear in frame.
 *
 * WHY THIS EXISTS AS A MODULE RATHER THAN AN `if` IN THE PLANNER
 * `planStorySpine` currently hardcodes one composition language: a third-person
 * cinematic grammar (dolly push, truck left, establishing/medium/close, "35mm
 * natural"). That is correct for the `cinematic` family and wrong for a
 * first-person travel vlog, where the defining visual fact is that the SUBJECT
 * IS HOLDING THE CAMERA. Selfie framing is not a different renderer, a
 * different provider or a different pipeline — it is a different prompt and a
 * different move vocabulary feeding the SAME Z-Image -> LTX chain. So it is a
 * profile, and the planner reads it.
 *
 * The default profile reproduces the planner's previous strings EXACTLY
 * (`cinematicThirdPerson`), so adding this module changed no existing family's
 * output. `shotCompositionWiring.test.ts` asserts that byte-for-byte rather
 * than trusting this comment.
 *
 * Pure data + pure functions. No I/O, no provider imports, no model calls.
 */

export type ShotCompositionKey = "cinematic_third_person" | "pov_handheld_vlog";

export const DEFAULT_SHOT_COMPOSITION: ShotCompositionKey = "cinematic_third_person";

/**
 * THE HARD CONSTRAINT ON THIS MODULE, stated up front.
 *
 * `cameraMove` and `shotScale` are not free text. They are closed enums in
 * `ShotPlanSchema` (src/engine/storySpine.ts) that are forwarded verbatim into
 * the render bridge's video job payload (`novitaRenderFarm.videoJobs`), which
 * is a live contract with the GPU pods. A profile therefore MAY NOT invent
 * `handheld_selfie_walk` or `selfie_close`: it must select from the vocabulary
 * the bridge already speaks, and express everything else about the framing in
 * the PROMPT — which is where a diffusion model reads it from anyway.
 *
 * These two unions mirror the schema deliberately rather than importing it
 * (src/engine imports src/lib, so the reverse would be a cycle).
 * `shotCompositionWiring.test.ts` parses every profile's vocabulary through the
 * real `ShotPlanSchema` so the mirror cannot drift.
 */
export type CompositionCameraMove =
  | "static"
  | "dolly_push"
  | "dolly_pull"
  | "crane_up"
  | "crane_down"
  | "orbit_left"
  | "orbit_right"
  | "truck_left"
  | "truck_right"
  | "handheld_drift";

export type CompositionShotScale = "wide" | "medium" | "close" | "extreme_close" | "establishing";

export interface ShotCompositionProfile {
  key: ShotCompositionKey;
  label: string;
  description: string;
  /** Camera-move vocabulary, cycled per shot by the planner. */
  cameraMoves: readonly CompositionCameraMove[];
  /** Shot-scale vocabulary, cycled per shot by the planner. */
  shotScales: readonly CompositionShotScale[];
  /**
   * Lens description spliced into the KEYFRAME PROMPT.
   *
   * Kept separate from `planLensFor` because the planner has always used two
   * SLIGHTLY DIFFERENT rules for the same shot — the prompt said "85mm
   * portrait" only for `close`, while the recorded shot plan said it for
   * `close` and `extreme_close`. That divergence is preserved verbatim rather
   * than tidied, because "tidying" it would change the prompt of every
   * extreme-close shot on every existing cinematic channel. A profile that does
   * not care may point both at one function, as the POV profile does.
   */
  lensFor: (shotScale: CompositionShotScale) => string;
  /** Lens description recorded on the shot plan (`ShotPlan.lens`). */
  planLensFor: (shotScale: CompositionShotScale) => string;
  /**
   * The framing clause spliced into every keyframe prompt for this profile.
   * "" for the cinematic default, which deliberately says nothing extra so its
   * prompts are unchanged from before this module existed.
   */
  framingClause: string;
  /** Extra negative-prompt terms this framing needs. Merged, never replacing. */
  negativeTerms: readonly string[];
  /** The motion clause appended to every i2v prompt for this profile. */
  motionClause: string;
}

/**
 * The move and scale vocabularies the planner has always used. Kept verbatim,
 * in order, because the planner indexes them by `shotNo % length` — reordering
 * them silently re-cuts every existing cinematic channel.
 */
const CINEMATIC_MOVES: readonly CompositionCameraMove[] = [
  "dolly_push", "truck_left", "static", "dolly_pull", "handheld_drift",
];
const CINEMATIC_SCALES: readonly CompositionShotScale[] = [
  "establishing", "medium", "close", "wide", "extreme_close",
];

/**
 * POV vocabulary, drawn from the SAME closed enum (see the note above).
 *
 * The selection is the statement: no crane and no orbit, because the in-fiction
 * camera operator is a person holding a phone at arm's length and has neither.
 * `handheld_drift` dominates (three of five slots) because that IS the format;
 * `static` is the host standing still to talk; the single `dolly_push` is a
 * walk-toward, which is what a walking vlogger's footage actually looks like.
 *
 * Scales skew close/medium — a selfie is a close-up — with one `wide` so the
 * location gets to be a character too. `extreme_close` is deliberately absent:
 * at arm's length there is no such shot.
 */
const POV_MOVES: readonly CompositionCameraMove[] = [
  "handheld_drift", "static", "handheld_drift", "dolly_push", "handheld_drift",
];
const POV_SCALES: readonly CompositionShotScale[] = [
  "close", "medium", "close", "wide", "medium",
];

export const SHOT_COMPOSITION_PROFILES: Readonly<Record<ShotCompositionKey, ShotCompositionProfile>> = {
  cinematic_third_person: {
    key: "cinematic_third_person",
    label: "Cinematic (third person)",
    description:
      "Observed, invisible-camera coverage: the audience watches the scene from outside it. The existing default for every narrated generated-scene family.",
    cameraMoves: CINEMATIC_MOVES,
    shotScales: CINEMATIC_SCALES,
    lensFor: (shotScale) => (shotScale === "close" ? "85mm portrait" : "35mm natural"),
    planLensFor: (shotScale) =>
      shotScale === "close" || shotScale === "extreme_close" ? "85mm portrait" : "35mm natural",
    // Deliberately empty — see the module header. Adding anything here changes
    // every existing cinematic channel's prompts.
    framingClause: "",
    negativeTerms: [],
    motionClause: "",
  },
  pov_handheld_vlog: {
    key: "pov_handheld_vlog",
    label: "First-person POV vlog (handheld selfie)",
    description:
      "The host holds the camera at arm's length and talks to it while the world happens behind them. Travel-vlog grammar in a period or location setting, not documentary coverage.",
    cameraMoves: POV_MOVES,
    shotScales: POV_SCALES,
    // A phone-at-arm's-length is a wide, close lens. A long portrait lens is
    // the single most reliable way to make a selfie read as a film still
    // instead — so this profile never reaches for one.
    lensFor: (shotScale) => (shotScale === "wide" ? "24mm wide, chest height" : "24mm wide, arm's length"),
    // One rule, both surfaces: this profile has no historical divergence to keep.
    planLensFor: (shotScale) => (shotScale === "wide" ? "24mm wide, chest height" : "24mm wide, arm's length"),
    framingClause: [
      "FIRST-PERSON VLOG FRAMING: the subject is HOLDING THE CAMERA THEMSELVES at arm's length and speaking",
      "directly into the lens, exactly like a modern travel vlogger. Their own extended arm or hand is visible",
      "at the edge of frame; the framing is slightly off-centre and imperfect; the horizon is a little tilted.",
      "The subject occupies the near half of the frame and the LOCATION is legible behind and around them,",
      "in natural available light. This is casual amateur footage, not a film still: no crew lighting, no rig,",
      "no shallow cinematic bokeh, no colour grade.",
    ].join(" "),
    negativeTerms: [
      "tripod",
      "film crew",
      "professional studio lighting",
      "cinematic bokeh",
      "third-person observer framing",
      "modern camera equipment visible in the scene",
      "smartphone visible in the reflection",
    ],
    motionClause:
      "The camera is held in the subject's own hand: motion is small, organic and continuous, with natural " +
      "hand shake and slight sway as they walk or gesture. It never moves on a rig, dolly, crane or gimbal.",
  },
};

export const SHOT_COMPOSITION_KEYS = Object.keys(SHOT_COMPOSITION_PROFILES) as ShotCompositionKey[];

export function isShotCompositionKey(value: unknown): value is ShotCompositionKey {
  return typeof value === "string" && (SHOT_COMPOSITION_KEYS as string[]).includes(value);
}

/**
 * Resolve a requested profile, falling back to the cinematic default. Total by
 * design: `planStorySpine` must never throw because a channel carries an
 * unrecognised composition string — it must render the way it always did.
 */
export function shotCompositionProfile(value: unknown): ShotCompositionProfile {
  return SHOT_COMPOSITION_PROFILES[
    isShotCompositionKey(value) ? value : DEFAULT_SHOT_COMPOSITION
  ];
}

/**
 * Compose the framing half of a keyframe prompt. The profile's clause goes
 * FIRST, before the story content, because the framing is the constant and the
 * content is the variable — and a constant that moves position between renders
 * is a different prompt.
 *
 * Returns the parts to splice, not a finished string, so the planner keeps
 * ownership of its own prompt layout (locked world, "no text in image", etc).
 */
export function compositionPromptParts(
  profile: ShotCompositionProfile,
  shotScale: CompositionShotScale,
): { framing: string; lens: string } {
  return {
    // Trailing punctuation is stripped because the planner joins its prompt
    // parts with ". " — a clause that ends in its own full stop would render
    // ".. " and quietly differ from the string every existing channel produces.
    framing: profile.framingClause.replace(/\.\s*$/, ""),
    lens: `Shot scale: ${shotScale}; lens: ${profile.lensFor(shotScale)}`,
  };
}

/**
 * Merge the profile's negative terms into the channel's own visual-avoid list
 * WITHOUT dropping either. De-duplicated case-insensitively so a channel that
 * already bans "tripod" does not get it twice.
 */
export function compositionNegative(
  profile: ShotCompositionProfile,
  channelNegatives: readonly string[],
): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...channelNegatives, ...profile.negativeTerms]) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.join(", ");
}
