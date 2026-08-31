import type { FamilyKey } from "@/engine/families";
import type { VisualTreatmentKey } from "@/engine/visualTreatmentCatalog";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Curated LTX LoRA admission contracts.
 *
 * This module intentionally does not download a weight, inspect a filesystem,
 * call ComfyUI, or start a render. It resolves only a caller-supplied local
 * asset inventory that has already been verified. An official source URL is
 * useful provenance, but never enough to make an adapter runnable.
 */
export const CURATED_LORA_REGISTRY_VERSION = "curated-lora-registry/v1" as const;
export const CURATED_LORA_BENCHMARK_VERSION = "curated-lora-benchmark/v2" as const;
export const CURATED_LORA_SELECTION_VERSION = "curated-lora-selection/v1" as const;
export const SERIES_LORA_CONTINUITY_BINDING_VERSION = "series-lora-continuity-binding/v1" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const IMMUTABLE_REVISION = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._/-]{1,159}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LTX_LICENSE_ID = "ltx-2-community-license" as const;
const LTX_LICENSE_URL = "https://github.com/Lightricks/LTX-2/blob/main/LICENSE.md";

export type CuratedLoraAdapterClass = "standard_lora" | "ic_lora";
export type StandardLoraPurpose = "style" | "subject" | "distillation";
/**
 * The one visual property a candidate must materially improve over the
 * unadapted baseline. This prevents a generic "looks good" review from
 * admitting a LoRA that does not help the job it was selected to do.
 */
export type CuratedLoraQualityMetric =
  | "visual_fidelity"
  | "identity_continuity"
  | "structural_adherence"
  | "motion_continuity"
  | "detail_fidelity"
  | "dynamic_range"
  | "lip_sync"
  | "detail_recovery"
  | "composition_integrity"
  | "color_continuity"
  | "lighting_continuity"
  | "vfx_physical_coherence"
  | "background_reconstruction"
  | "static_region_stability";
export type ICLoraControl =
  | "reference_sheet"
  | "edge"
  | "depth"
  | "pose"
  | "motion_track"
  | "spatial_upscale"
  /** A positional SDR/HDR guide video; requires an HDR-aware workflow. */
  | "hdr_video"
  /** A dialogue/video guide pair for a dedicated lip-sync workflow. */
  | "dialogue_video"
  /** A byte-bound source video for detail recovery, never a generic style hint. */
  | "restoration_video"
  /** A canvas/mask-aware source video for reframing or extension. */
  | "composition_video"
  /** A source video whose colour treatment is the explicit requested control. */
  | "color_reference_video"
  /** A source clip with a direction-ball guide for exterior relighting. */
  | "light_direction_video"
  /** A daytime reference clip for a frame-aligned day-to-night transformation. */
  | "daylight_reference_video"
  /** A dry source clip used to add physically plausible water only. */
  | "water_reference_video"
  /** A source clip from which dynamic subjects are removed to form a clean plate. */
  | "clean_plate_reference_video";
export type CuratedLoraTargetScope = "channel" | "treatment" | "shot_control";
export type CuratedLoraLoader = "comfyui_lora" | "comfyui_ltx_ic_lora" | "ltx_pipelines";

export interface OfficialLoraSource {
  readonly publisher: "Lightricks";
  readonly modelUrl: string;
  readonly modelVersion: string;
  readonly fileName: string;
  /** Must be a pinned upstream revision before any resolver can admit the candidate. */
  readonly immutableRevision: string | null;
  /** Must be a pinned weight digest before any resolver can admit the candidate. */
  readonly sha256: string | null;
  readonly license: {
    readonly id: typeof LTX_LICENSE_ID;
    readonly termsUrl: string;
    readonly accessTermsRequireAcceptance: true;
  };
}

export interface CuratedLoraRuntimeCompatibility {
  readonly baseModelIds: readonly string[];
  readonly baseModelVersions: readonly string[];
  /** No candidate is portable across an unpinned base weight. */
  readonly baseModelSha256: string | null;
  readonly allowedLoaders: readonly CuratedLoraLoader[];
}

export interface StandardLoraAdapter {
  readonly adapterClass: "standard_lora";
  readonly purpose: StandardLoraPurpose;
  /** A learned subject adapter must bind an immutable serial context, if used. */
  readonly requiresSeriesContinuity: boolean;
}

export interface ICLoraAdapter {
  readonly adapterClass: "ic_lora";
  readonly controls: readonly ICLoraControl[];
  /** IC-LoRA consumes a byte-bound control/reference artifact, never prompt prose alone. */
  readonly requiresControlArtifact: true;
}

export type CuratedLoraAdapter = StandardLoraAdapter | ICLoraAdapter;

export interface CuratedLoraQualityRequirement {
  readonly metric: CuratedLoraQualityMetric;
  /** Absolute score required for the adapted output, on the shared 0–10 visual-QA scale. */
  readonly minimumAdaptedScore: number;
  /** Minimum measured gain over the matched no-LoRA baseline. */
  readonly minimumGainOverBaseline: number;
}

export interface CuratedLoraCandidate {
  readonly id: string;
  readonly label: string;
  readonly source: OfficialLoraSource;
  readonly adapter: CuratedLoraAdapter;
  /** What this candidate must prove it improves; never an unconditional quality claim. */
  readonly qualityRequirement: CuratedLoraQualityRequirement;
  readonly compatibleRuntime: CuratedLoraRuntimeCompatibility;
  /** Standard style/subject LoRAs can target a channel/treatment; IC-LoRAs are shot controls only. */
  readonly targetScopes: readonly CuratedLoraTargetScope[];
  readonly supportedTreatments: readonly VisualTreatmentKey[];
  readonly supportedFamilies: readonly FamilyKey[];
  /** An explanatory state, not a readiness claim. All built-in entries begin blocked. */
  readonly status: "descriptor_only_pending_integrity_pin" | "curation_ready";
  readonly notes: readonly string[];
}

export interface CuratedLoraLocalAsset {
  readonly candidateId: string;
  readonly localPath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly sourceVersion: string;
  readonly sourceFileName: string;
  readonly sourceImmutableRevision: string;
  readonly sourceLicenseId: typeof LTX_LICENSE_ID;
  readonly licenseAcceptedAt: string;
  readonly verifiedAt: string;
}

