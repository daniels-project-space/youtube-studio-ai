import type { FamilyKey } from "@/engine/families";
import { FAMILY_KEYS } from "@/engine/families";
import type {
  QualityBar,
  ReferenceQualityArea,
  ReferenceQualityContract,
  ReferenceQualityRequirement,
  ReferenceQualitySource,
} from "./types";

/**
 * Static reference-quality calibration.
 *
 * These are source URLs and transferable craft mechanics, not scraped media,
 * a similarity model, or permission to imitate another creator's work. The
 * contract therefore deliberately requires review/measurement evidence rather
 * than reporting an automatic visual comparison that does not exist.
 */
export const REFERENCE_QUALITY_SOURCE_DOCUMENT =
  "docs/CHANNEL_QUALITY_AND_DISCOVERY_PLAYBOOK.md#reference-patterns";

const COMMON_EVIDENCE = {
  causal: ["reviewer-confirmed-causal-beat-sheet"],
  sourceCoverage: ["claim-to-source-to-shot-coverage"],
  pacing: ["reviewer-confirmed-purposeful-change-map"],
  presentation: ["thumbnail-evidence", "originality-evidence"],
  audio: ["audio-intelligibility-or-continuity-evidence"],
} as const;

const SOURCES: Record<string, ReferenceQualitySource> = {
  fern: {
    id: "fern",
    label: "Fern",
    url: "https://www.youtube.com/watch?v=wkVygetgeRY",
    transferableMechanic: "Evidence-led hook, source object, causal timeline, and explicit uncertainty.",
    prohibitedImitation: "Do not copy cases, scripts, visual identity, or unsupported reconstructions.",
  },
  fascinatingHorror: {
    id: "fascinating-horror",
    label: "Fascinating Horror",
    url: "https://www.youtube.com/watch?v=EPaBRegvkuQ",
    transferableMechanic: "A factual event arc that keeps explanation, uncertainty, and presentation disciplined.",
    prohibitedImitation: "Do not copy cases, scripts, visual identity, or unsupported reconstructions.",
  },
  kurzgesagt: {
    id: "kurzgesagt",
    label: "Kurzgesagt – In a Nutshell",
    url: "https://www.youtube.com/@kurzgesagt",
    transferableMechanic: "One question, one legible visual model, causal re-anchoring, and a bounded conclusion.",
    prohibitedImitation: "Do not copy art style, characters, scripts, or claims without independent sources.",
  },
  tedEd: {
    id: "ted-ed",
    label: "TED-Ed",
    url: "https://www.youtube.com/@TEDEd",
    transferableMechanic: "One clear learning question and a comprehensible, bounded explanatory arc.",
    prohibitedImitation: "Do not reuse lessons, illustrations, narration, or branded presentation.",
  },
  pinkfong: {
    id: "pinkfong",
    label: "Pinkfong / Baby Shark Kids’ Songs & Stories",
    url: "https://www.youtube.com/@pinkfong",
    transferableMechanic: "Participatory repetition, clear action cues, and age-appropriate recall moments.",
    prohibitedImitation: "Do not copy songs, characters, melody, visuals, or packaging.",
  },
  soothingRelaxation: {
    id: "soothing-relaxation",
    label: "Soothing Relaxation",
    url: "https://www.youtube.com/@SoothingRelaxation",
    transferableMechanic: "Functional audio continuity and unobtrusive visual support for the listening use case.",
    prohibitedImitation: "Do not reuse music, visuals, titles, or a recognizable channel identity.",
  },
  zackDFilms: {
    id: "zack-d-films",
    label: "Zack D. Films",
    url: "https://www.youtube.com/@zackdfilms",
    transferableMechanic: "An immediate, comprehensible one-idea promise with visual consequence and a compact payoff.",
    prohibitedImitation: "Do not copy topics, scripts, voice, 3D style, sensationalism, graphic material, or unsupported factual claims.",
  },
  brightSide: {
    id: "bright-side",
    label: "BRIGHT SIDE",
    url: "https://www.youtube.com/@BRIGHTSIDEOFFICIAL",
    transferableMechanic: "One legible prompt at a time, a fair participation window, and an unambiguous reveal.",
    prohibitedImitation: "Do not copy questions, wording, answer sets, visual branding, packaging, clickbait, or unsupported facts.",
  },
  deadSound: {
    id: "dead-sound",
    label: "Dead Sound",
    url: "https://www.youtube.com/watch?v=mVLrBJYGxk4",
    transferableMechanic: "Stable visual language, staged wide/close contrast, and sound-led atmosphere.",
    prohibitedImitation: "Do not reuse stories, characters, voice performances, or recognizable IP.",
  },
  dust: {
    id: "dust",
    label: "DUST",
    url: "https://www.youtube.com/watch?v=rv8kOzRZK8g",
    transferableMechanic: "A coherent original-world promise with deliberate visual and sonic presentation.",
    prohibitedImitation: "Do not reuse films, story worlds, performances, or existing IP.",
  },
};

