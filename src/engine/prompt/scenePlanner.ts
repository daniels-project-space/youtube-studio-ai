/**
 * Scene planning — turn a channel topic + style into concrete scene specs.
 *
 * A "scene" is the unit a template renders: one FLUX still prompt + one Kling
 * MOTION-ONLY prompt + a duration. The planner is deterministic and reusable by
 * any template; lofi (Template C) needs exactly ONE scene whose still becomes
 * the two loop keyframes (A and a gentle B variation) for the A→B→A loop.
 *
 * Per-channel consistency: an optional `sceneLibrary` (pre-authored
 * flux+kling+music prompts, locked across a series) is honored verbatim when
 * present — this is the port of legacy `calm_scene_library` / `series_state`,
 * which kept a channel visually consistent run-to-run.
 *
 * IMPORTANT: the planner returns MOTION-ONLY kling prompts. The locked-camera +
 * style constitution is appended later by {@link composeKlingPrompt} at the
 * loop_clips block, so this layer stays template-agnostic.
 */

export interface SceneSpec {
  /** Full FLUX still prompt (already style-composed) for the keyframe. */
  fluxPrompt: string;
  /** MOTION-ONLY description for Kling (no camera/style — constitution adds those). */
  klingMotionPrompt: string;
  /** Target clip duration in seconds. */
  durationSec: number;
}

/**
 * A pre-authored scene library entry. When a channel ships one, the planner
 * uses it verbatim instead of synthesizing prompts — guaranteeing a locked,
 * consistent look across an entire series.
 */
export interface SceneLibraryEntry {
  fluxPrompt: string;
  klingMotionPrompt: string;
  durationSec?: number;
  /** Optional music prompt the library locks alongside the visuals. */
  musicPrompt?: string;
}

export interface ScenePlanInput {
  topic: string;
  styleGrammar?: string;
  visualStyle?: string;
  /** Optional pre-authored library keyed by topic (exact match wins). */
  sceneLibrary?: Record<string, SceneLibraryEntry>;
  /** Default per-clip duration when not specified by a library entry. */
  defaultDurationSec?: number;
}

export interface ScenePlan {
  scenes: SceneSpec[];
  /** Music prompt if a library entry locked one (else undefined). */
  musicPrompt?: string;
  /** Whether the plan came from the pre-authored library (vs synthesized). */
  fromLibrary: boolean;
}

/**
 * Compose the FLUX still prompt + motion-only kling prompt for a lofi loop scene.
 * The still is fully style-composed (so the keyframes look right); the kling
 * prompt is motion-only because the constitution is appended downstream.
 */
function synthesizeLofiScene(input: ScenePlanInput): SceneSpec {
  const { topic } = input;
  // Build the FLUX still prompt via the shared composer to stay consistent with
  // the keyframes block. Imported lazily to avoid a cycle at module init.
  // (Plain composition here keeps the planner pure & sync.)
  const sceneDescription =
    `${topic}, cozy lofi scene, a calm framed view, ` +
    `warm rain-streaked window or neon-lit interior, soft bokeh, no people`;

  // FLUX still: the keyframes block will re-compose with the channel visualStyle,
  // but we provide a fully usable still prompt for templates that consume it raw.
  const fluxPrompt = sceneDescription;

  // Kling MOTION-ONLY: describe what should move, never the camera or style.
  const klingMotionPrompt =
    `slow gentle ambient motion: ${topic} — drifting rain, soft steam, ` +
    `flickering neon glow, faint swaying, seamless calm loop`;

  return {
    fluxPrompt,
    klingMotionPrompt,
    durationSec: input.defaultDurationSec ?? 5,
  };
}

/**
 * Plan the scene(s) for a run. Lofi yields a single scene (→ two keyframes for
 * the loop). Honors a per-channel `sceneLibrary` by exact topic match.
 */
export function planScenes(input: ScenePlanInput): ScenePlan {
  const lib = input.sceneLibrary;
  if (lib && input.topic in lib) {
    const entry = lib[input.topic];
    return {
      scenes: [
        {
          fluxPrompt: entry.fluxPrompt,
          klingMotionPrompt: entry.klingMotionPrompt,
          durationSec: entry.durationSec ?? input.defaultDurationSec ?? 5,
        },
      ],
      musicPrompt: entry.musicPrompt,
      fromLibrary: true,
    };
  }

  // Synthesized single-scene lofi plan (Template C default).
  return {
    scenes: [synthesizeLofiScene(input)],
    fromLibrary: false,
  };
}
