import type { FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A renderer-neutral visual-treatment vocabulary.
 *
 * This catalog deliberately describes creative intent, pre-production locks,
 * and observable QA standards only. It never selects a model, enables a
 * renderer, or admits a channel automatically. A renderer adapter must bind a
 * plan to byte-backed references and pass the treatment benchmarks before it
 * can claim runtime support.
 */
export const VISUAL_TREATMENT_CATALOG_VERSION = "visual-treatment-catalog/v1" as const;
export const VISUAL_TREATMENT_PLAN_VERSION = "visual-treatment-plan/v1" as const;

export const VISUAL_TREATMENT_KEYS = [
  "clay_stop_motion",
  "brick_built_stop_motion",
  "anime_inspired_2d",
  "drawn_illustrated_2d",
] as const;

export type VisualTreatmentKey = typeof VISUAL_TREATMENT_KEYS[number];
export type VisualTreatmentReferenceKind =
  | "mood_board"
  | "character_sheet"
  | "setting_sheet"
  | "storyboard_frame";
export type VisualTreatmentQaScope = "global" | "frame";

export interface VisualTreatmentQaBenchmark {
  readonly id: string;
  readonly scope: VisualTreatmentQaScope;
  readonly criterion: string;
  readonly failureSignal: string;
}

export interface VisualTreatmentCinematography {
  /** Treatment-specific camera and composition guidance for a DP/shot planner. */
  readonly compositionRules: readonly string[];
  readonly motionRules: readonly string[];
  /** Constraints that belong in an image/video renderer's negative prompt. */
  readonly avoid: readonly string[];
}

export interface VisualTreatmentStoryboard {
  /** Artifacts a future adapter must bind before treating this as render-ready. */
  readonly requiredReferenceKinds: readonly VisualTreatmentReferenceKind[];
  readonly framePlanningRules: readonly string[];
  readonly animaticRules: readonly string[];
}

export interface VisualTreatmentContinuity {
  /** Stable properties which must survive every cut and generated frame. */
  readonly requiredLocks: readonly string[];
  readonly forbiddenDrift: readonly string[];
}

export interface VisualTreatmentRuntimeBoundary {
  readonly mode: "declarative_preproduction_and_qa_only";
  readonly automaticAdmission: false;
  readonly rendererPrerequisites: readonly string[];
  readonly reason: string;
}

export interface VisualTreatmentChannelTypeSeed {
  /** A future, supervised channel-type candidate; this does not mutate FAMILIES. */
  readonly id: string;
  readonly label: string;
  readonly supportedFamilies: readonly FamilyKey[];
  readonly admission: "supervised_only";
  readonly requiredModules: readonly string[];
}

export interface VisualTreatmentDefinition {
  readonly key: VisualTreatmentKey;
  readonly label: string;
  readonly description: string;
  /** Public-safe generic wording. Do not substitute third-party brand names. */
  readonly publicVocabulary: {
    readonly preferredTerms: readonly string[];
    readonly avoidAutomatedTerms: readonly string[];
  };
  readonly cinematography: VisualTreatmentCinematography;
  readonly storyboard: VisualTreatmentStoryboard;
  readonly continuity: VisualTreatmentContinuity;
  readonly qaBenchmarks: readonly VisualTreatmentQaBenchmark[];
  readonly channelType: VisualTreatmentChannelTypeSeed;
  readonly runtime: VisualTreatmentRuntimeBoundary;
}

export interface VisualTreatmentPlan {
  readonly version: typeof VISUAL_TREATMENT_PLAN_VERSION;
  readonly catalogVersion: typeof VISUAL_TREATMENT_CATALOG_VERSION;
  readonly treatmentKey: VisualTreatmentKey;
  readonly label: string;
  readonly cinematography: VisualTreatmentCinematography;
  readonly storyboard: VisualTreatmentStoryboard;
  readonly continuity: VisualTreatmentContinuity;
  /** Directly compatible with VisualReviewReferenceCriterion's id/scope/criterion shape. */
  readonly qaBenchmarks: readonly VisualTreatmentQaBenchmark[];
  readonly channelType: VisualTreatmentChannelTypeSeed;
  readonly runtime: VisualTreatmentRuntimeBoundary;
  readonly fingerprint: string;
}

const NO_AUTOMATIC_RENDERER_ADMISSION: VisualTreatmentRuntimeBoundary = {
  mode: "declarative_preproduction_and_qa_only",
  automaticAdmission: false,
  rendererPrerequisites: [
    "A treatment-aware image/video renderer adapter must be explicitly registered.",
    "The adapter must bind byte-backed reference assets; textual prompt locks alone are insufficient.",
    "The adapter must pass treatment-specific temporal and frame-level QA benchmarks on retained evidence.",
    "A successful benchmark must be recorded before any automatic channel admission or rendering claim.",
  ],
  reason:
    "The shared catalog is a planning and QA contract. It has no provider invocation, model selection, or automatic admission authority.",
};

const COMMON_BENCHMARKS: readonly VisualTreatmentQaBenchmark[] = [
  {
    id: "storyboard-literal-coverage",
    scope: "frame",
    criterion: "Each reviewed storyboard window visibly depicts its narrated literal moment and intended dramatic action.",
    failureSignal: "generic, unrelated, or semantically contradictory footage",
  },
  {
    id: "treatment-continuity",
    scope: "global",
    criterion: "The selected treatment's identity, palette, lighting, and visual grammar remain coherent across reviewed cuts.",
    failureSignal: "unmotivated style, identity, palette, or lighting drift",
  },
  {
    id: "camera-intent",
    scope: "frame",
    criterion: "Framing and camera motion support the stated story beat without obscuring the primary action or focal subject.",
    failureSignal: "disorienting framing, accidental crop, or camera movement unrelated to the beat",
  },
  {
    id: "unwanted-graphic-artifacts",
    scope: "global",
    criterion: "No accidental typography, watermark, logo, broken anatomy, broken geometry, black frame, or frozen frame is visible.",
    failureSignal: "viewer-noticeable generated artifact or unrelated graphic",
  },
];

export const VISUAL_TREATMENT_CATALOG: readonly VisualTreatmentDefinition[] = [
  {
    key: "clay_stop_motion",
    label: "Clay stop-motion",
    description:
      "Tactile sculpted characters and environments with deliberate frame-by-frame motion, visible material weight, and stable handmade surface detail.",
    publicVocabulary: {
      preferredTerms: ["clay stop-motion", "sculpted stop-motion", "handmade miniature animation"],
      avoidAutomatedTerms: ["Claymation", "in the style of a named studio or film"],
    },
    cinematography: {
      compositionRules: [
        "Frame the miniature world at a scale that preserves material texture and clear character silhouettes.",
        "Use practical-looking motivated light and readable foreground/background separation rather than glossy product photography.",
        "Keep camera distances and horizon logic stable unless a storyboarded move motivates a change.",
      ],
      motionRules: [
        "Plan restrained, stepped motion with clear anticipation, action, and settle poses.",
        "Show contact, weight, and deformation only where the narrative action motivates them.",
        "Reserve large camera moves for a storyboarded reveal; do not use random hand-held wobble as a substitute for stop-motion cadence.",
      ],
      avoid: [
        "plastic-to-real-skin morphing",
        "rubbery uncontrolled deformation",
        "surface texture flicker",
        "weightless float motion",
      ],
    },
    storyboard: {
      requiredReferenceKinds: ["mood_board", "character_sheet", "setting_sheet", "storyboard_frame"],
      framePlanningRules: [
        "Lock sculpted silhouette, material finish, proportions, key props, and scale reference before scene generation.",
        "Draw each story beat as a readable pose-to-pose keyframe with the contact point and intended deformation stated.",
      ],
      animaticRules: [
        "Mark holds and accents intentionally so stepped timing reads as performance rather than dropped frames.",
        "Carry the same model, wardrobe, prop state, and set dressing through adjacent shots unless the script changes them.",
      ],
    },
    continuity: {
      requiredLocks: ["sculpted silhouette", "material texture", "scale", "wardrobe", "prop placement", "set dressing"],
      forbiddenDrift: ["shape-shifting faces", "changing clay material", "teleporting props", "scale jumps"],
    },
    qaBenchmarks: [
      ...COMMON_BENCHMARKS,
      {
        id: "clay-material-integrity",
        scope: "frame",
        criterion: "Sculpted surfaces, joins, and deformation remain plausible for the locked material and pose.",
        failureSignal: "melting, liquid, or photoreal-skin transformation unrelated to the scene",
      },
      {
        id: "clay-stepped-performance",
        scope: "global",
        criterion: "Temporal cadence reads as intentional stop-motion performance with stable pose continuity between sampled frames.",
        failureSignal: "unintended jitter, flicker, random pose reset, or motion that loses weight/contact",
      },
    ],
    channelType: {
      id: "clay-stop-motion-story-world/v1",
      label: "Clay stop-motion story world",
      supportedFamilies: ["cinematic", "comic", "children_learning"],
      admission: "supervised_only",
      requiredModules: ["visual_treatment_plan", "visual_matter", "treatment_renderer_adapter", "qa_visual"],
    },
    runtime: NO_AUTOMATIC_RENDERER_ADMISSION,
  },
  {
    key: "brick_built_stop_motion",
    label: "Brick-built stop-motion",
    description:
      "Generic interlocking-brick miniature animation with readable construction geometry, modular sets, and deliberate stop-motion performance.",
    publicVocabulary: {
      preferredTerms: ["brick-built stop-motion", "interlocking-brick animation", "modular brick miniature"],
      avoidAutomatedTerms: ["LEGO", "minifigure", "in the style of a named toy brand"],
    },
    cinematography: {
      compositionRules: [
        "Use clear orthographic-feeling set geography and silhouette-first compositions so construction geometry remains legible.",
        "Treat studs, seams, and connections as visual structure, not random texture; avoid close crops that hide spatial logic.",
        "Use motivated miniature-scale lighting and controlled depth of field without turning the scene into branded product imagery.",
      ],
      motionRules: [
        "Animate in discrete, purposeful pose changes that respect rigid construction and connection points.",
        "Show collisions, falls, and builds with clear before/after construction states.",
        "Use camera movement only when it clarifies a build, action route, or reveal.",
      ],
      avoid: [
        "branded logos or packaging",
        "recognizable protected toy-character design",
        "melting connections",
        "floating bricks without narrative motivation",
      ],
    },
    storyboard: {
      requiredReferenceKinds: ["mood_board", "character_sheet", "setting_sheet", "storyboard_frame"],
      framePlanningRules: [
        "Specify generic brick silhouette, construction rules, character proportions, and connection state for every recurring element.",
        "Record build-state changes as separate storyboard beats so a renderer cannot invent or erase structural steps.",
      ],
      animaticRules: [
        "Call out every assembly, breakage, and rebuild transition with a held key pose before the next action.",
        "Keep routes through a modular set geographically consistent across cuts.",
      ],
    },
    continuity: {
      requiredLocks: ["generic brick geometry", "connection state", "build state", "scale", "color grouping", "set map"],
      forbiddenDrift: ["brand marks", "changing stud geometry", "impossible connection changes", "unexplained build-state reset"],
    },
    qaBenchmarks: [
      ...COMMON_BENCHMARKS,
      {
        id: "brick-geometry-integrity",
        scope: "frame",
        criterion: "Visible bricks, joints, and construction states are geometrically coherent and consistent with the locked generic brick system.",
        failureSignal: "warped studs, impossible joins, floating parts, or unstable piece scale",
      },
      {
        id: "brick-brand-safety",
        scope: "global",
        criterion: "No third-party toy brand name, logo, packaging, or recognizable protected character design is visible in generated imagery or text.",
        failureSignal: "brand-identifying mark, package, or protected character imitation",
      },
    ],
    channelType: {
      id: "brick-built-stop-motion-adventure/v1",
      label: "Brick-built stop-motion adventure",
      supportedFamilies: ["cinematic", "comic", "children_learning"],
      admission: "supervised_only",
      requiredModules: ["visual_treatment_plan", "visual_matter", "brand_safety_review", "treatment_renderer_adapter", "qa_visual"],
    },
    runtime: NO_AUTOMATIC_RENDERER_ADMISSION,
  },
  {
    key: "anime_inspired_2d",
    label: "Anime-inspired 2D animation",
    description:
      "Original stylized two-dimensional animation using clear line language, deliberate key poses, readable emotion, and controlled cel-like lighting—without imitating a named work or studio.",
    publicVocabulary: {
      preferredTerms: ["anime-inspired 2D animation", "stylized cel animation", "original 2D character animation"],
      avoidAutomatedTerms: ["in the exact style of a named anime", "copy a named studio", "replicate a named character"],
    },
    cinematography: {
      compositionRules: [
        "Compose around silhouette, staging, eyelines, and readable key poses before decorative background detail.",
        "Use lens-equivalent perspective and lighting as a consistent graphic language rather than switching randomly between flat and photoreal depth.",
        "Reserve impact frames, speed lines, and graphic transitions for storyboarded emotional or action beats.",
      ],
      motionRules: [
        "Plan key pose, anticipation, breakdown, and settle state for each expressive action.",
        "Keep facial features, line treatment, and body proportions stable between frames.",
        "Use stylized timing intentionally; do not treat flicker or morphing as energetic animation.",
      ],
      avoid: [
        "line boil unrelated to intended texture",
        "face or eye drift",
        "extra limbs or fingers",
        "unmotivated style switching",
      ],
    },
    storyboard: {
      requiredReferenceKinds: ["mood_board", "character_sheet", "setting_sheet", "storyboard_frame"],
      framePlanningRules: [
        "Character sheets must lock front, three-quarter, and profile silhouettes, key facial proportions, palette, and costume details.",
        "Storyboard each emotional turn with pose, eyeline, staging, and background depth notes before rendering.",
      ],
      animaticRules: [
        "Mark held poses, transitions, impacts, and dialogue reaction beats so timing can be judged independently of render quality.",
        "Maintain screen direction and consistent perspective conventions through a scene.",
      ],
    },
    continuity: {
      requiredLocks: ["silhouette", "facial proportions", "line language", "palette", "costume", "screen direction"],
      forbiddenDrift: ["face swap", "line-style mutation", "perspective collapse", "unexplained palette shift"],
    },
    qaBenchmarks: [
      ...COMMON_BENCHMARKS,
      {
        id: "anime-line-and-cel-consistency",
        scope: "global",
        criterion: "Line weight, cel-like shading logic, palette grouping, and facial construction remain coherent across sampled cuts.",
        failureSignal: "line flicker, painterly drift, inconsistent shading logic, or facial construction changes",
      },
      {
        id: "anime-key-pose-legibility",
        scope: "frame",
        criterion: "Each action frame has a readable silhouette, eyeline, and key pose that communicates the intended beat before fine detail is considered.",
        failureSignal: "ambiguous pose, collapsed silhouette, unreadable expression, or broken anatomy",
      },
    ],
    channelType: {
      id: "anime-inspired-serial-story/v1",
      label: "Anime-inspired serial story",
      supportedFamilies: ["cinematic", "comic", "loreshort"],
      admission: "supervised_only",
      requiredModules: ["visual_treatment_plan", "visual_matter", "serialized_program_context", "treatment_renderer_adapter", "qa_visual"],
    },
    runtime: NO_AUTOMATIC_RENDERER_ADMISSION,
  },
  {
    key: "drawn_illustrated_2d",
    label: "Drawn / illustrated 2D",
    description:
      "Original hand-drawn or illustrated visual language with controlled line, shape, texture, and educational or narrative clarity.",
    publicVocabulary: {
      preferredTerms: ["drawn 2D animation", "illustrated explainer", "original hand-drawn visual language"],
      avoidAutomatedTerms: ["in the style of a named illustrator", "copy a named book or comic", "replicate a named character"],
    },
    cinematography: {
      compositionRules: [
        "Prioritize one clear visual claim or action per frame, using negative space and hierarchy to support narration.",
        "Use camera moves as page-space reveals, reframing, or parallax only when they clarify the argument or story state.",
        "Keep texture and lighting subordinate to legibility; a decorative treatment must not obscure factual labels or actions.",
      ],
      motionRules: [
        "Animate drawn marks, diagrams, and characters with a clear reveal order tied to the spoken claim.",
        "Preserve line weight and shape language during transitions; use intentional morphs only when the storyboard specifies the transformation.",
        "Let emphasis hold long enough for the viewer to understand the visual proof or story beat.",
      ],
      avoid: [
        "unreadable dense composition",
        "line-weight flicker",
        "unintended object morphing",
        "decorative detail that contradicts the narration",
      ],
    },
    storyboard: {
      requiredReferenceKinds: ["mood_board", "character_sheet", "setting_sheet", "storyboard_frame"],
      framePlanningRules: [
        "Define line weight, shape language, palette, textures, icon conventions, and label-safe regions in the visual brief.",
        "For factual or data-led episodes, storyboard the visual proof sequence and source-bound labels before decorative illustration.",
      ],
      animaticRules: [
        "Time every draw-on, reveal, and label hold against the corresponding sentence or factual claim.",
        "Do not require character sheets for an abstract whiteboard or data-only episode unless recurring characters are actually in scope.",
      ],
    },
    continuity: {
      requiredLocks: ["line weight", "shape language", "palette", "texture", "icon conventions", "label-safe regions"],
      forbiddenDrift: ["illegible labels", "unplanned morph", "inconsistent visual metaphor", "texture/style reset"],
    },
    qaBenchmarks: [
      ...COMMON_BENCHMARKS,
      {
        id: "drawn-language-continuity",
        scope: "global",
        criterion: "Line weight, shape language, texture, palette, and visual-metaphor conventions remain coherent across the reviewed sequence.",
        failureSignal: "style reset, line jitter, conflicting illustration grammar, or unintended morph",
      },
      {
        id: "drawn-explainer-legibility",
        scope: "frame",
        criterion: "The visual hierarchy makes the narrated claim, diagram, or story action understandable without obscuring required labels or evidence.",
        failureSignal: "crowded layout, unreadable text, decorative ambiguity, or visual proof that contradicts the narration",
      },
    ],
    channelType: {
      id: "illustrated-story-and-data-explainer/v1",
      label: "Illustrated story and data explainer",
      supportedFamilies: ["illustrated_explainer", "whiteboard", "comic", "loreshort"],
      admission: "supervised_only",
      requiredModules: ["visual_treatment_plan", "storyboard_or_data_visual_plan", "factual_review_when_applicable", "treatment_renderer_adapter", "qa_visual"],
    },
    runtime: NO_AUTOMATIC_RENDERER_ADMISSION,
  },
] as const;

function profileFor(key: VisualTreatmentKey): VisualTreatmentDefinition {
  const profile = VISUAL_TREATMENT_CATALOG.find((candidate) => candidate.key === key);
  if (!profile) throw new Error(`Unknown visual treatment: ${key}`);
  return profile;
}

function planFingerprint(plan: Omit<VisualTreatmentPlan, "fingerprint">): string {
  return sha256Hex(canonicalJson(plan));
}

/** Returns undefined for unknown input; callers must not silently select a treatment. */
export function visualTreatmentKeyFromUnknown(value: unknown): VisualTreatmentKey | undefined {
  return typeof value === "string" && (VISUAL_TREATMENT_KEYS as readonly string[]).includes(value)
    ? value as VisualTreatmentKey
    : undefined;
}

export function visualTreatmentDefinition(key: VisualTreatmentKey): VisualTreatmentDefinition {
  return profileFor(key);
}

/**
 * Creates a sealed planning/QA handoff suitable for future Story Spine, Visual
 * Matter, and visual-review consumers. It is deliberately not a renderer job.
 */
export function planVisualTreatment(key: VisualTreatmentKey): VisualTreatmentPlan {
  const profile = profileFor(key);
  const unsigned: Omit<VisualTreatmentPlan, "fingerprint"> = {
    version: VISUAL_TREATMENT_PLAN_VERSION,
    catalogVersion: VISUAL_TREATMENT_CATALOG_VERSION,
    treatmentKey: profile.key,
    label: profile.label,
    cinematography: profile.cinematography,
    storyboard: profile.storyboard,
    continuity: profile.continuity,
    qaBenchmarks: profile.qaBenchmarks,
    channelType: profile.channelType,
    runtime: profile.runtime,
  };
  return { ...unsigned, fingerprint: planFingerprint(unsigned) };
}

/**
 * Turns the sealed treatment plan projected into Visual Matter into explicit
 * final-master reviewer criteria. A treatment is more than prompt language:
 * every applicable criterion must produce a reviewed pass/fail receipt before
 * production QA can certify the master.
 */
export function visualTreatmentReferenceCriteria(value: unknown): ReadonlyArray<{
  id: string;
  criterion: string;
  scope: VisualTreatmentQaScope;
}> {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("visual treatment review binding must be an object");
  }
  const binding = value as {
    key?: unknown;
    label?: unknown;
    planFingerprint?: unknown;
    qaBenchmarkIds?: unknown;
  };
  const key = visualTreatmentKeyFromUnknown(binding.key);
  if (!key) throw new Error("visual treatment review binding has an unknown treatment key");
  const plan = planVisualTreatment(key);
  if (binding.label !== plan.label || binding.planFingerprint !== plan.fingerprint) {
    throw new Error("visual treatment review binding does not match its canonical treatment plan");
  }
  if (!Array.isArray(binding.qaBenchmarkIds) || binding.qaBenchmarkIds.some((id) => typeof id !== "string")) {
    throw new Error("visual treatment review binding has invalid QA benchmark IDs");
  }
  const declaredIds = [...binding.qaBenchmarkIds].sort();
  const canonicalIds = plan.qaBenchmarks.map((benchmark) => benchmark.id).sort();
  if (declaredIds.length !== canonicalIds.length || declaredIds.some((id, index) => id !== canonicalIds[index])) {
    throw new Error("visual treatment review binding does not declare the complete canonical QA benchmark set");
  }
  return plan.qaBenchmarks.map((benchmark) => ({
    id: `visual-treatment/${plan.treatmentKey}/${benchmark.id}`,
    criterion: `[${plan.label}] ${benchmark.criterion} Failure signal: ${benchmark.failureSignal}.`,
    scope: benchmark.scope,
  }));
}