const source = (...ids: Array<keyof typeof SOURCES>): ReferenceQualitySource[] =>
  ids.map((id) => ({ ...SOURCES[id] }));

const requirement = (
  id: string,
  area: ReferenceQualityArea,
  dimensionIds: string[],
  standard: string,
  verification: ReferenceQualityRequirement["verification"],
  evidence: readonly string[],
  sourceIds: string[],
): ReferenceQualityRequirement => ({
  id,
  area,
  dimensionIds,
  standard,
  verification,
  evidence: [...evidence],
  sourceIds,
});

function calibrated(
  family: FamilyKey,
  sources: ReferenceQualitySource[],
  requirements: ReferenceQualityRequirement[],
  unresolvedAreas: ReferenceQualityArea[] = [],
): ReferenceQualityContract {
  return {
    version: "1.0.0",
    family,
    calibration: unresolvedAreas.length ? "partial" : "calibrated",
    comparisonPolicy: "mechanics-only-no-automatic-comparison",
    sourceDocument: REFERENCE_QUALITY_SOURCE_DOCUMENT,
    sources,
    requirements,
    unresolvedAreas,
  };
}

const EXPLAINER_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "causal-beat-sheet",
    "story",
    ["script"],
    "State one answerable question, then anchor every beat to a causal explanation and a bounded conclusion.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.causal, ...COMMON_EVIDENCE.sourceCoverage],
    sourceIds,
  ),
  requirement(
    "purposeful-visual-change",
    "pacing",
    ["pacing", "motion", "footage"],
    "Every visual change must prove, clarify, or advance the current spoken or on-screen point; decorative novelty is a defect.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.pacing,
    sourceIds,
  ),
  requirement(
    "legible-model-and-package",
    "presentation",
    ["footage", "thumbnail", "captions"],
    "Use one legible visual model and a mobile-readable package that makes the episode promise explicit without copying the reference design.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "comprehensible-narration",
    "audio",
    ["voice"],
    "Narration must remain intelligible and ahead of the music bed; audio clarity outranks dramatic underscore.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const CASEFILE_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "evidence-led-causal-beats",
    "story",
    ["script"],
    "Use an evidence-led hook, source object, causal timeline, and explicit uncertainty; factual claims must be traceable before a reviewer signs off.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.causal, ...COMMON_EVIDENCE.sourceCoverage],
    sourceIds,
  ),
  requirement(
    "evidence-bearing-visual-rhythm",
    "pacing",
    ["pacing", "footage", "captions"],
    "Cut rhythm follows the evidence and escalation of the story; never use decorative motion or unsupported reconstruction as proof.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.pacing, ...COMMON_EVIDENCE.sourceCoverage],
    sourceIds,
  ),
  requirement(
    "rights-aware-casefile-presentation",
    "presentation",
    ["footage", "thumbnail", "identity"],
    "Shots, maps, documents, and thumbnails must preserve the story's factual boundaries, rights evidence, and channel identity.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.presentation, ...COMMON_EVIDENCE.sourceCoverage],
    sourceIds,
  ),
  requirement(
    "measured-documentary-narration",
    "audio",
    ["voice"],
    "Narration is calm, intelligible, and timed to the causal evidence rather than manufactured drama.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const FICTION_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "original-causal-beat-sheet",
    "story",
    ["script"],
    "Maintain a coherent original-world promise and reviewer-confirmed causal beats; originality evidence is required for the episode premise and assets.",
    "reviewer-confirmed",
    [...COMMON_EVIDENCE.causal, "originality-evidence"],
    sourceIds,
  ),
  requirement(
    "staged-story-rhythm",
    "pacing",
    ["pacing", "motion", "footage"],
    "Use deliberate wide/close contrast and story-led visual change rather than arbitrary camera movement.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.pacing,
    sourceIds,
  ),
  requirement(
    "stable-original-presentation",
    "presentation",
    ["identity", "footage", "motion", "thumbnail"],
    "Keep visual language stable, original, and legible from episode premise through thumbnail packaging.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "sound-led-atmosphere",
    "audio",
    ["voice"],
    "Voice and sound design carry atmosphere without obscuring words or presenting synthetic acting as documentary fact.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const CHILDREN_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "learning-objective-and-recall",
    "story",
    ["script"],
    "Set one age-appropriate learning objective, demonstrate it in context, repeat it purposefully, then include a retrieval or recap moment.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.causal, "learning-contract-evidence"],
    sourceIds,
  ),
  requirement(
    "participatory-child-rhythm",
    "pacing",
    ["pacing", "motion", "footage"],
    "Use clear action cues and predictable participation beats; visual changes must support understanding rather than overstimulate.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.pacing,
    sourceIds,
  ),
  requirement(
    "safe-legible-child-presentation",
    "presentation",
    ["footage", "captions", "thumbnail", "identity"],
    "Make the learning action legible at child-safe pacing with original imagery, clear captions, and age-appropriate packaging.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "clear-child-narration",
    "audio",
    ["voice"],
    "Narration or sung prompts must be intelligible, appropriately paced, and audibly separated from music.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const AMBIENT_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "functional-listening-promise",
    "story",
    ["identity"],
    "The title, thumbnail, and opening establish a truthful functional listening promise rather than an invented narrative claim.",
    "reviewer-confirmed",
    ["thumbnail-evidence", "originality-evidence"],
    sourceIds,
  ),
  requirement(
    "non-disruptive-rhythm",
    "pacing",
    ["loop_seam", "motion"],
    "Visual movement and musical transitions remain non-disruptive for the intended listening use case.",
    "measured-render-evidence",
    ["loop-seam-evidence", "reviewer-confirmed-purposeful-change-map"],
    sourceIds,
  ),
  requirement(
    "functional-presentation",
    "presentation",
    ["identity", "thumbnail"],
    "The visual system stays original, stable, and supportive of the listening purpose without a derivative channel look.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "audio-continuity",
    "audio",
    ["music", "voice"],
    "Audio continuity, loudness, and any voice layer are measured against the channel's declared listening-use standard.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const SHORTS_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "truthful-immediate-payoff",
    "story",
    ["hook"],
    "Open with one truthful, answerable promise in the first one to two seconds, then earn a compact visual and narrative payoff without sensationalising harm or uncertainty.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.causal,
    sourceIds,
  ),
  requirement(
    "single-idea-short-rhythm",
    "pacing",
    ["pacing", "captions"],
    "Every cut, caption, and visual change must clarify the same idea or escalate its consequence; speed alone is not retention quality.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.pacing,
    sourceIds,
  ),
  requirement(
    "mobile-safe-short-presentation",
    "presentation",
    ["captions", "thumbnail"],
    "The opening frame, key subject, captions, and payoff remain instantly legible in the 9:16 safe area without derivative visual packaging.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "intelligible-short-narration",
    "audio",
    ["voice"],
    "Narration remains intelligible at Short-form pace and the bed never obscures the payoff or factual qualification.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const QUIZ_REQUIREMENTS = (sourceIds: string[]): ReferenceQualityRequirement[] => [
  requirement(
    "fair-question-contract",
    "story",
    ["hook", "captions"],
    "Present one answerable, citation-grounded question at a time; every option and reveal must resolve the prompt unambiguously.",
    "source-trace-plus-review",
    [...COMMON_EVIDENCE.causal, "question-answer-source-evidence"],
    sourceIds,
  ),
  requirement(
    "participation-window-rhythm",
    "pacing",
    ["pacing", "captions"],
    "Question, countdown, lock-in, and reveal create a fair participation window; transitions may be brisk but never rush comprehension.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.pacing,
    sourceIds,
  ),
  requirement(
    "answer-first-quiz-presentation",
    "presentation",
    ["captions", "thumbnail", "identity"],
    "Question, options, timer, and reveal stay readable, ordered, and visibly distinct on every device without copying another channel’s package.",
    "reviewer-confirmed",
    COMMON_EVIDENCE.presentation,
    sourceIds,
  ),
  requirement(
    "supportive-quiz-audio",
    "audio",
    ["music"],
    "The original music bed supports anticipation and reveals without masking timer, prompt, or answer-state comprehension.",
    "measured-render-evidence",
    COMMON_EVIDENCE.audio,
    sourceIds,
  ),
];