export interface CuratedLoraRuntimePin {
  readonly baseModelId: string;
  readonly baseModelVersion: string;
  readonly baseModelSha256: string;
  readonly loader: CuratedLoraLoader;
}

/**
 * Small bridge to the existing serialized-program contract. It mirrors only
 * stable identity/version fields and avoids importing or mutating series state.
 */
export interface SeriesLoraContinuityBindingCore {
  readonly version: typeof SERIES_LORA_CONTINUITY_BINDING_VERSION;
  readonly seriesIdentity: string;
  readonly episodeNumber: number;
  readonly routeFingerprint: string;
  readonly serializedContextFingerprint: string;
}

export interface SeriesLoraContinuityBinding extends SeriesLoraContinuityBindingCore {
  readonly fingerprint: string;
}

export interface CuratedLoraControlArtifact {
  readonly kind: ICLoraControl;
  readonly r2Key: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export type CuratedLoraSelectionTarget =
  | {
      readonly scope: "channel";
      readonly channelId: string;
      readonly family: FamilyKey;
    }
  | {
      readonly scope: "treatment";
      readonly treatment: VisualTreatmentKey;
    }
  | {
      readonly scope: "shot_control";
      readonly shotId: string;
      readonly control: CuratedLoraControlArtifact;
    };

export interface CuratedLoraSelectionRequest {
  readonly candidateId: string;
  readonly strength: number;
  readonly runtime: CuratedLoraRuntimePin;
  readonly target: CuratedLoraSelectionTarget;
  readonly series?: SeriesLoraContinuityBinding;
}

/** Benchmark scope is capability-bound, not a generic adapter-wide pass. */
export type CuratedLoraBenchmarkTarget =
  | { readonly scope: "channel"; readonly family: FamilyKey }
  | { readonly scope: "treatment"; readonly treatment: VisualTreatmentKey }
  | { readonly scope: "shot_control"; readonly controlKind: ICLoraControl };

export interface CuratedLoraBenchmarkCore {
  readonly version: typeof CURATED_LORA_BENCHMARK_VERSION;
  readonly benchmarkId: string;
  readonly candidateId: string;
  readonly candidateSha256: string;
  readonly runtime: CuratedLoraRuntimePin;
  readonly target: CuratedLoraBenchmarkTarget;
  readonly suiteVersion: string;
  readonly visualVerdict: "pass";
  /** Same scene, seed, prompt, and review protocol before/after the adapter. */
  readonly qualityDelta: {
    readonly metric: CuratedLoraQualityMetric;
    readonly baselineScore: number;
    readonly adaptedScore: number;
  };
  readonly evidenceManifestKey: string;
  readonly evidenceSha256: string;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
}

export interface CuratedLoraBenchmark extends CuratedLoraBenchmarkCore {
  readonly fingerprint: string;
}

export interface CuratedLoraResolvedSelectionCore {
  readonly version: typeof CURATED_LORA_SELECTION_VERSION;
  readonly candidateId: string;
  readonly adapterClass: CuratedLoraAdapterClass;
  readonly localPath: string;
  readonly adapterSha256: string;
  readonly strength: number;
  readonly runtime: CuratedLoraRuntimePin;
  readonly target: CuratedLoraSelectionTarget;
  readonly benchmarkFingerprint: string;
  readonly seriesBindingFingerprint?: string;
}

export interface CuratedLoraResolvedSelection extends CuratedLoraResolvedSelectionCore {
  readonly fingerprint: string;
}

export type CuratedLoraResolution =
  | { readonly status: "blocked"; readonly candidateId: string; readonly blockers: readonly string[] }
  | { readonly status: "eligible"; readonly selection: CuratedLoraResolvedSelection };

function officialSource(input: {
  modelUrl: string;
  modelVersion: string;
  fileName: string;
}): OfficialLoraSource {
  return {
    publisher: "Lightricks",
    modelUrl: input.modelUrl,
    modelVersion: input.modelVersion,
    fileName: input.fileName,
    // The public model cards establish provenance/licensing, but no immutable
    // revision/hash was copied into this source tree. Keep these null so an
    // operator cannot accidentally treat a moving model page as an asset pin.
    immutableRevision: null,
    sha256: null,
    license: {
      id: LTX_LICENSE_ID,
      termsUrl: LTX_LICENSE_URL,
      accessTermsRequireAcceptance: true,
    },
  };
}

/**
 * Official Lightricks descriptors only. They are deliberately non-runnable:
 * each lacks a reviewed immutable source revision, a source SHA-256, a local
 * asset attestation, and a benchmark receipt. No community/CivitAI entry is
 * eligible for this registry.
 */
export const OFFICIAL_LTX_LORA_CANDIDATES: readonly CuratedLoraCandidate[] = [
  {
    id: "ltx-2.5-distilled-lora-450",
    label: "LTX-2.5 distilled LoRA 450",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.5",
      modelVersion: "LTX-2.5",
      fileName: "ltx-2.5-22b-distilled-lora-450-bf16.safetensors",
    }),
    adapter: {
      adapterClass: "standard_lora",
      purpose: "distillation",
      requiresSeriesContinuity: false,
    },
    qualityRequirement: { metric: "visual_fidelity", minimumAdaptedScore: 7.5, minimumGainOverBaseline: 0.25 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.5"],
      baseModelVersions: ["2.5"],
      baseModelSha256: null,
      allowedLoaders: ["ltx_pipelines"],
    },
    targetScopes: [],
    supportedTreatments: [],
    supportedFamilies: [],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Official LTX-2.5 model-card component for dev-transformer workflows.",
      "It is not a style or subject adapter and has no creative selection target.",
    ],
  },
  {
    id: "ltx-2.3-ingredients-ic-lora",
    label: "LTX-2.3 IC-LoRA Ingredients reference-sheet control",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    }),
    adapter: {
      adapterClass: "ic_lora",
      controls: ["reference_sheet"],
      requiresControlArtifact: true,
    },
    qualityRequirement: { metric: "identity_continuity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "children_learning", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Requires a byte-bound, text-free reference sheet converted to the control form expected by the official IC-LoRA workflow.",
      "The published LTX-2.3 training bucket is not an automatic compatibility claim for an LTX-2.5 runtime.",
    ],
  },
  {
    id: "ltx-2.3-union-control-ic-lora",
    label: "LTX-2.3 IC-LoRA union control",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
    }),
    adapter: {
      adapterClass: "ic_lora",
      controls: ["edge", "depth", "pose"],
      requiresControlArtifact: true,
    },
    qualityRequirement: { metric: "structural_adherence", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Official control modes are Canny/edge, depth, and pose; the control artifact must match the selected mode.",
      "Reference downscale and loader wiring are benchmarked runtime facts, not inferred from a prompt preset.",
    ],
  },
  {
    id: "ltx-2.3-motion-track-control-ic-lora",
    label: "LTX-2.3 IC-LoRA motion-track control",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Motion-Track-Control",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors",
    }),
    adapter: {
      adapterClass: "ic_lora",
      controls: ["motion_track"],
      requiresControlArtifact: true,
    },
    qualityRequirement: { metric: "motion_continuity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "The control is a trajectory/reference video, not a generic camera-motion prompt.",
      "Manual or extracted paths require their own artifact provenance before the adapter can be admitted.",
    ],
  },
  {
    id: "ltx-2.3-pixel-spatial-upscaler-ic-lora",
    label: "LTX-2.3 IC-LoRA pixel spatial upscaler",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Pixel-Spatial-Upscaler",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-pixel-spatial-upscaler-x2-0.9.safetensors",
    }),
    adapter: {
      adapterClass: "ic_lora",
      controls: ["spatial_upscale"],
      requiresControlArtifact: true,
    },
    qualityRequirement: { metric: "detail_fidelity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.35 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Creative spatial upscaling synthesizes detail and is not a factual or pixel-faithful restoration path.",
      "It must consume a clean, byte-bound low-resolution shot with matching framing and duration.",
    ],
  },
  {
    id: "ltx-2.5-pixel-spatial-upscaler-ic-lora",
    label: "LTX-2.5 IC-LoRA pixel spatial upscaler (2x)",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler",
      modelVersion: "LTX-2.5",
      fileName: "ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
    }),
    adapter: {
      adapterClass: "ic_lora",
      controls: ["spatial_upscale"],
      requiresControlArtifact: true,
    },
    qualityRequirement: { metric: "detail_fidelity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.35 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.5"],
      baseModelVersions: ["2.5"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "A creative 2x re-render for a clean, framing-matched low-resolution generated shot; it synthesizes detail rather than restoring pixels.",
      "It is not permitted for source-bound factual footage or a failed compressed render; benchmark it against the final review criteria at the exact target resolution.",
    ],
  },
  {
    id: "ltx-2.3-hdr-ic-lora",
    label: "LTX-2.3 IC-LoRA HDR",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-HDR",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-hdr-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["hdr_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "dynamic_range", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "HDR requires a matched SDR/HDR guide and an HDR-aware decode, grading, and delivery path; it is not a brightness filter.",
      "Use only when the release target and final-master QA can retain HDR provenance.",
    ],
  },
  {
    id: "ltx-2.3-dubit-ic-lora",
    label: "LTX-2.3 IC-LoRA DubIt",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-DubIt",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-dubit-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["dialogue_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "lip_sync", minimumAdaptedScore: 8.5, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Dialogue replacement is a dedicated audio-video workflow with its own identity, consent, and final lip-sync evidence requirements.",
      "It must never be used as a generic narration or voice-quality enhancer.",
    ],
  },
  {
    id: "ltx-2.3-deblur-ic-lora",
    label: "LTX-2.3 IC-LoRA deblur restoration",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Deblur",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-deblur-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["restoration_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "detail_recovery", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort", "whiteboard"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Restoration is a post-generation candidate: retain the source shot and compare it against the result before accepting synthesized detail.",
      "It may not be used to alter source-bound factual visuals without a separate evidence policy.",
    ],
  },
  {
    id: "ltx-2.3-decompression-ic-lora",
    label: "LTX-2.3 IC-LoRA decompression restoration",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Decompression",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-decompression-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["restoration_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "detail_recovery", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort", "whiteboard"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "This is for codec-artifact recovery on a retained source shot, not a replacement for a clean first render.",
      "Acceptance must compare the restored result with the same shot's source and preserve both fingerprints.",
    ],
  },
  {
    id: "ltx-2.3-in-outpainting-ic-lora",
    label: "LTX-2.3 IC-LoRA in/outpainting composition control",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["composition_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "composition_integrity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Use only with a storyboard-approved canvas/mask and a byte-bound source shot; it is not an unconstrained reframing step.",
      "The accepted result must still satisfy protected-region, caption, and visual-continuity QA.",
    ],
  },
  {
    id: "ltx-2.3-colorization-ic-lora",
    label: "LTX-2.3 IC-LoRA colorization",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Colorization",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-colorization-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["color_reference_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "color_continuity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    supportedFamilies: ["cinematic", "comic", "illustrated_explainer", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Colour is a creative treatment choice, not source restoration: a reviewed colour reference is required.",
      "Never apply to evidence visuals or archival footage in a way that could imply factual colour fidelity.",
    ],
  },
  {
    id: "ltx-2.3-relight-ic-lora",
    label: "LTX-2.3 IC-LoRA exterior relighting",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Relight",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-relight-1.0.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["light_direction_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "lighting_continuity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Exterior-only lighting correction driven by a frame-aligned source clip with the documented light-direction guide, never a generic colour filter.",
      "The guide, scene exterior classification, protected text regions, and final shadow/readability score must all be retained before use.",
    ],
  },
  {
    id: "ltx-2.3-day-to-night-ic-lora",
    label: "LTX-2.3 IC-LoRA day-to-night relighting",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Day-To-Night",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-day-to-night-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["daylight_reference_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "lighting_continuity", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "A short, frame-aligned daylight-to-night transformation for an already approved shot; it cannot invent a scene or compensate for an unreadably dark render.",
      "Use only when the story plan calls for the transformation and final-master luminance, caption placement, and continuity checks are measured.",
    ],
  },
  {
    id: "ltx-2.3-water-simulation-ic-lora",
    label: "LTX-2.3 IC-LoRA water simulation",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Water-Simulation",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-water-simulation-0.9.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["water_reference_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "vfx_physical_coherence", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Adds real-water behaviour to a frame-aligned dry generated shot while preserving the approved subject, camera, and geometry; it is not a generic fluid/style effect.",
      "The dry reference, explicit water-only edit intent, strength range, and identity/physics benchmark must be sealed for each selected shot.",
    ],
  },
  {
    id: "ltx-2.3-clean-plate-ic-lora",
    label: "LTX-2.3 IC-LoRA clean plate",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Clean-Plate",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-ic-lora-clean-plate-1.0.safetensors",
    }),
    adapter: { adapterClass: "ic_lora", controls: ["clean_plate_reference_video"], requiresControlArtifact: true },
    qualityRequirement: { metric: "background_reconstruction", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "comic", "loreshort"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "Creates a VFX clean plate from a retained shot; it is intended for planned compositing and must preserve a before/after source pair.",
      "It cannot alter source-bound footage or erase people, objects, or safety-relevant evidence without a separate explicit review policy.",
    ],
  },
  {
    id: "ltx-2.3-cinemagraph-lora",
    label: "LTX-2.3 cinemagraph selective-motion LoRA",
    source: officialSource({
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-LoRA-Cinemagraph",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-22b-lora-cinemagraph-0.9.safetensors",
    }),
    adapter: { adapterClass: "standard_lora", purpose: "style", requiresSeriesContinuity: false },
    qualityRequirement: { metric: "static_region_stability", minimumAdaptedScore: 8, minimumGainOverBaseline: 0.5 },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: null,
      allowedLoaders: ["comfyui_lora"],
    },
    targetScopes: ["channel"],
    supportedTreatments: [],
    supportedFamilies: ["cinematic", "music_loop", "sleep"],
    status: "descriptor_only_pending_integrity_pin",
    notes: [
      "For locked-camera, selective-motion loops only; it is explicitly unsuitable for camera moves, dynamic characters, or multi-subject scenes.",
      "A loop/seam benchmark and static-region QA are required before any channel can select it.",
    ],
  },
] as const;