/**
 * Re-derives a treatment plan from the immutable catalog instead of trusting a
 * caller-supplied prompt/QA bundle. Visual Matter and future renderer adapters
 * use this boundary so an edited plan cannot quietly weaken continuity or
 * treatment-specific review requirements.
 */
export function assertVisualTreatmentPlan(value: unknown): VisualTreatmentPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("visual treatment plan must be an object");
  }
  const key = visualTreatmentKeyFromUnknown((value as { treatmentKey?: unknown }).treatmentKey);
  if (!key) throw new Error("visual treatment plan has an unknown treatment key");
  const canonical = planVisualTreatment(key);
  if (canonicalJson(value) !== canonicalJson(canonical)) {
    throw new Error("visual treatment plan must exactly match the current catalog plan");
  }
  return canonical;
}

/** A direct preflight signal for channel builders and renderer adapters. */
export function visualTreatmentAutomaticAdmission(key: VisualTreatmentKey): {
  readonly admitted: false;
  readonly blockers: readonly string[];
} {
  const runtime = profileFor(key).runtime;
  return {
    admitted: false,
    blockers: [runtime.reason, ...runtime.rendererPrerequisites],
  };
}

/** Future channel builders can list candidates without mutating the live family catalog. */
export function visualTreatmentChannelTypeSeeds(): readonly VisualTreatmentChannelTypeSeed[] {
  return VISUAL_TREATMENT_CATALOG.map((profile) => profile.channelType);
}