const PROFILES: Partial<Record<FamilyKey, ReferenceQualityContract>> = {
  documentary_collage_short: calibrated(
    "documentary_collage_short",
    source("fern", "fascinatingHorror"),
    CASEFILE_REQUIREMENTS(["fern", "fascinating-horror"]),
  ),
  narrated_stock: calibrated(
    "narrated_stock",
    source("fern", "fascinatingHorror"),
    CASEFILE_REQUIREMENTS(["fern", "fascinating-horror"]),
  ),
  illustrated_explainer: calibrated(
    "illustrated_explainer",
    source("kurzgesagt", "tedEd"),
    EXPLAINER_REQUIREMENTS(["kurzgesagt", "ted-ed"]),
  ),
  whiteboard: calibrated(
    "whiteboard",
    source("kurzgesagt", "tedEd"),
    EXPLAINER_REQUIREMENTS(["kurzgesagt", "ted-ed"]),
  ),
  shorts: calibrated(
    "shorts",
    source("zackDFilms"),
    SHORTS_REQUIREMENTS(["zack-d-films"]),
  ),
  children_learning: calibrated(
    "children_learning",
    source("tedEd", "pinkfong"),
    CHILDREN_REQUIREMENTS(["ted-ed", "pinkfong"]),
  ),
  cinematic: calibrated(
    "cinematic",
    source("deadSound", "dust"),
    FICTION_REQUIREMENTS(["dead-sound", "dust"]),
  ),
  comic: calibrated(
    "comic",
    source("deadSound", "dust"),
    FICTION_REQUIREMENTS(["dead-sound", "dust"]),
  ),
  loreshort: calibrated(
    "loreshort",
    source("deadSound", "dust"),
    FICTION_REQUIREMENTS(["dead-sound", "dust"]),
  ),
  music_loop: calibrated(
    "music_loop",
    source("soothingRelaxation"),
    AMBIENT_REQUIREMENTS(["soothing-relaxation"]),
  ),
  sleep: calibrated(
    "sleep",
    source("soothingRelaxation"),
    AMBIENT_REQUIREMENTS(["soothing-relaxation"]),
  ),
  quizyear: calibrated(
    "quizyear",
    source("brightSide"),
    QUIZ_REQUIREMENTS(["bright-side"]),
  ),
};

