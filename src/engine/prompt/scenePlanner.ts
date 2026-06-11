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
import type { StyleDNA } from "../creative/types";

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
  /**
   * On-brand SETTING hint for the loop scene (from the channel persona / niche /
   * cinematographer brief). Drives WHAT is in the frame so the loop matches the
   * channel's goal instead of a one-size template. e.g. "rainy neon Tokyo alley",
   * "sunlit autumn study with a cat", "misty mountain cabin at dawn".
   */
  settingHint?: string;
  /**
   * The channel's frozen Style DNA (Phase 1). When present + grounded (a locked
   * recurringSubject/setting), the loop scene is built to render the channel's
   * actual identity — its subject, setting, color grade, motifs, and the exact
   * elements allowed to move — instead of a generic cozy template.
   */
  styleDNA?: StyleDNA | null;
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

  // GROUNDED PATH: when the channel has a locked Style DNA, render ITS identity —
  // the recurring subject/scenes, color grade, motifs, and only the elements the
  // DNA permits to move. This is what makes every video read as the same channel
  // instead of a generic cozy loop. Multi-scene channels rotate through their
  // signatureScenes (one per video), unified by the art style + grade.
  const d = input.styleDNA;
  const sigScenes = (d?.signatureScenes ?? []).filter((s) => s?.setting?.trim());
  if (d && (sigScenes.length > 0 || (d.recurringSubject?.trim() && d.setting?.trim()))) {
    const pick = sigScenes.length ? sigScenes[Math.floor(Math.random() * sigScenes.length)] : null;
    const sceneSetting = pick ? pick.setting.trim() : `${d.setting}. ${d.recurringSubject}.`;
    const sceneMotion = (pick?.motion?.trim()) || (d.motionVocabulary?.length ? d.motionVocabulary.join("; ") : "");

    const fluxPrompt = [
      `${sceneSetting}.`,
      d.composition ? `Composition: ${d.composition}.` : "",
      d.colorGrade ? `Art style + color grade: ${d.colorGrade}.` : "",
      d.motifs?.length ? `Signature motifs where they naturally fit: ${d.motifs.join(", ")}.` : "",
      `A single calm, beautifully composed held frame evoking "${topic}". Cozy lofi mood, painterly atmospheric depth.`,
      d.visualAvoid?.length ? `Do NOT include: ${d.visualAvoid.slice(0, 6).join(", ")}.` : "",
    ].filter(Boolean).join(" ");

    const klingMotionPrompt =
      (sceneMotion
        ? `Animate ONLY these ambient elements, each subtle and independently looping: ${sceneMotion}. `
        : `slow gentle ambient motion only — subtle atmospheric drift, everything else still. `) +
      `${d.motionDiscipline || "Camera perfectly locked on a tripod, zero movement."} ` +
      `Seamlessly loopable motion that gently returns to the starting state.`;

    return {
      fluxPrompt,
      klingMotionPrompt,
      durationSec: input.defaultDurationSec ?? 5,
    };
  }

  // FALLBACK PATH (no grounded DNA): the SETTING comes from the channel's
  // brief/persona (settingHint) so the loop matches the channel goal; only when
  // none is given do we use a tasteful generic cozy lofi setting (no forced
  // rain/neon — that biased every channel toward the same look).
  const setting = (input.settingHint ?? "").trim();
  const sceneDescription = setting
    ? `${setting}. A single calm, beautifully composed framed view evoking "${topic}", ` +
      `cozy lofi mood, soft bokeh, atmospheric depth, no people`
    : `A cozy lofi scene evoking "${topic}", a calm beautifully framed view, ` +
      `warm inviting light, soft bokeh, atmospheric depth, no people`;

  // FLUX still: the keyframes block will re-compose with the channel visualStyle,
  // but we provide a fully usable still prompt for templates that consume it raw.
  const fluxPrompt = sceneDescription;

  // Kling MOTION-ONLY: describe what should move, never the camera or style. Keep
  // it generic + subtle so the scene-director vision pass (keyframes) can refine
  // it to what's actually in the frame.
  const klingMotionPrompt =
    `slow gentle ambient motion only — the natural atmospheric elements of the ` +
    `scene drift and shimmer subtly (steam, light, foliage, water, particles), ` +
    `everything else perfectly still, seamlessly loopable motion that gently ` +
    `returns to the starting state, seamless calm loop`;

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