/**
 * Guards catalog mistakes at import/test time. This is intentionally strict:
 * a new treatment must be explicit about the renderer boundary, QA evidence,
 * and supervised channel admission before it can enter the shared vocabulary.
 */
export function assertVisualTreatmentCatalog(
  catalog: readonly VisualTreatmentDefinition[] = VISUAL_TREATMENT_CATALOG,
): void {
  const seenKeys = new Set<string>();
  const seenChannelTypes = new Set<string>();
  for (const profile of catalog) {
    if (seenKeys.has(profile.key)) throw new Error(`visual treatment catalog has duplicate key ${profile.key}`);
    seenKeys.add(profile.key);
    if (!profile.label.trim() || !profile.description.trim()) {
      throw new Error(`visual treatment ${profile.key} requires a label and description`);
    }
    if (profile.runtime.automaticAdmission || profile.runtime.mode !== "declarative_preproduction_and_qa_only") {
      throw new Error(`visual treatment ${profile.key} cannot claim renderer or automatic-admission readiness`);
    }
    if (!profile.runtime.rendererPrerequisites.length || !profile.qaBenchmarks.length) {
      throw new Error(`visual treatment ${profile.key} requires renderer prerequisites and QA benchmarks`);
    }
    const seenBenchmarkIds = new Set<string>();
    for (const benchmark of profile.qaBenchmarks) {
      if (!benchmark.id.trim() || !benchmark.criterion.trim() || !benchmark.failureSignal.trim()) {
        throw new Error(`visual treatment ${profile.key} has an incomplete QA benchmark`);
      }
      if (seenBenchmarkIds.has(benchmark.id)) {
        throw new Error(`visual treatment ${profile.key} has duplicate QA benchmark ${benchmark.id}`);
      }
      seenBenchmarkIds.add(benchmark.id);
    }
    if (profile.channelType.admission !== "supervised_only") {
      throw new Error(`visual treatment ${profile.key} cannot create an automatically admitted channel type`);
    }
    if (seenChannelTypes.has(profile.channelType.id)) {
      throw new Error(`visual treatment catalog has duplicate channel type ${profile.channelType.id}`);
    }
    seenChannelTypes.add(profile.channelType.id);
    if (!profile.storyboard.requiredReferenceKinds.includes("storyboard_frame")) {
      throw new Error(`visual treatment ${profile.key} must require storyboard-frame pre-production evidence`);
    }
  }
}

assertVisualTreatmentCatalog();