function cloneContract(contract: ReferenceQualityContract): ReferenceQualityContract {
  return {
    ...contract,
    sources: contract.sources.map((item) => ({ ...item })),
    requirements: contract.requirements.map((item) => ({
      ...item,
      dimensionIds: [...item.dimensionIds],
      evidence: [...item.evidence],
      sourceIds: [...item.sourceIds],
    })),
    unresolvedAreas: [...contract.unresolvedAreas],
  };
}

function unconfiguredContract(family: FamilyKey): ReferenceQualityContract {
  return {
    version: "1.0.0",
    family,
    calibration: "unconfigured",
    comparisonPolicy: "mechanics-only-no-automatic-comparison",
    sourceDocument: REFERENCE_QUALITY_SOURCE_DOCUMENT,
    sources: [],
    requirements: [],
    unresolvedAreas: ["story", "pacing", "presentation", "audio"],
  };
}

/** Returns a cloned, serializable family contract safe to persist on a channel. */
export function referenceQualityContractFor(family: FamilyKey): ReferenceQualityContract {
  const configured = PROFILES[family];
  return configured ? cloneContract(configured) : unconfiguredContract(family);
}

/** Deterministic structural audit: no source-free or fake automatic benchmark may enter a rubric. */
export function assertReferenceQualityContracts(): void {
  for (const family of FAMILY_KEYS) {
    const contract = referenceQualityContractFor(family);
    if (contract.family !== family) throw new Error(`reference-quality family mismatch for ${family}`);
    if (contract.version !== "1.0.0") throw new Error(`unsupported reference-quality version for ${family}`);
    if (contract.comparisonPolicy !== "mechanics-only-no-automatic-comparison") {
      throw new Error(`${family} must not claim automatic reference comparison`);
    }
    const sourceIds = new Set<string>();
    for (const item of contract.sources) {
      if (!item.id || sourceIds.has(item.id)) throw new Error(`${family} has duplicate/empty reference source`);
      sourceIds.add(item.id);
      const url = new URL(item.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith("youtube.com")) {
        throw new Error(`${family}:${item.id} must have a canonical HTTPS YouTube URL`);
      }
      if (!item.transferableMechanic.trim() || !item.prohibitedImitation.trim()) {
        throw new Error(`${family}:${item.id} needs transferable-mechanic and no-copy boundaries`);
      }
    }
    for (const item of contract.requirements) {
      if (!item.id.trim() || !item.standard.trim() || !item.dimensionIds.length || !item.evidence.length) {
        throw new Error(`${family} has an incomplete reference-quality requirement`);
      }
      if (!item.sourceIds.length || item.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
        throw new Error(`${family}:${item.id} references an unknown or missing source`);
      }
    }
    if (contract.calibration === "calibrated" && (!contract.sources.length || !contract.requirements.length || contract.unresolvedAreas.length)) {
      throw new Error(`${family} falsely reports a complete reference calibration`);
    }
    if (contract.calibration === "unconfigured" && (contract.sources.length || contract.requirements.length)) {
      throw new Error(`${family} must not mix unconfigured status with unproven reference standards`);
    }
  }
}