/**
 * Browser-safe representation for the Studio asset desk. This describes an
 * official candidate only; it deliberately contains neither a local path nor
 * a weight/object key and is never a render-admission signal.
 */
export interface StudioCuratedLtxCatalogItem {
  readonly id: string;
  readonly label: string;
  readonly adapterClass: CuratedLoraAdapterClass;
  readonly purpose: StandardLoraPurpose | null;
  readonly controls: readonly ICLoraControl[];
  /** The one measurable quality dimension this candidate must beat its baseline on. */
  readonly qualityMetric: CuratedLoraQualityMetric;
  /** Keeps pre-generation control separate from narrowly scoped post-processing. */
  readonly qualityPhase: "base_generation" | "shot_control" | "targeted_postprocess";
  readonly sourceUrl: string;
  readonly baseModelVersions: readonly string[];
  readonly loaders: readonly CuratedLoraLoader[];
  readonly supportedFamilies: readonly FamilyKey[];
  readonly status: CuratedLoraCandidate["status"];
  /** Explains the actual executor evidence path without granting admission. */
  readonly activationGate: StudioCuratedLtxActivationGate;
  readonly notes: readonly string[];
}

export type StudioCuratedLtxActivationGate =
  | "exact_runtime_and_benchmark"
  | "pinned_asset_license_and_direct_benchmark"
  | "pinned_asset_license_workflow_and_benchmark"
  | "pinned_asset_license_workflow_guide_and_benchmark";