/**
 * Persists the exact sources and augments existing dimension guidance with the
 * relevant mechanics/evidence vocabulary. It does not create metrics that the
 * renderer cannot measure and it does not add a competitor-comparison claim.
 */
export function attachReferenceQualityContract(
  family: FamilyKey,
  qualityBar: QualityBar,
): QualityBar {
  // The creator path must fail closed if a static source map is malformed; this
  // is deliberately deterministic and performs no network/provider work.
  assertReferenceQualityContracts();
  const contract = referenceQualityContractFor(family);
  const labels = new Map(contract.sources.map((item) => [item.id, item.label]));
  const dimensions = qualityBar.dimensions.map((dimension) => ({ ...dimension }));
  // A family may already have a broad rubric that omitted an otherwise relevant
  // standard (for example voice in a whiteboard explainer). Attach one existing
  // dimension id from the requirement rather than leave the profile orphaned.
  for (const item of contract.requirements) {
    if (dimensions.some((dimension) => item.dimensionIds.includes(dimension.id))) continue;
    const id = item.dimensionIds[0];
    if (!id) continue;
    dimensions.push({
      id,
      description: `Meets the channel's reference-quality ${item.area} standard.`,
      minScore: 1,
    });
  }
  return {
    ...qualityBar,
    dimensions: dimensions.map((dimension) => {
      const matching = contract.requirements.filter((item) => item.dimensionIds.includes(dimension.id));
      if (!matching.length) return { ...dimension };
      const referenceGuidance = matching.map((item) => {
        const sourceLabels = item.sourceIds.map((sourceId) => labels.get(sourceId) ?? sourceId).join(", ");
        return [
          `Reference-quality ${item.area} (${sourceLabels}; mechanics only, no automatic comparison): ${item.standard}`,
          `Proof: ${item.evidence.join(", ")} (${item.verification}).`,
        ].join(" ");
      }).join(" ");
      // Keep the stored rubric compatible with existing bounded renderer schemas.
      return { ...dimension, description: `${dimension.description} ${referenceGuidance}`.slice(0, 780) };
    }),
    referenceQuality: contract,
  };
}