function studioActivationGate(candidate: CuratedLoraCandidate): StudioCuratedLtxActivationGate {
  if (candidate.adapter.adapterClass === "standard_lora" && candidate.adapter.purpose === "distillation") {
    return "exact_runtime_and_benchmark";
  }
  if (candidate.adapter.adapterClass === "ic_lora") {
    return "pinned_asset_license_workflow_guide_and_benchmark";
  }
  return candidate.compatibleRuntime.allowedLoaders.includes("ltx_pipelines")
    ? "pinned_asset_license_and_direct_benchmark"
    : "pinned_asset_license_workflow_and_benchmark";
}

function studioQualityPhase(candidate: CuratedLoraCandidate): StudioCuratedLtxCatalogItem["qualityPhase"] {
  if (candidate.adapter.adapterClass === "standard_lora") return "base_generation";
  if (candidate.adapter.controls.some((control) => ["reference_sheet", "edge", "depth", "pose", "motion_track"].includes(control))) {
    return "shot_control";
  }
  return "targeted_postprocess";
}

export function studioCuratedLtxCatalog(
  candidates: readonly CuratedLoraCandidate[] = OFFICIAL_LTX_LORA_CANDIDATES,
): readonly StudioCuratedLtxCatalogItem[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({
    id: candidate.id,
    label: candidate.label,
    adapterClass: candidate.adapter.adapterClass,
    purpose: candidate.adapter.adapterClass === "standard_lora" ? candidate.adapter.purpose : null,
    controls: candidate.adapter.adapterClass === "ic_lora" ? candidate.adapter.controls : [],
    qualityMetric: candidate.qualityRequirement.metric,
    qualityPhase: studioQualityPhase(candidate),
    sourceUrl: candidate.source.modelUrl,
    baseModelVersions: candidate.compatibleRuntime.baseModelVersions,
    loaders: candidate.compatibleRuntime.allowedLoaders,
    supportedFamilies: candidate.supportedFamilies,
    status: candidate.status,
    activationGate: studioActivationGate(candidate),
    notes: candidate.notes,
  })));
}

function ensureIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} must be a safe identifier`);
}

function ensureText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
}

function ensureSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new Error(`${label} must be a SHA-256 hex digest`);
}

function ensureImmutableRevision(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IMMUTABLE_REVISION.test(value)) {
    throw new Error(`${label} must be a pinned 40-character immutable revision`);
  }
}

function ensureUtc(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ISO_UTC.test(value)) throw new Error(`${label} must be an ISO UTC timestamp`);
}

function ensurePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
}

function isSafeOfficialSource(source: OfficialLoraSource): boolean {
  return source.publisher === "Lightricks"
    && source.modelUrl.startsWith("https://huggingface.co/Lightricks/")
    && source.license.id === LTX_LICENSE_ID
    && source.license.termsUrl === LTX_LICENSE_URL
    && source.license.accessTermsRequireAcceptance === true;
}

function sourceIsPinned(source: OfficialLoraSource): source is OfficialLoraSource & {
  readonly immutableRevision: string;
  readonly sha256: string;
} {
  return typeof source.immutableRevision === "string"
    && IMMUTABLE_REVISION.test(source.immutableRevision)
    && typeof source.sha256 === "string"
    && SHA256_HEX.test(source.sha256);
}

function targetScopesAreValid(candidate: CuratedLoraCandidate): boolean {
  if (candidate.adapter.adapterClass === "ic_lora") {
    return candidate.targetScopes.length === 1 && candidate.targetScopes[0] === "shot_control";
  }
  if (candidate.adapter.purpose === "distillation") return candidate.targetScopes.length === 0;
  return candidate.targetScopes.length > 0
    && candidate.targetScopes.every((scope) => scope === "channel" || scope === "treatment");
}

function assertQualityRequirement(
  requirement: CuratedLoraQualityRequirement,
  candidateId: string,
): CuratedLoraQualityRequirement {
  const knownMetrics: readonly CuratedLoraQualityMetric[] = [
    "visual_fidelity",
    "identity_continuity",
    "structural_adherence",
    "motion_continuity",
    "detail_fidelity",
    "dynamic_range",
    "lip_sync",
    "detail_recovery",
    "composition_integrity",
    "color_continuity",
    "lighting_continuity",
    "vfx_physical_coherence",
    "background_reconstruction",
    "static_region_stability",
  ];
  if (!knownMetrics.includes(requirement.metric)) {
    throw new Error(`curated LoRA ${candidateId} has an unknown quality metric`);
  }
  if (!Number.isFinite(requirement.minimumAdaptedScore) || requirement.minimumAdaptedScore < 7 || requirement.minimumAdaptedScore > 10) {
    throw new Error(`curated LoRA ${candidateId} needs a 7–10 adapted quality floor`);
  }
  if (!Number.isFinite(requirement.minimumGainOverBaseline) || requirement.minimumGainOverBaseline < 0.1 || requirement.minimumGainOverBaseline > 3) {
    throw new Error(`curated LoRA ${candidateId} needs a bounded material quality gain`);
  }
  return requirement;
}

function assertBenchmarkQualityDelta(
  benchmark: CuratedLoraBenchmarkCore,
): CuratedLoraBenchmarkCore["qualityDelta"] {
  const delta = benchmark.qualityDelta;
  assertQualityRequirement(
    { metric: delta.metric, minimumAdaptedScore: 7, minimumGainOverBaseline: 0.1 },
    `${benchmark.candidateId} benchmark`,
  );
  if (!Number.isFinite(delta.baselineScore) || delta.baselineScore < 0 || delta.baselineScore > 10) {
    throw new Error("curated LoRA benchmark baseline score must be within [0, 10]");
  }
  if (!Number.isFinite(delta.adaptedScore) || delta.adaptedScore < 0 || delta.adaptedScore > 10) {
    throw new Error("curated LoRA benchmark adapted score must be within [0, 10]");
  }
  if (delta.adaptedScore <= delta.baselineScore) {
    throw new Error("curated LoRA benchmark must demonstrate a quality gain over its no-LoRA baseline");
  }
  return delta;
}

export function assertCuratedLoraCandidate(value: CuratedLoraCandidate): CuratedLoraCandidate {
  ensureIdentifier(value.id, "curated LoRA id");
  ensureText(value.label, `curated LoRA ${value.id} label`);
  assertQualityRequirement(value.qualityRequirement, value.id);
  if (!isSafeOfficialSource(value.source)) {
    throw new Error(`curated LoRA ${value.id} must point to an official Lightricks model and LTX license`);
  }
  ensureText(value.source.modelVersion, `curated LoRA ${value.id} model version`);
  ensureText(value.source.fileName, `curated LoRA ${value.id} file name`);
  if (value.source.immutableRevision !== null) ensureImmutableRevision(value.source.immutableRevision, `${value.id} source revision`);
  if (value.source.sha256 !== null) ensureSha256(value.source.sha256, `${value.id} source hash`);
  if (value.status === "curation_ready" && !sourceIsPinned(value.source)) {
    throw new Error(`curated LoRA ${value.id} cannot be curation-ready without source revision and hash`);
  }
  if (!targetScopesAreValid(value)) {
    throw new Error(`curated LoRA ${value.id} has invalid target scopes for its adapter class`);
  }
  if (value.adapter.adapterClass === "ic_lora") {
    if (!value.adapter.controls.length || !value.adapter.requiresControlArtifact) {
      throw new Error(`IC-LoRA ${value.id} requires an explicit control mode and control artifact`);
    }
  }
  if (!value.compatibleRuntime.baseModelIds.length || !value.compatibleRuntime.baseModelVersions.length) {
    throw new Error(`curated LoRA ${value.id} requires explicit base-model compatibility`);
  }
  if (!value.compatibleRuntime.allowedLoaders.length) {
    throw new Error(`curated LoRA ${value.id} requires an explicit compatible loader`);
  }
  if (value.compatibleRuntime.baseModelSha256 !== null) {
    ensureSha256(value.compatibleRuntime.baseModelSha256, `${value.id} base-model hash`);
  }
  if (value.status === "curation_ready" && value.compatibleRuntime.baseModelSha256 === null) {
    throw new Error(`curated LoRA ${value.id} cannot be curation-ready without an exact base-model hash`);
  }
  return Object.freeze(value);
}

export function assertCuratedLoraRegistry(
  candidates: readonly CuratedLoraCandidate[] = OFFICIAL_LTX_LORA_CANDIDATES,
): readonly CuratedLoraCandidate[] {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    assertCuratedLoraCandidate(candidate);
    if (ids.has(candidate.id)) throw new Error(`curated LoRA registry has duplicate id ${candidate.id}`);
    ids.add(candidate.id);
  }
  return Object.freeze([...candidates]);
}

export function seriesLoraContinuityBindingFingerprint(
  binding: SeriesLoraContinuityBindingCore,
): string {
  return sha256Hex(canonicalJson(binding));
}

export function createSeriesLoraContinuityBinding(
  binding: Omit<SeriesLoraContinuityBindingCore, "version">,
): SeriesLoraContinuityBinding {
  const core: SeriesLoraContinuityBindingCore = {
    version: SERIES_LORA_CONTINUITY_BINDING_VERSION,
    ...binding,
  };
  assertSeriesLoraContinuityBindingCore(core);
  return Object.freeze({ ...core, fingerprint: seriesLoraContinuityBindingFingerprint(core) });
}

function assertSeriesLoraContinuityBindingCore(
  binding: SeriesLoraContinuityBindingCore,
): SeriesLoraContinuityBindingCore {
  if (binding.version !== SERIES_LORA_CONTINUITY_BINDING_VERSION) {
    throw new Error("series LoRA continuity binding version is unsupported");
  }
  ensureIdentifier(binding.seriesIdentity, "series LoRA continuity identity");
  ensurePositiveInteger(binding.episodeNumber, "series LoRA continuity episode number");
  ensureSha256(binding.routeFingerprint, "series LoRA continuity route fingerprint");
  ensureSha256(binding.serializedContextFingerprint, "series LoRA serialized-context fingerprint");
  return binding;
}

export function assertSeriesLoraContinuityBinding(value: SeriesLoraContinuityBinding): SeriesLoraContinuityBinding {
  const { fingerprint, ...coreValue } = value;
  const core = assertSeriesLoraContinuityBindingCore(coreValue);
  ensureSha256(fingerprint, "series LoRA continuity binding fingerprint");
  if (fingerprint !== seriesLoraContinuityBindingFingerprint(core)) {
    throw new Error("series LoRA continuity binding fingerprint does not match its immutable context");
  }
  return Object.freeze({ ...core, fingerprint });
}

export function curatedLoraBenchmarkFingerprint(benchmark: CuratedLoraBenchmarkCore): string {
  return sha256Hex(canonicalJson(benchmark));
}

export function createCuratedLoraBenchmark(
  benchmark: CuratedLoraBenchmarkCore,
): CuratedLoraBenchmark {
  assertCuratedLoraBenchmarkCore(benchmark);
  return Object.freeze({ ...benchmark, fingerprint: curatedLoraBenchmarkFingerprint(benchmark) });
}

function assertCuratedLoraBenchmarkCore(benchmark: CuratedLoraBenchmarkCore): CuratedLoraBenchmarkCore {
  if (benchmark.version !== CURATED_LORA_BENCHMARK_VERSION) throw new Error("unsupported curated LoRA benchmark version");
  ensureIdentifier(benchmark.benchmarkId, "curated LoRA benchmark id");
  ensureIdentifier(benchmark.candidateId, "curated LoRA benchmark candidate id");
  ensureSha256(benchmark.candidateSha256, "curated LoRA benchmark adapter hash");
  ensureRuntimePin(benchmark.runtime);
  ensureBenchmarkTarget(benchmark.target);
  ensureText(benchmark.suiteVersion, "curated LoRA benchmark suite version");
  if (benchmark.visualVerdict !== "pass") throw new Error("curated LoRA benchmark must explicitly pass visual QA");
  assertBenchmarkQualityDelta(benchmark);
  ensureText(benchmark.evidenceManifestKey, "curated LoRA benchmark evidence manifest key");
  ensureSha256(benchmark.evidenceSha256, "curated LoRA benchmark evidence hash");
  ensureUtc(benchmark.reviewedAt, "curated LoRA benchmark review time");
  ensureIdentifier(benchmark.reviewedBy, "curated LoRA benchmark reviewer");
  return benchmark;
}

export function assertCuratedLoraBenchmark(value: CuratedLoraBenchmark): CuratedLoraBenchmark {
  const { fingerprint, ...coreValue } = value;
  const core = assertCuratedLoraBenchmarkCore(coreValue);
  ensureSha256(fingerprint, "curated LoRA benchmark fingerprint");
  if (fingerprint !== curatedLoraBenchmarkFingerprint(core)) {
    throw new Error("curated LoRA benchmark fingerprint does not match its sealed fields");
  }
  return Object.freeze({ ...core, fingerprint });
}

function ensureRuntimePin(runtime: CuratedLoraRuntimePin): CuratedLoraRuntimePin {
  ensureText(runtime.baseModelId, "curated LoRA base model id");
  ensureText(runtime.baseModelVersion, "curated LoRA base model version");
  ensureSha256(runtime.baseModelSha256, "curated LoRA base-model hash");
  if (!["comfyui_lora", "comfyui_ltx_ic_lora", "ltx_pipelines"].includes(runtime.loader)) {
    throw new Error("curated LoRA loader is unsupported");
  }
  return runtime;
}

function ensureBenchmarkTarget(target: CuratedLoraBenchmarkTarget): CuratedLoraBenchmarkTarget {
  if (target.scope === "channel") {
    ensureIdentifier(target.family, "curated LoRA benchmark family");
  } else if (target.scope === "treatment") {
    ensureIdentifier(target.treatment, "curated LoRA benchmark treatment");
  } else if (target.scope === "shot_control") {
    if (!["reference_sheet", "edge", "depth", "pose", "motion_track", "spatial_upscale", "hdr_video", "dialogue_video", "restoration_video", "composition_video", "color_reference_video", "light_direction_video", "daylight_reference_video", "water_reference_video", "clean_plate_reference_video"].includes(target.controlKind)) {
      throw new Error("curated LoRA benchmark has an unsupported IC-LoRA control kind");
    }
  } else {
    throw new Error("curated LoRA benchmark has an unsupported target scope");
  }
  return target;
}

function ensureLocalAsset(asset: CuratedLoraLocalAsset): CuratedLoraLocalAsset {
  ensureIdentifier(asset.candidateId, "local LoRA asset candidate id");
  ensureText(asset.localPath, "local LoRA asset path");
  ensurePositiveInteger(asset.byteLength, "local LoRA asset byte length");
  ensureSha256(asset.sha256, "local LoRA asset hash");
  ensureText(asset.sourceUrl, "local LoRA asset source URL");
  ensureText(asset.sourceVersion, "local LoRA asset source version");
  ensureText(asset.sourceFileName, "local LoRA asset source file name");
  ensureImmutableRevision(asset.sourceImmutableRevision, "local LoRA asset source revision");
  if (asset.sourceLicenseId !== LTX_LICENSE_ID) throw new Error("local LoRA asset has an unapproved license id");
  ensureUtc(asset.licenseAcceptedAt, "local LoRA asset license acceptance time");
  ensureUtc(asset.verifiedAt, "local LoRA asset verification time");
  return asset;
}

function localPathIsWithinRoot(localPath: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "");
  if (!normalizedRoot || !localPath.startsWith(`${normalizedRoot}/`)) return false;
  return !localPath.split("/").includes("..");
}

function candidateSupportsTarget(candidate: CuratedLoraCandidate, target: CuratedLoraSelectionTarget): string | undefined {
  if (candidate.adapter.adapterClass === "standard_lora" && target.scope === "shot_control") {
    return `${candidate.id} is a standard LoRA and cannot masquerade as IC-LoRA control`;
  }
  if (candidate.adapter.adapterClass === "ic_lora" && target.scope !== "shot_control") {
    return `${candidate.id} is an IC-LoRA and must be selected as a shot control`;
  }
  if (!candidate.targetScopes.includes(target.scope)) {
    return `${candidate.id} is not approved for ${target.scope} selection`;
  }
  if (candidate.adapter.adapterClass === "ic_lora") {
    // Keep this explicit local guard for TypeScript's discriminated-union
    // narrowing and for callers that supply a structurally invalid request.
    if (target.scope !== "shot_control") return `${candidate.id} is an IC-LoRA and must be selected as a shot control`;
    if (!candidate.adapter.controls.includes(target.control.kind)) {
      return `${candidate.id} does not support ${target.control.kind} control`;
    }
    try {
      ensureIdentifier(target.shotId, "IC-LoRA shot id");
      ensureText(target.control.r2Key, "IC-LoRA control artifact key");
      ensureSha256(target.control.sha256, "IC-LoRA control artifact hash");
      ensurePositiveInteger(target.control.byteLength, "IC-LoRA control artifact byte length");
    } catch (error) {
      return error instanceof Error ? error.message : "IC-LoRA control artifact is malformed";
    }
    return undefined;
  }
  if (target.scope === "treatment" && candidate.supportedTreatments.length && !candidate.supportedTreatments.includes(target.treatment)) {
    return `${candidate.id} is not approved for treatment ${target.treatment}`;
  }
  if (target.scope === "channel" && candidate.supportedFamilies.length && !candidate.supportedFamilies.includes(target.family)) {
    return `${candidate.id} is not approved for family ${target.family}`;
  }
  return undefined;
}

function candidateMatchesRuntime(candidate: CuratedLoraCandidate, runtime: CuratedLoraRuntimePin): string | undefined {
  try {
    ensureRuntimePin(runtime);
  } catch (error) {
    return error instanceof Error ? error.message : "curated LoRA runtime is malformed";
  }
  if (!candidate.compatibleRuntime.baseModelIds.includes(runtime.baseModelId)) {
    return `${candidate.id} is not compatible with base model ${runtime.baseModelId}`;
  }
  if (!candidate.compatibleRuntime.baseModelVersions.includes(runtime.baseModelVersion)) {
    return `${candidate.id} is not compatible with base version ${runtime.baseModelVersion}`;
  }
  if (!candidate.compatibleRuntime.allowedLoaders.includes(runtime.loader)) {
    return `${candidate.id} is not compatible with loader ${runtime.loader}`;
  }
  if (candidate.compatibleRuntime.baseModelSha256 !== runtime.baseModelSha256) {
    return `${candidate.id} lacks an exact compatible base-model hash`;
  }
  return undefined;
}

function selectionFingerprint(selection: CuratedLoraResolvedSelectionCore): string {
  return sha256Hex(canonicalJson(selection));
}

function matchingAsset(
  candidate: CuratedLoraCandidate,
  assets: readonly CuratedLoraLocalAsset[],
  localLoraRoot: string,
): { asset?: CuratedLoraLocalAsset; blockers: string[] } {
  const blockers: string[] = [];
  if (!sourceIsPinned(candidate.source)) {
    blockers.push(`${candidate.id} has no immutable official source revision and SHA-256 pin`);
    return { blockers };
  }
  const matches = assets.filter((asset) => asset.candidateId === candidate.id);
  if (matches.length !== 1) {
    blockers.push(`${candidate.id} requires exactly one locally verified asset, found ${matches.length}`);
    return { blockers };
  }
  const asset = matches[0]!;
  try {
    ensureLocalAsset(asset);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : `${candidate.id} local asset is malformed`);
    return { blockers };
  }
  if (!localPathIsWithinRoot(asset.localPath, localLoraRoot)) {
    blockers.push(`${candidate.id} local asset is outside the configured LoRA root`);
  }
  if (
    asset.sha256 !== candidate.source.sha256
    || asset.sourceUrl !== candidate.source.modelUrl
    || asset.sourceVersion !== candidate.source.modelVersion
    || asset.sourceFileName !== candidate.source.fileName
    || asset.sourceImmutableRevision !== candidate.source.immutableRevision
  ) {
    blockers.push(`${candidate.id} local asset does not match its reviewed official source pin`);
  }
  if (asset.sourceLicenseId !== candidate.source.license.id) {
    blockers.push(`${candidate.id} local asset does not carry the approved source license`);
  }
  return blockers.length ? { blockers } : { asset, blockers };
}

function matchingBenchmark(
  candidate: CuratedLoraCandidate,
  asset: CuratedLoraLocalAsset,
  runtime: CuratedLoraRuntimePin,
  target: CuratedLoraSelectionTarget,
  benchmarks: readonly CuratedLoraBenchmark[],
): { benchmark?: CuratedLoraBenchmark; blockers: string[] } {
  const expectedTarget = benchmarkTargetFor(target);
  const candidates = benchmarks.filter((benchmark) =>
    benchmark.candidateId === candidate.id
    && benchmark.candidateSha256 === asset.sha256
    && benchmark.runtime.baseModelId === runtime.baseModelId
    && benchmark.runtime.baseModelVersion === runtime.baseModelVersion
    && benchmark.runtime.baseModelSha256 === runtime.baseModelSha256
    && benchmark.runtime.loader === runtime.loader
    && benchmarkTargetMatches(benchmark.target, expectedTarget),
  );
  if (candidates.length !== 1) {
    return { blockers: [`${candidate.id} requires exactly one matching passed benchmark, found ${candidates.length}`] };
  }
  try {
    const benchmark = assertCuratedLoraBenchmark(candidates[0]!);
    if (benchmark.qualityDelta.metric !== candidate.qualityRequirement.metric) {
      return { blockers: [`${candidate.id} benchmark measures ${benchmark.qualityDelta.metric}, not its required ${candidate.qualityRequirement.metric}`] };
    }
    if (benchmark.qualityDelta.adaptedScore < candidate.qualityRequirement.minimumAdaptedScore) {
      return { blockers: [`${candidate.id} benchmark does not meet its ${candidate.qualityRequirement.minimumAdaptedScore} adapted-quality floor`] };
    }
    if (benchmark.qualityDelta.adaptedScore - benchmark.qualityDelta.baselineScore < candidate.qualityRequirement.minimumGainOverBaseline) {
      return { blockers: [`${candidate.id} benchmark does not show its required ${candidate.qualityRequirement.minimumGainOverBaseline} quality gain over baseline`] };
    }
    return { benchmark, blockers: [] };
  } catch (error) {
    return { blockers: [error instanceof Error ? error.message : `${candidate.id} benchmark is malformed`] };
  }
}

function benchmarkTargetFor(target: CuratedLoraSelectionTarget): CuratedLoraBenchmarkTarget {
  if (target.scope === "channel") return { scope: "channel", family: target.family };
  if (target.scope === "treatment") return { scope: "treatment", treatment: target.treatment };
  return { scope: "shot_control", controlKind: target.control.kind };
}

function benchmarkTargetMatches(
  actual: CuratedLoraBenchmarkTarget,
  expected: CuratedLoraBenchmarkTarget,
): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

/**
 * Resolves an exact candidate only. It never searches the internet, picks a
 * community LoRA, downloads weights, or falls back to a nearby adapter.
 */
export function resolveCuratedLoraSelection(input: {
  readonly request: CuratedLoraSelectionRequest;
  readonly localLoraRoot: string;
  readonly localAssets: readonly CuratedLoraLocalAsset[];
  readonly benchmarks: readonly CuratedLoraBenchmark[];
  readonly registry?: readonly CuratedLoraCandidate[];
}): CuratedLoraResolution {
  const candidateId = typeof input.request?.candidateId === "string" ? input.request.candidateId : "unknown";
  const blockers: string[] = [];
  let registry: readonly CuratedLoraCandidate[];
  try {
    registry = assertCuratedLoraRegistry(input.registry ?? OFFICIAL_LTX_LORA_CANDIDATES);
  } catch (error) {
    return {
      status: "blocked",
      candidateId,
      blockers: [error instanceof Error ? error.message : "curated LoRA registry is malformed"],
    };
  }
  const candidate = registry.find((entry) => entry.id === candidateId);
  if (!candidate) return { status: "blocked", candidateId, blockers: [`unknown curated LoRA candidate ${candidateId}`] };
  if (candidate.status !== "curation_ready") {
    blockers.push(`${candidate.id} is descriptor-only and has not completed curation admission`);
  }
  if (!Number.isFinite(input.request.strength) || input.request.strength < 0.15 || input.request.strength > 0.95) {
    blockers.push(`${candidate.id} strength must be within the benchmarked range [0.15, 0.95]`);
  }
  const targetProblem = candidateSupportsTarget(candidate, input.request.target);
  if (targetProblem) blockers.push(targetProblem);
  const runtimeProblem = candidateMatchesRuntime(candidate, input.request.runtime);
  if (runtimeProblem) blockers.push(runtimeProblem);

  let series: SeriesLoraContinuityBinding | undefined;
  if (input.request.series) {
    try {
      series = assertSeriesLoraContinuityBinding(input.request.series);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "series LoRA continuity binding is malformed");
    }
  }
  if (candidate.adapter.adapterClass === "standard_lora" && candidate.adapter.requiresSeriesContinuity && !series) {
    blockers.push(`${candidate.id} is a subject LoRA and requires a sealed series continuity binding`);
  }

  const assetResolution = matchingAsset(candidate, input.localAssets, input.localLoraRoot);
  blockers.push(...assetResolution.blockers);
  if (!assetResolution.asset) return { status: "blocked", candidateId, blockers: Object.freeze([...new Set(blockers)]) };
  const benchmarkResolution = matchingBenchmark(
    candidate,
    assetResolution.asset,
    input.request.runtime,
    input.request.target,
    input.benchmarks,
  );
  blockers.push(...benchmarkResolution.blockers);
  if (!benchmarkResolution.benchmark || blockers.length) {
    return { status: "blocked", candidateId, blockers: Object.freeze([...new Set(blockers)]) };
  }

  const unsigned: CuratedLoraResolvedSelectionCore = {
    version: CURATED_LORA_SELECTION_VERSION,
    candidateId: candidate.id,
    adapterClass: candidate.adapter.adapterClass,
    localPath: assetResolution.asset.localPath,
    adapterSha256: assetResolution.asset.sha256,
    strength: input.request.strength,
    runtime: input.request.runtime,
    target: input.request.target,
    benchmarkFingerprint: benchmarkResolution.benchmark.fingerprint,
    ...(series ? { seriesBindingFingerprint: series.fingerprint } : {}),
  };
  return {
    status: "eligible",
    selection: Object.freeze({ ...unsigned, fingerprint: selectionFingerprint(unsigned) }),
  };
}

assertCuratedLoraRegistry();
