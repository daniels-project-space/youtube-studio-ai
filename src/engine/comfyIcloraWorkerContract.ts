import {
  CURATED_LORA_SELECTION_VERSION,
  assertCuratedLoraCandidate,
  type CuratedLoraCandidate,
  type CuratedLoraResolvedSelection,
  type CuratedLoraRuntimePin,
  type ICLoraControl,
} from "@/engine/curatedLoraRegistry";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import {
  NarrativeShotControlContractSchema,
  type NarrativeShotControlContract,
  type NarrativeVisualStyle,
} from "@/engine/narrativeSeriesIntelligence";
import {
  VISUAL_TREATMENT_KEYS,
  planVisualTreatment,
  visualTreatmentDefinition,
  type VisualTreatmentKey,
  type VisualTreatmentPlan,
} from "@/engine/visualTreatmentCatalog";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Declarative, fail-closed contract for a future *dedicated* ComfyUI +
 * ComfyUI-LTXVideo IC-LoRA worker.  It is deliberately not a worker route:
 * this module never downloads weights, invokes ComfyUI, creates a provider
 * job, reserves funds, or reads reference bytes.
 *
 * The existing `infra/novita/worker.py` path uses `ltx_pipelines` and its
 * standard `--lora` flag.  That path is explicitly incompatible with this
 * contract.  An admitted work order is only an immutable pre-spend handoff
 * containing R2 locations, hashes, and receipt fingerprints.
 */
export const COMFY_IC_LORA_RUNTIME_PIN_VERSION = "comfyui-ltx-ic-lora-runtime-pin/v3" as const;
export const COMFY_IC_LORA_WORKFLOW_PIN_VERSION = "comfyui-ltx-ic-lora-workflow-pin/v1" as const;
export const COMFY_IC_LORA_LICENSE_ACCEPTANCE_VERSION = "comfyui-ltx-ic-lora-license-acceptance/v1" as const;
export const COMFY_IC_LORA_SHOT_BINDING_VERSION = "comfyui-ltx-ic-lora-shot-binding/v1" as const;
export const COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION = "comfyui-ltx-ic-lora-benchmark-evidence/v1" as const;
/** Official ComfyUI/LTX workflows require at least 32 GB VRAM. */
export const COMFY_IC_LORA_MINIMUM_VRAM_GB = 32 as const;
/**
 * IC-LoRA workflows are routed through a dedicated Novita RTX 5090 worker.
 * This is deliberately an exact SKU requirement, not a vague VRAM minimum:
 * a passing benchmark must describe the same hardware that a later work order
 * asks the provider to allocate.
 */
export const COMFY_IC_LORA_REQUIRED_PROVIDER = "novita" as const;
export const COMFY_IC_LORA_REQUIRED_GPU_SKU = "RTX 5090" as const;
export const COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION = "comfyui-ltx-ic-lora-dedicated-benchmark/v2" as const;
export const COMFY_IC_LORA_PRE_SPEND_RESERVATION_VERSION = "comfyui-ltx-ic-lora-pre-spend-reservation/v2" as const;
export const COMFY_IC_LORA_WORK_ORDER_VERSION = "comfyui-ltx-ic-lora-work-order/v2" as const;

const SHA256 = /^[a-f0-9]{64}$/iu;
const GIT_REVISION = /^[a-f0-9]{40}$/iu;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,159}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$/u;
const DIGEST_IMAGE = /@sha256:[a-f0-9]{64}$/iu;
const OFFICIAL_LTX_COMFY_WORKFLOW_REPOSITORY = "Lightricks/ComfyUI-LTXVideo";

const IC_LORA_CONTROLS = [
  "reference_sheet",
  "edge",
  "depth",
  "pose",
  "motion_track",
  "spatial_upscale",
  "hdr_video",
  "dialogue_video",
  "restoration_video",
  "composition_video",
  "color_reference_video",
] as const satisfies readonly ICLoraControl[];

const VISUAL_STYLE_FOR_TREATMENT: Readonly<Record<VisualTreatmentKey, NarrativeVisualStyle>> = Object.freeze({
  clay_stop_motion: "claymotion",
  brick_built_stop_motion: "brick_animation",
  anime_inspired_2d: "anime",
  drawn_illustrated_2d: "drawn",
});

/**
 * The future Studio worker may use only these official LTX 2.5 workflow
 * families as its IC-LoRA starting point.  Each work order still pins its
 * own reviewed graph bytes, but this prevents a control from being paired
 * with an arbitrary graph that happens to use the word "LoRA".
 *
 * These profiles are intentionally a quality/control vocabulary, not
 * downloaded workflows or a live worker allow-list.  The dedicated runtime,
 * model, local graph, guide artifacts, and treatment benchmark are all
 * independently sealed below before any reserved spend can be admitted.
 */
export const OFFICIAL_LTX_COMFY_IC_LORA_WORKFLOW_PROFILES = Object.freeze([
  Object.freeze({
    workflowId: "ltx-2.5-iclora-ingredients-single-stage-distilled",
    guideKinds: ["reference_sheet"] as const satisfies readonly ICLoraControl[],
    qualityRole: "cast-prop-and-location-consistency",
  }),
  Object.freeze({
    workflowId: "ltx-2.5-iclora-union-control-distilled",
    guideKinds: ["edge", "depth", "pose"] as const satisfies readonly ICLoraControl[],
    qualityRole: "composition-geometry-and-pose-control",
  }),
  Object.freeze({
    workflowId: "ltx-2.5-iclora-motion-track-distilled",
    guideKinds: ["motion_track"] as const satisfies readonly ICLoraControl[],
    qualityRole: "directed-subject-and-camera-motion",
  }),
  Object.freeze({
    workflowId: "ltx-2.5-iclora-inpaint-two-stage-distilled",
    guideKinds: ["composition_video"] as const satisfies readonly ICLoraControl[],
    qualityRole: "protected-region-repair",
  }),
  Object.freeze({
    workflowId: "ltx-2.5-iclora-outpaint-two-stage-distilled",
    guideKinds: ["composition_video"] as const satisfies readonly ICLoraControl[],
    qualityRole: "storyboard-approved-canvas-extension",
  }),
] as const);

export type OfficialLtxComfyIcloraWorkflowProfile = typeof OFFICIAL_LTX_COMFY_IC_LORA_WORKFLOW_PROFILES[number];

/**
 * A mirror of the currently deployed direct worker boundary, used only to
 * reject accidental reuse.  It is not a runnable configuration or a route.
 */
export const CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY = Object.freeze({
  workerPath: "infra/novita/worker.py",
  executionPath: "novita_direct_ltx_pipelines",
  loader: "ltx_pipelines",
  baseModelId: "Lightricks/LTX-2.5",
  baseModelVersion: "2.5",
  baseModelImmutableRevision: "ce298b1259d61ce6c87e05154b9ad339b16f32a0",
  runtimeRepository: "Lightricks/LTX-2",
  runtimeRevision: "fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca",
});

export interface ImmutableRuntimeSource {
  readonly repository: string;
  readonly immutableRevision: string;
}

export interface ComfyIcloraBaseModelPin {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly modelImmutableRevision: string;
  readonly modelSha256: string;
}

export interface ComfyIcloraRuntimePinCore {
  readonly version: typeof COMFY_IC_LORA_RUNTIME_PIN_VERSION;
  readonly executionPath: "dedicated_comfyui_ltx_ic_lora";
  readonly loader: "comfyui_ltx_ic_lora";
  /** This path is intentionally a dedicated Novita worker, not the CLI worker. */
  readonly provider: typeof COMFY_IC_LORA_REQUIRED_PROVIDER;
  /** Exact worker class to request from Novita for 32 GB IC-LoRA execution. */
  readonly requiredGpuSku: typeof COMFY_IC_LORA_REQUIRED_GPU_SKU;
  /** Digest-pinned container, separate from the direct Novita overlay. */
  readonly workerImage: string;
  readonly workerOverlaySha256: string;
  readonly runtimeBundleKey: string;
  readonly runtimeBundleSha256: string;
  readonly comfyUiSource: ImmutableRuntimeSource;
  readonly comfyLtxVideoSource: ImmutableRuntimeSource;
  readonly ltxRuntimeSource: ImmutableRuntimeSource;
  readonly baseModel: ComfyIcloraBaseModelPin;
  /** Minimum supported by the pinned official ComfyUI/LTX workflow. */
  readonly minimumVramGb: typeof COMFY_IC_LORA_MINIMUM_VRAM_GB;
}

export interface ComfyIcloraRuntimePin extends ComfyIcloraRuntimePinCore {
  readonly fingerprint: string;
}

export interface ComfyIcloraWorkflowPinCore {
  readonly version: typeof COMFY_IC_LORA_WORKFLOW_PIN_VERSION;
  readonly workflowId: string;
  /** Immutable upstream repository/revision which owns the workflow blob. */
  readonly workflowSource: ImmutableRuntimeSource;
  readonly workflowBlobPath: string;
  readonly workflowBlobSha256: string;
  /** Hash of the normalized ComfyUI API graph after local wiring. */
  readonly workflowGraphSha256: string;
  readonly runtimeFingerprint: string;
  readonly requiredGuideKinds: readonly ICLoraControl[];
  readonly supportedTreatments: readonly VisualTreatmentKey[];
  readonly supportedFamilies: readonly FamilyKey[];
}

export interface ComfyIcloraWorkflowPin extends ComfyIcloraWorkflowPinCore {
  readonly fingerprint: string;
}

/**
 * This reference contains metadata only. `r2Key` must resolve through a
 * short-lived worker capability later; no bytes or data URL enter snapshots.
 */
export interface ComfyIcloraGuideArtifact {
  readonly kind: ICLoraControl;
  readonly r2Key: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly artifactReceiptFingerprint: string;
  readonly shotId: string;
  readonly shotControlFingerprint: string;
}

export interface ComfyIcloraLicenseAcceptanceCore {
  readonly version: typeof COMFY_IC_LORA_LICENSE_ACCEPTANCE_VERSION;
  readonly candidateId: string;
  readonly licenseId: "ltx-2-community-license";
  readonly termsUrl: string;
  readonly sourceImmutableRevision: string;
  readonly sourceSha256: string;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
  readonly acceptanceReceiptFingerprint: string;
}

export interface ComfyIcloraLicenseAcceptance extends ComfyIcloraLicenseAcceptanceCore {
  readonly fingerprint: string;
}

export interface ComfyIcloraShotBindingCore {
  readonly version: typeof COMFY_IC_LORA_SHOT_BINDING_VERSION;
  readonly family: FamilyKey;
  readonly treatmentKey: VisualTreatmentKey;
  readonly treatmentPlanFingerprint: string;
  readonly shotControlFingerprint: string;
  readonly shotId: string;
  readonly visualStyle: NarrativeVisualStyle;
}

export interface ComfyIcloraShotBinding extends ComfyIcloraShotBindingCore {
  readonly fingerprint: string;
}

/**
 * A content-addressed benchmark output. It records only durable R2 metadata
 * and review receipts—not media bytes or a prompt. Each treatment criterion
 * must have a passing, retained-frame witness before an IC-LoRA can become
 * eligible for future reserved spend.
 */
export interface ComfyIcloraBenchmarkEvidenceCore {
  readonly version: typeof COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION;
  readonly treatmentKey: VisualTreatmentKey;
  readonly treatmentPlanFingerprint: string;
  readonly controlKind: ICLoraControl;
  readonly evidenceManifestKey: string;
  readonly immutableEvidenceObjectVersionId: string;
  readonly evidenceSha256: string;
  readonly guideArtifact: ComfyIcloraGuideArtifact;
  readonly outputVideo: {
    readonly r2Key: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly durationMs: number;
    readonly artifactReceiptFingerprint: string;
  };
  /** Receipt for a review of exactly `outputVideo.sha256`. */
  readonly visualReviewReceiptFingerprint: string;
  readonly reviewedVideoSha256: string;
  readonly criterionEvidence: readonly {
    readonly id: string;
    readonly scope: "global" | "frame";
    readonly verdict: "pass";
    /** Durable retained-review-frame artifact IDs, never pixels. */
    readonly reviewFrameArtifactIds: readonly string[];
  }[];
}

export interface ComfyIcloraBenchmarkEvidence extends ComfyIcloraBenchmarkEvidenceCore {
  readonly fingerprint: string;
}

export interface ComfyIcloraDedicatedBenchmarkCore {
  readonly version: typeof COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION;
  readonly benchmarkId: string;
  readonly runtimeFingerprint: string;
  readonly workflowFingerprint: string;
  readonly candidateId: string;
  readonly candidateSourceImmutableRevision: string;
  readonly candidateSourceSha256: string;
  readonly adapterSha256: string;
  /** Bridges the dedicated benchmark to the existing curated-LoRA evidence. */
  readonly curatedSelectionBenchmarkFingerprint: string;
  readonly family: FamilyKey;
  readonly treatmentKey: VisualTreatmentKey;
  /** Exact catalog treatment plan that the benchmark had to satisfy. */
  readonly treatmentPlanFingerprint: string;
  /** Every treatment-specific final-master review criterion exercised by the benchmark. */
  readonly requiredTreatmentCriterionIds: readonly string[];
  readonly controlKind: ICLoraControl;
  readonly gpuSku: string;
  readonly vramGb: number;
  readonly terminalStatus: "complete";
  readonly visualVerdict: "pass";
  /** Fully structured durable guide, output, and review-criterion evidence. */
  readonly evidence: ComfyIcloraBenchmarkEvidence;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
}

export interface ComfyIcloraDedicatedBenchmark extends ComfyIcloraDedicatedBenchmarkCore {
  readonly fingerprint: string;
}

export interface ComfyIcloraPreSpendReservationCore {
  readonly version: typeof COMFY_IC_LORA_PRE_SPEND_RESERVATION_VERSION;
  readonly reservationId: string;
  /** Ties an external, already-held reservation to this exact immutable handoff. */
  readonly spendIntentFingerprint: string;
  readonly budgetLedgerFingerprint: string;
  readonly reservationReceiptFingerprint: string;
  readonly spendCapCents: number;
  readonly reservedCents: number;
  readonly status: "reserved";
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export interface ComfyIcloraPreSpendReservation extends ComfyIcloraPreSpendReservationCore {
  readonly fingerprint: string;
}

export interface ComfyIcloraWorkOrderCore {
  readonly version: typeof COMFY_IC_LORA_WORK_ORDER_VERSION;
  readonly spendIntentFingerprint: string;
  readonly runtimeFingerprint: string;
  readonly provider: typeof COMFY_IC_LORA_REQUIRED_PROVIDER;
  readonly requiredGpuSku: typeof COMFY_IC_LORA_REQUIRED_GPU_SKU;
  /** The dedicated worker must attest this floor before it loads any IC-LoRA. */
  readonly minimumVramGb: typeof COMFY_IC_LORA_MINIMUM_VRAM_GB;
  readonly workflowFingerprint: string;
  readonly candidateId: string;
  readonly selectionFingerprint: string;
  readonly adapterSha256: string;
  readonly licenseAcceptanceFingerprint: string;
  readonly shotBindingFingerprint: string;
  /** Metadata only: object key, digest, size, receipt, and no raw bytes. */
  readonly guideArtifacts: readonly ComfyIcloraGuideArtifact[];
  readonly benchmarkFingerprint: string;
  readonly preSpendReservationFingerprint: string;
}

export interface ComfyIcloraWorkOrder extends ComfyIcloraWorkOrderCore {
  readonly fingerprint: string;
}

export type ComfyIcloraPreSpendAdmission =
  | { readonly status: "blocked"; readonly blockers: readonly string[] }
  | { readonly status: "eligible_for_reserved_spend"; readonly workOrder: ComfyIcloraWorkOrder };

function asRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
  const expected = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !expected.has(key));
  if (extras.length > 0) throw new Error(`${label} has unrecognized fields: ${extras.sort().join(", ")}`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(", ")}`);
}

function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!SAFE_ID.test(result)) throw new Error(`${label} must be a safe stable identifier`);
  return result;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64).toLowerCase();
  if (!SHA256.test(result)) throw new Error(`${label} must be a SHA-256`);
  return result;
}

function revision(value: unknown, label: string): string {
  const result = text(value, label, 40).toLowerCase();
  if (!GIT_REVISION.test(result)) throw new Error(`${label} must be an immutable Git revision`);
  return result;
}

function utc(value: unknown, label: string): string {
  const result = text(value, label, 40);
  if (!ISO_UTC.test(result)) throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  return result;
}

function storageKey(value: unknown, label: string): string {
  const result = text(value, label, 512);
  if (!SAFE_PATH.test(result)) throw new Error(`${label} must be a normalized storage key`);
  return result;
}

function localModelPath(value: unknown, label: string): string {
  const result = text(value, label, 512);
  if (!/^\/(?:[A-Za-z0-9][A-Za-z0-9._@+=:-]*\/)*[A-Za-z0-9][A-Za-z0-9._@+=:-]*$/u.test(result)) {
    throw new Error(`${label} must be an absolute normalized local model path`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function assertImmutableSource(value: unknown, label: string): ImmutableRuntimeSource {
  const raw = asRecord(value, label);
  assertExactKeys(raw, ["repository", "immutableRevision"], label);
  const repository = text(raw.repository, `${label}.repository`, 320);
  if (/\s/u.test(repository)) throw new Error(`${label}.repository may not contain whitespace`);
  return Object.freeze({ repository, immutableRevision: revision(raw.immutableRevision, `${label}.immutableRevision`) });
}

function runtimeCore(value: unknown): ComfyIcloraRuntimePinCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA runtime pin");
  if (raw.executionPath === CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.executionPath
    || raw.loader === CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.loader) {
    throw new Error("dedicated ComfyUI IC-LoRA runtime rejects the existing direct Novita ltx_pipelines worker");
  }
  assertExactKeys(raw, [
    "version", "executionPath", "loader", "provider", "requiredGpuSku", "workerImage", "workerOverlaySha256", "runtimeBundleKey", "runtimeBundleSha256",
    "comfyUiSource", "comfyLtxVideoSource", "ltxRuntimeSource", "baseModel", "minimumVramGb",
  ], "ComfyUI IC-LoRA runtime pin");
  if (raw.version !== COMFY_IC_LORA_RUNTIME_PIN_VERSION) throw new Error("ComfyUI IC-LoRA runtime pin version is unsupported");
  if (raw.executionPath !== "dedicated_comfyui_ltx_ic_lora") {
    throw new Error("ComfyUI IC-LoRA runtime must use the dedicated_comfyui_ltx_ic_lora execution path");
  }
  if (raw.loader !== "comfyui_ltx_ic_lora") throw new Error("ComfyUI IC-LoRA runtime must use the ComfyUI IC-LoRA loader");
  if (raw.provider !== COMFY_IC_LORA_REQUIRED_PROVIDER) {
    throw new Error(`ComfyUI IC-LoRA runtime must use the dedicated ${COMFY_IC_LORA_REQUIRED_PROVIDER} provider path`);
  }
  if (raw.requiredGpuSku !== COMFY_IC_LORA_REQUIRED_GPU_SKU) {
    throw new Error(`ComfyUI IC-LoRA runtime must request ${COMFY_IC_LORA_REQUIRED_GPU_SKU} workers`);
  }
  if (raw.minimumVramGb !== COMFY_IC_LORA_MINIMUM_VRAM_GB) {
    throw new Error(`ComfyUI IC-LoRA runtime must require the official ${COMFY_IC_LORA_MINIMUM_VRAM_GB} GB VRAM floor`);
  }
  const workerImage = text(raw.workerImage, "ComfyUI IC-LoRA runtime pin.workerImage", 512);
  if (!DIGEST_IMAGE.test(workerImage)) throw new Error("ComfyUI IC-LoRA runtime pin.workerImage must be digest-pinned");
  const base = asRecord(raw.baseModel, "ComfyUI IC-LoRA runtime pin.baseModel");
  assertExactKeys(base, ["modelId", "modelVersion", "modelImmutableRevision", "modelSha256"], "ComfyUI IC-LoRA runtime pin.baseModel");
  return Object.freeze({
    version: COMFY_IC_LORA_RUNTIME_PIN_VERSION,
    executionPath: "dedicated_comfyui_ltx_ic_lora",
    loader: "comfyui_ltx_ic_lora",
    provider: COMFY_IC_LORA_REQUIRED_PROVIDER,
    requiredGpuSku: COMFY_IC_LORA_REQUIRED_GPU_SKU,
    workerImage,
    workerOverlaySha256: hash(raw.workerOverlaySha256, "ComfyUI IC-LoRA runtime pin.workerOverlaySha256"),
    runtimeBundleKey: storageKey(raw.runtimeBundleKey, "ComfyUI IC-LoRA runtime pin.runtimeBundleKey"),
    runtimeBundleSha256: hash(raw.runtimeBundleSha256, "ComfyUI IC-LoRA runtime pin.runtimeBundleSha256"),
    comfyUiSource: assertImmutableSource(raw.comfyUiSource, "ComfyUI IC-LoRA runtime pin.comfyUiSource"),
    comfyLtxVideoSource: assertImmutableSource(raw.comfyLtxVideoSource, "ComfyUI IC-LoRA runtime pin.comfyLtxVideoSource"),
    ltxRuntimeSource: assertImmutableSource(raw.ltxRuntimeSource, "ComfyUI IC-LoRA runtime pin.ltxRuntimeSource"),
    baseModel: Object.freeze({
      modelId: text(base.modelId, "ComfyUI IC-LoRA runtime pin.baseModel.modelId", 320),
      modelVersion: text(base.modelVersion, "ComfyUI IC-LoRA runtime pin.baseModel.modelVersion", 80),
      modelImmutableRevision: revision(base.modelImmutableRevision, "ComfyUI IC-LoRA runtime pin.baseModel.modelImmutableRevision"),
      modelSha256: hash(base.modelSha256, "ComfyUI IC-LoRA runtime pin.baseModel.modelSha256"),
    }),
    minimumVramGb: COMFY_IC_LORA_MINIMUM_VRAM_GB,
  });
}

export function comfyIcloraRuntimeFingerprint(core: ComfyIcloraRuntimePinCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraRuntimePin(value: unknown): ComfyIcloraRuntimePin {
  const core = runtimeCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraRuntimeFingerprint(core) });
}

export function assertComfyIcloraRuntimePin(value: unknown): ComfyIcloraRuntimePin {
  const raw = asRecord(value, "ComfyUI IC-LoRA runtime pin");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = runtimeCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA runtime pin.fingerprint");
  if (fingerprint !== comfyIcloraRuntimeFingerprint(core)) throw new Error("ComfyUI IC-LoRA runtime pin fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function treatment(value: unknown, label: string): VisualTreatmentKey {
  if (typeof value !== "string" || !(VISUAL_TREATMENT_KEYS as readonly string[]).includes(value)) {
    throw new Error(`${label} must be a supported visual treatment`);
  }
  return value as VisualTreatmentKey;
}

function family(value: unknown, label: string): FamilyKey {
  if (typeof value !== "string" || !(FAMILY_KEYS as readonly string[]).includes(value)) {
    throw new Error(`${label} must be a known family`);
  }
  return value as FamilyKey;
}

function controlKind(value: unknown, label: string): ICLoraControl {
  if (typeof value !== "string" || !(IC_LORA_CONTROLS as readonly string[]).includes(value)) {
    throw new Error(`${label} must be an IC-LoRA guide kind`);
  }
  return value as ICLoraControl;
}

function uniqueValues<T extends string>(values: readonly T[], label: string): readonly T[] {
  if (values.length === 0) throw new Error(`${label} may not be empty`);
  if (new Set(values).size !== values.length) throw new Error(`${label} may not contain duplicates`);
  return Object.freeze([...values]);
}

function workflowCore(value: unknown): ComfyIcloraWorkflowPinCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA workflow pin");
  assertExactKeys(raw, [
    "version", "workflowId", "workflowSource", "workflowBlobPath", "workflowBlobSha256", "workflowGraphSha256", "runtimeFingerprint",
    "requiredGuideKinds", "supportedTreatments", "supportedFamilies",
  ], "ComfyUI IC-LoRA workflow pin");
  if (raw.version !== COMFY_IC_LORA_WORKFLOW_PIN_VERSION) throw new Error("ComfyUI IC-LoRA workflow pin version is unsupported");
  if (!Array.isArray(raw.requiredGuideKinds) || !Array.isArray(raw.supportedTreatments) || !Array.isArray(raw.supportedFamilies)) {
    throw new Error("ComfyUI IC-LoRA workflow pin lists must be arrays");
  }
  return Object.freeze({
    version: COMFY_IC_LORA_WORKFLOW_PIN_VERSION,
    workflowId: identifier(raw.workflowId, "ComfyUI IC-LoRA workflow pin.workflowId"),
    workflowSource: assertImmutableSource(raw.workflowSource, "ComfyUI IC-LoRA workflow pin.workflowSource"),
    workflowBlobPath: storageKey(raw.workflowBlobPath, "ComfyUI IC-LoRA workflow pin.workflowBlobPath"),
    workflowBlobSha256: hash(raw.workflowBlobSha256, "ComfyUI IC-LoRA workflow pin.workflowBlobSha256"),
    workflowGraphSha256: hash(raw.workflowGraphSha256, "ComfyUI IC-LoRA workflow pin.workflowGraphSha256"),
    runtimeFingerprint: hash(raw.runtimeFingerprint, "ComfyUI IC-LoRA workflow pin.runtimeFingerprint"),
    requiredGuideKinds: uniqueValues(raw.requiredGuideKinds.map((entry) => controlKind(entry, "ComfyUI IC-LoRA workflow pin.requiredGuideKinds")), "ComfyUI IC-LoRA workflow pin.requiredGuideKinds"),
    supportedTreatments: uniqueValues(raw.supportedTreatments.map((entry) => treatment(entry, "ComfyUI IC-LoRA workflow pin.supportedTreatments")), "ComfyUI IC-LoRA workflow pin.supportedTreatments"),
    supportedFamilies: uniqueValues(raw.supportedFamilies.map((entry) => family(entry, "ComfyUI IC-LoRA workflow pin.supportedFamilies")), "ComfyUI IC-LoRA workflow pin.supportedFamilies"),
  });
}

export function comfyIcloraWorkflowFingerprint(core: ComfyIcloraWorkflowPinCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraWorkflowPin(value: unknown): ComfyIcloraWorkflowPin {
  const core = workflowCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraWorkflowFingerprint(core) });
}

export function assertComfyIcloraWorkflowPin(value: unknown): ComfyIcloraWorkflowPin {
  const raw = asRecord(value, "ComfyUI IC-LoRA workflow pin");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = workflowCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA workflow pin.fingerprint");
  if (fingerprint !== comfyIcloraWorkflowFingerprint(core)) throw new Error("ComfyUI IC-LoRA workflow pin fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function guideMediaTypeIsValid(kind: ICLoraControl, mediaType: string): boolean {
  return kind === "motion_track"
    || kind === "spatial_upscale"
    || kind === "hdr_video"
    || kind === "dialogue_video"
    || kind === "restoration_video"
    || kind === "composition_video"
    || kind === "color_reference_video"
    || kind === "light_direction_video"
    || kind === "daylight_reference_video"
    || kind === "water_reference_video"
    || kind === "clean_plate_reference_video"
    ? /^video\/(?:mp4|quicktime)$/iu.test(mediaType)
    : /^image\/(?:png|jpeg|webp)$/iu.test(mediaType);
}

export function assertComfyIcloraGuideArtifact(value: unknown): ComfyIcloraGuideArtifact {
  const raw = asRecord(value, "ComfyUI IC-LoRA guide artifact");
  assertExactKeys(raw, ["kind", "r2Key", "sha256", "byteLength", "mediaType", "artifactReceiptFingerprint", "shotId", "shotControlFingerprint"], "ComfyUI IC-LoRA guide artifact");
  const kind = controlKind(raw.kind, "ComfyUI IC-LoRA guide artifact.kind");
  const mediaType = text(raw.mediaType, "ComfyUI IC-LoRA guide artifact.mediaType", 80).toLowerCase();
  if (!guideMediaTypeIsValid(kind, mediaType)) {
    throw new Error(`ComfyUI IC-LoRA guide artifact ${kind} has an incompatible media type`);
  }
  return Object.freeze({
    kind,
    r2Key: storageKey(raw.r2Key, "ComfyUI IC-LoRA guide artifact.r2Key"),
    sha256: hash(raw.sha256, "ComfyUI IC-LoRA guide artifact.sha256"),
    byteLength: positiveInteger(raw.byteLength, "ComfyUI IC-LoRA guide artifact.byteLength"),
    mediaType,
    artifactReceiptFingerprint: hash(raw.artifactReceiptFingerprint, "ComfyUI IC-LoRA guide artifact.artifactReceiptFingerprint"),
    shotId: identifier(raw.shotId, "ComfyUI IC-LoRA guide artifact.shotId"),
    shotControlFingerprint: hash(raw.shotControlFingerprint, "ComfyUI IC-LoRA guide artifact.shotControlFingerprint"),
  });
}

export function comfyIcloraGuideArtifactFingerprint(value: ComfyIcloraGuideArtifact): string {
  return sha256Hex(canonicalJson(assertComfyIcloraGuideArtifact(value)));
}

function licenseCore(value: unknown): ComfyIcloraLicenseAcceptanceCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA license acceptance");
  assertExactKeys(raw, [
    "version", "candidateId", "licenseId", "termsUrl", "sourceImmutableRevision", "sourceSha256", "acceptedBy", "acceptedAt", "acceptanceReceiptFingerprint",
  ], "ComfyUI IC-LoRA license acceptance");
  if (raw.version !== COMFY_IC_LORA_LICENSE_ACCEPTANCE_VERSION) throw new Error("ComfyUI IC-LoRA license acceptance version is unsupported");
  if (raw.licenseId !== "ltx-2-community-license") throw new Error("ComfyUI IC-LoRA license acceptance must record the LTX community license");
  const termsUrl = text(raw.termsUrl, "ComfyUI IC-LoRA license acceptance.termsUrl", 512);
  if (!/^https:\/\//u.test(termsUrl)) throw new Error("ComfyUI IC-LoRA license acceptance.termsUrl must be HTTPS");
  return Object.freeze({
    version: COMFY_IC_LORA_LICENSE_ACCEPTANCE_VERSION,
    candidateId: identifier(raw.candidateId, "ComfyUI IC-LoRA license acceptance.candidateId"),
    licenseId: "ltx-2-community-license",
    termsUrl,
    sourceImmutableRevision: revision(raw.sourceImmutableRevision, "ComfyUI IC-LoRA license acceptance.sourceImmutableRevision"),
    sourceSha256: hash(raw.sourceSha256, "ComfyUI IC-LoRA license acceptance.sourceSha256"),
    acceptedBy: identifier(raw.acceptedBy, "ComfyUI IC-LoRA license acceptance.acceptedBy"),
    acceptedAt: utc(raw.acceptedAt, "ComfyUI IC-LoRA license acceptance.acceptedAt"),
    acceptanceReceiptFingerprint: hash(raw.acceptanceReceiptFingerprint, "ComfyUI IC-LoRA license acceptance.acceptanceReceiptFingerprint"),
  });
}

export function comfyIcloraLicenseAcceptanceFingerprint(core: ComfyIcloraLicenseAcceptanceCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraLicenseAcceptance(value: unknown): ComfyIcloraLicenseAcceptance {
  const core = licenseCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraLicenseAcceptanceFingerprint(core) });
}

export function assertComfyIcloraLicenseAcceptance(value: unknown): ComfyIcloraLicenseAcceptance {
  const raw = asRecord(value, "ComfyUI IC-LoRA license acceptance");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = licenseCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA license acceptance.fingerprint");
  if (fingerprint !== comfyIcloraLicenseAcceptanceFingerprint(core)) throw new Error("ComfyUI IC-LoRA license acceptance fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function narrativeStyleForTreatment(treatmentKey: VisualTreatmentKey): NarrativeVisualStyle {
  return VISUAL_STYLE_FOR_TREATMENT[treatmentKey];
}

export function comfyIcloraShotBindingFingerprint(core: ComfyIcloraShotBindingCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraShotBinding(value: {
  readonly family: FamilyKey;
  readonly treatmentPlan: VisualTreatmentPlan;
  readonly shotControl: unknown;
  readonly shotId: string;
}): ComfyIcloraShotBinding {
  const selectedFamily = family(value.family, "ComfyUI IC-LoRA shot binding.family");
  const treatmentKey = treatment(value.treatmentPlan?.treatmentKey, "ComfyUI IC-LoRA shot binding.treatmentPlan.treatmentKey");
  const expectedTreatmentPlan = planVisualTreatment(treatmentKey);
  if (canonicalJson(value.treatmentPlan) !== canonicalJson(expectedTreatmentPlan)) {
    throw new Error("ComfyUI IC-LoRA shot binding requires the exact sealed visual treatment plan");
  }
  const definition = visualTreatmentDefinition(treatmentKey);
  if (!definition.channelType.supportedFamilies.includes(selectedFamily)) {
    throw new Error(`${treatmentKey} is not declared for ${selectedFamily}`);
  }
  const shotControl = NarrativeShotControlContractSchema.parse(value.shotControl);
  const shotId = identifier(value.shotId, "ComfyUI IC-LoRA shot binding.shotId");
  if (!shotControl.shots.some((shot) => shot.shotId === shotId)) {
    throw new Error(`ComfyUI IC-LoRA shot binding cannot find ${shotId} in the sealed narrative shot contract`);
  }
  const visualStyle = narrativeStyleForTreatment(treatmentKey);
  if (shotControl.visualStyle !== visualStyle) {
    throw new Error(`ComfyUI IC-LoRA shot binding treatment ${treatmentKey} does not match narrative style ${shotControl.visualStyle}`);
  }
  const core: ComfyIcloraShotBindingCore = {
    version: COMFY_IC_LORA_SHOT_BINDING_VERSION,
    family: selectedFamily,
    treatmentKey,
    treatmentPlanFingerprint: expectedTreatmentPlan.fingerprint,
    shotControlFingerprint: shotControl.fingerprint,
    shotId,
    visualStyle,
  };
  return Object.freeze({ ...core, fingerprint: comfyIcloraShotBindingFingerprint(core) });
}

export function assertComfyIcloraShotBinding(value: unknown): ComfyIcloraShotBinding {
  const raw = asRecord(value, "ComfyUI IC-LoRA shot binding");
  assertExactKeys(raw, ["version", "family", "treatmentKey", "treatmentPlanFingerprint", "shotControlFingerprint", "shotId", "visualStyle", "fingerprint"], "ComfyUI IC-LoRA shot binding");
  if (raw.version !== COMFY_IC_LORA_SHOT_BINDING_VERSION) throw new Error("ComfyUI IC-LoRA shot binding version is unsupported");
  const treatmentKey = treatment(raw.treatmentKey, "ComfyUI IC-LoRA shot binding.treatmentKey");
  const visualStyle = raw.visualStyle;
  if (visualStyle !== narrativeStyleForTreatment(treatmentKey)) {
    throw new Error("ComfyUI IC-LoRA shot binding visual style does not match its treatment");
  }
  const core: ComfyIcloraShotBindingCore = {
    version: COMFY_IC_LORA_SHOT_BINDING_VERSION,
    family: family(raw.family, "ComfyUI IC-LoRA shot binding.family"),
    treatmentKey,
    treatmentPlanFingerprint: hash(raw.treatmentPlanFingerprint, "ComfyUI IC-LoRA shot binding.treatmentPlanFingerprint"),
    shotControlFingerprint: hash(raw.shotControlFingerprint, "ComfyUI IC-LoRA shot binding.shotControlFingerprint"),
    shotId: identifier(raw.shotId, "ComfyUI IC-LoRA shot binding.shotId"),
    visualStyle: visualStyle as NarrativeVisualStyle,
  };
  const fingerprint = hash(raw.fingerprint, "ComfyUI IC-LoRA shot binding.fingerprint");
  if (fingerprint !== comfyIcloraShotBindingFingerprint(core)) throw new Error("ComfyUI IC-LoRA shot binding fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function benchmarkEvidenceOutputVideo(value: unknown): ComfyIcloraBenchmarkEvidenceCore["outputVideo"] {
  const raw = asRecord(value, "ComfyUI IC-LoRA benchmark output video");
  assertExactKeys(raw, ["r2Key", "sha256", "byteLength", "durationMs", "artifactReceiptFingerprint"], "ComfyUI IC-LoRA benchmark output video");
  return Object.freeze({
    r2Key: storageKey(raw.r2Key, "ComfyUI IC-LoRA benchmark output video.r2Key"),
    sha256: hash(raw.sha256, "ComfyUI IC-LoRA benchmark output video.sha256"),
    byteLength: positiveInteger(raw.byteLength, "ComfyUI IC-LoRA benchmark output video.byteLength"),
    durationMs: positiveInteger(raw.durationMs, "ComfyUI IC-LoRA benchmark output video.durationMs", 3_600_000),
    artifactReceiptFingerprint: hash(raw.artifactReceiptFingerprint, "ComfyUI IC-LoRA benchmark output video.artifactReceiptFingerprint"),
  });
}

function benchmarkCriterionEvidence(
  value: unknown,
  expected: ReadonlyMap<string, "global" | "frame">,
): ComfyIcloraBenchmarkEvidenceCore["criterionEvidence"][number] {
  const raw = asRecord(value, "ComfyUI IC-LoRA benchmark criterion evidence");
  assertExactKeys(raw, ["id", "scope", "verdict", "reviewFrameArtifactIds"], "ComfyUI IC-LoRA benchmark criterion evidence");
  const id = text(raw.id, "ComfyUI IC-LoRA benchmark criterion evidence.id", 240);
  const scope = raw.scope === "global" || raw.scope === "frame" ? raw.scope : undefined;
  if (!scope || expected.get(id) !== scope) {
    throw new Error("ComfyUI IC-LoRA benchmark criterion evidence does not match the canonical treatment rubric");
  }
  if (raw.verdict !== "pass") throw new Error("ComfyUI IC-LoRA benchmark criterion evidence must pass");
  if (!Array.isArray(raw.reviewFrameArtifactIds) || raw.reviewFrameArtifactIds.length === 0) {
    throw new Error("ComfyUI IC-LoRA benchmark criterion evidence requires retained review-frame artifacts");
  }
  const reviewFrameArtifactIds = [...new Set(raw.reviewFrameArtifactIds.map((idValue) => identifier(idValue, "ComfyUI IC-LoRA benchmark criterion evidence.reviewFrameArtifactIds")))].sort();
  if (reviewFrameArtifactIds.length !== raw.reviewFrameArtifactIds.length) {
    throw new Error("ComfyUI IC-LoRA benchmark criterion evidence may not duplicate review-frame artifacts");
  }
  return Object.freeze({ id, scope, verdict: "pass", reviewFrameArtifactIds: Object.freeze(reviewFrameArtifactIds) });
}

function benchmarkEvidenceCore(value: unknown): ComfyIcloraBenchmarkEvidenceCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA benchmark evidence");
  assertExactKeys(raw, [
    "version", "treatmentKey", "treatmentPlanFingerprint", "controlKind", "evidenceManifestKey", "immutableEvidenceObjectVersionId", "evidenceSha256",
    "guideArtifact", "outputVideo", "visualReviewReceiptFingerprint", "reviewedVideoSha256", "criterionEvidence",
  ], "ComfyUI IC-LoRA benchmark evidence");
  if (raw.version !== COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION) throw new Error("ComfyUI IC-LoRA benchmark evidence version is unsupported");
  const treatmentKey = treatment(raw.treatmentKey, "ComfyUI IC-LoRA benchmark evidence.treatmentKey");
  const treatmentPlan = planVisualTreatment(treatmentKey);
  if (raw.treatmentPlanFingerprint !== treatmentPlan.fingerprint) {
    throw new Error("ComfyUI IC-LoRA benchmark evidence does not bind the current canonical treatment QA plan");
  }
  const control = controlKind(raw.controlKind, "ComfyUI IC-LoRA benchmark evidence.controlKind");
  const guideArtifact = assertComfyIcloraGuideArtifact(raw.guideArtifact);
  if (guideArtifact.kind !== control) throw new Error("ComfyUI IC-LoRA benchmark evidence guide does not match its declared control");
  const outputVideo = benchmarkEvidenceOutputVideo(raw.outputVideo);
  const reviewedVideoSha256 = hash(raw.reviewedVideoSha256, "ComfyUI IC-LoRA benchmark evidence.reviewedVideoSha256");
  if (reviewedVideoSha256 !== outputVideo.sha256) {
    throw new Error("ComfyUI IC-LoRA benchmark review does not bind the retained benchmark video bytes");
  }
  const expectedCriteria = new Map(treatmentPlan.qaBenchmarks.map((benchmark) => [
    `visual-treatment/${treatmentKey}/${benchmark.id}`,
    benchmark.scope,
  ] as const));
  if (!Array.isArray(raw.criterionEvidence)) throw new Error("ComfyUI IC-LoRA benchmark evidence criterion evidence must be an array");
  const criterionEvidence = raw.criterionEvidence
    .map((criterion) => benchmarkCriterionEvidence(criterion, expectedCriteria))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    criterionEvidence.length !== expectedCriteria.size
    || new Set(criterionEvidence.map((criterion) => criterion.id)).size !== criterionEvidence.length
    || criterionEvidence.some((criterion, index) => criterion.id !== [...expectedCriteria.keys()].sort()[index])
  ) {
    throw new Error("ComfyUI IC-LoRA benchmark evidence must retain passing witnesses for every treatment criterion");
  }
  return Object.freeze({
    version: COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION,
    treatmentKey,
    treatmentPlanFingerprint: treatmentPlan.fingerprint,
    controlKind: control,
    evidenceManifestKey: storageKey(raw.evidenceManifestKey, "ComfyUI IC-LoRA benchmark evidence.evidenceManifestKey"),
    immutableEvidenceObjectVersionId: identifier(raw.immutableEvidenceObjectVersionId, "ComfyUI IC-LoRA benchmark evidence.immutableEvidenceObjectVersionId"),
    evidenceSha256: hash(raw.evidenceSha256, "ComfyUI IC-LoRA benchmark evidence.evidenceSha256"),
    guideArtifact,
    outputVideo,
    visualReviewReceiptFingerprint: hash(raw.visualReviewReceiptFingerprint, "ComfyUI IC-LoRA benchmark evidence.visualReviewReceiptFingerprint"),
    reviewedVideoSha256,
    criterionEvidence: Object.freeze(criterionEvidence),
  });
}

export function comfyIcloraBenchmarkEvidenceFingerprint(core: ComfyIcloraBenchmarkEvidenceCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraBenchmarkEvidence(value: unknown): ComfyIcloraBenchmarkEvidence {
  const core = benchmarkEvidenceCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraBenchmarkEvidenceFingerprint(core) });
}

export function assertComfyIcloraBenchmarkEvidence(value: unknown): ComfyIcloraBenchmarkEvidence {
  const raw = asRecord(value, "ComfyUI IC-LoRA benchmark evidence");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = benchmarkEvidenceCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA benchmark evidence.fingerprint");
  if (fingerprint !== comfyIcloraBenchmarkEvidenceFingerprint(core)) throw new Error("ComfyUI IC-LoRA benchmark evidence fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function benchmarkCore(value: unknown): ComfyIcloraDedicatedBenchmarkCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA dedicated benchmark");
  assertExactKeys(raw, [
    "version", "benchmarkId", "runtimeFingerprint", "workflowFingerprint", "candidateId", "candidateSourceImmutableRevision", "candidateSourceSha256", "adapterSha256", "curatedSelectionBenchmarkFingerprint",
    "family", "treatmentKey", "treatmentPlanFingerprint", "requiredTreatmentCriterionIds", "controlKind", "gpuSku", "vramGb", "terminalStatus", "visualVerdict", "evidence", "reviewedAt", "reviewedBy",
  ], "ComfyUI IC-LoRA dedicated benchmark");
  if (raw.version !== COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION) throw new Error("ComfyUI IC-LoRA dedicated benchmark version is unsupported");
  const gpuSku = text(raw.gpuSku, "ComfyUI IC-LoRA dedicated benchmark.gpuSku", 100);
  if (gpuSku !== COMFY_IC_LORA_REQUIRED_GPU_SKU) {
    throw new Error(
      `ComfyUI IC-LoRA benchmark must be measured on the required ${COMFY_IC_LORA_REQUIRED_GPU_SKU} Novita worker`,
    );
  }
  const vramGb = positiveInteger(raw.vramGb, "ComfyUI IC-LoRA dedicated benchmark.vramGb", 512);
  if (vramGb < COMFY_IC_LORA_MINIMUM_VRAM_GB) {
    throw new Error(`ComfyUI IC-LoRA benchmark requires at least ${COMFY_IC_LORA_MINIMUM_VRAM_GB} GB VRAM under the official workflow contract`);
  }
  if (raw.terminalStatus !== "complete" || raw.visualVerdict !== "pass") throw new Error("ComfyUI IC-LoRA benchmark must have a complete passing visual verdict");
  const treatmentKey = treatment(raw.treatmentKey, "ComfyUI IC-LoRA dedicated benchmark.treatmentKey");
  const treatmentPlan = planVisualTreatment(treatmentKey);
  if (raw.treatmentPlanFingerprint !== treatmentPlan.fingerprint) {
    throw new Error("ComfyUI IC-LoRA benchmark does not bind the current canonical treatment QA plan");
  }
  if (!Array.isArray(raw.requiredTreatmentCriterionIds) || raw.requiredTreatmentCriterionIds.some((id) => typeof id !== "string")) {
    throw new Error("ComfyUI IC-LoRA benchmark has invalid treatment review criterion IDs");
  }
  const requiredTreatmentCriterionIds = [...raw.requiredTreatmentCriterionIds].sort();
  const expectedTreatmentCriterionIds = treatmentPlan.qaBenchmarks
    .map((benchmark) => `visual-treatment/${treatmentKey}/${benchmark.id}`)
    .sort();
  if (
    requiredTreatmentCriterionIds.length !== expectedTreatmentCriterionIds.length ||
    requiredTreatmentCriterionIds.some((id, index) => id !== expectedTreatmentCriterionIds[index])
  ) {
    throw new Error("ComfyUI IC-LoRA benchmark must exercise the complete canonical treatment review rubric");
  }
  const evidence = assertComfyIcloraBenchmarkEvidence(raw.evidence);
  if (
    evidence.treatmentKey !== treatmentKey
    || evidence.treatmentPlanFingerprint !== treatmentPlan.fingerprint
    || evidence.controlKind !== raw.controlKind
  ) {
    throw new Error("ComfyUI IC-LoRA benchmark evidence does not exactly bind the benchmark treatment plan and control");
  }
  return Object.freeze({
    version: COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION,
    benchmarkId: identifier(raw.benchmarkId, "ComfyUI IC-LoRA dedicated benchmark.benchmarkId"),
    runtimeFingerprint: hash(raw.runtimeFingerprint, "ComfyUI IC-LoRA dedicated benchmark.runtimeFingerprint"),
    workflowFingerprint: hash(raw.workflowFingerprint, "ComfyUI IC-LoRA dedicated benchmark.workflowFingerprint"),
    candidateId: identifier(raw.candidateId, "ComfyUI IC-LoRA dedicated benchmark.candidateId"),
    candidateSourceImmutableRevision: revision(raw.candidateSourceImmutableRevision, "ComfyUI IC-LoRA dedicated benchmark.candidateSourceImmutableRevision"),
    candidateSourceSha256: hash(raw.candidateSourceSha256, "ComfyUI IC-LoRA dedicated benchmark.candidateSourceSha256"),
    adapterSha256: hash(raw.adapterSha256, "ComfyUI IC-LoRA dedicated benchmark.adapterSha256"),
    curatedSelectionBenchmarkFingerprint: hash(raw.curatedSelectionBenchmarkFingerprint, "ComfyUI IC-LoRA dedicated benchmark.curatedSelectionBenchmarkFingerprint"),
    family: family(raw.family, "ComfyUI IC-LoRA dedicated benchmark.family"),
    treatmentKey,
    treatmentPlanFingerprint: treatmentPlan.fingerprint,
    requiredTreatmentCriterionIds: Object.freeze(requiredTreatmentCriterionIds),
    controlKind: controlKind(raw.controlKind, "ComfyUI IC-LoRA dedicated benchmark.controlKind"),
    gpuSku,
    vramGb,
    terminalStatus: "complete",
    visualVerdict: "pass",
    evidence,
    reviewedAt: utc(raw.reviewedAt, "ComfyUI IC-LoRA dedicated benchmark.reviewedAt"),
    reviewedBy: identifier(raw.reviewedBy, "ComfyUI IC-LoRA dedicated benchmark.reviewedBy"),
  });
}

export function comfyIcloraDedicatedBenchmarkFingerprint(core: ComfyIcloraDedicatedBenchmarkCore): string {
  return sha256Hex(canonicalJson(core));
}

export function createComfyIcloraDedicatedBenchmark(value: unknown): ComfyIcloraDedicatedBenchmark {
  const core = benchmarkCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraDedicatedBenchmarkFingerprint(core) });
}

export function assertComfyIcloraDedicatedBenchmark(value: unknown): ComfyIcloraDedicatedBenchmark {
  const raw = asRecord(value, "ComfyUI IC-LoRA dedicated benchmark");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = benchmarkCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA dedicated benchmark.fingerprint");
  if (fingerprint !== comfyIcloraDedicatedBenchmarkFingerprint(core)) throw new Error("ComfyUI IC-LoRA dedicated benchmark fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function reservationCore(value: unknown): ComfyIcloraPreSpendReservationCore {
  const raw = asRecord(value, "ComfyUI IC-LoRA pre-spend reservation");
  assertExactKeys(raw, [
    "version", "reservationId", "spendIntentFingerprint", "budgetLedgerFingerprint", "reservationReceiptFingerprint", "spendCapCents", "reservedCents", "status", "reviewedBy", "reviewedAt",
  ], "ComfyUI IC-LoRA pre-spend reservation");
  if (raw.version !== COMFY_IC_LORA_PRE_SPEND_RESERVATION_VERSION) throw new Error("ComfyUI IC-LoRA pre-spend reservation version is unsupported");
  if (raw.status !== "reserved") throw new Error("ComfyUI IC-LoRA pre-spend reservation must already be reserved");
  const spendCapCents = positiveInteger(raw.spendCapCents, "ComfyUI IC-LoRA pre-spend reservation.spendCapCents", 10_000_000);
  const reservedCents = positiveInteger(raw.reservedCents, "ComfyUI IC-LoRA pre-spend reservation.reservedCents", spendCapCents);
  return Object.freeze({
    version: COMFY_IC_LORA_PRE_SPEND_RESERVATION_VERSION,
    reservationId: identifier(raw.reservationId, "ComfyUI IC-LoRA pre-spend reservation.reservationId"),
    spendIntentFingerprint: hash(raw.spendIntentFingerprint, "ComfyUI IC-LoRA pre-spend reservation.spendIntentFingerprint"),
    budgetLedgerFingerprint: hash(raw.budgetLedgerFingerprint, "ComfyUI IC-LoRA pre-spend reservation.budgetLedgerFingerprint"),
    reservationReceiptFingerprint: hash(raw.reservationReceiptFingerprint, "ComfyUI IC-LoRA pre-spend reservation.reservationReceiptFingerprint"),
    spendCapCents,
    reservedCents,
    status: "reserved",
    reviewedBy: identifier(raw.reviewedBy, "ComfyUI IC-LoRA pre-spend reservation.reviewedBy"),
    reviewedAt: utc(raw.reviewedAt, "ComfyUI IC-LoRA pre-spend reservation.reviewedAt"),
  });
}

export function comfyIcloraPreSpendReservationFingerprint(core: ComfyIcloraPreSpendReservationCore): string {
  return sha256Hex(canonicalJson(core));
}

/** This seals an existing reservation receipt; it does not reserve currency. */
export function createComfyIcloraPreSpendReservation(value: unknown): ComfyIcloraPreSpendReservation {
  const core = reservationCore(value);
  return Object.freeze({ ...core, fingerprint: comfyIcloraPreSpendReservationFingerprint(core) });
}

export function assertComfyIcloraPreSpendReservation(value: unknown): ComfyIcloraPreSpendReservation {
  const raw = asRecord(value, "ComfyUI IC-LoRA pre-spend reservation");
  const { fingerprint: suppliedFingerprint, ...coreInput } = raw;
  const core = reservationCore(coreInput);
  const fingerprint = hash(suppliedFingerprint, "ComfyUI IC-LoRA pre-spend reservation.fingerprint");
  if (fingerprint !== comfyIcloraPreSpendReservationFingerprint(core)) throw new Error("ComfyUI IC-LoRA pre-spend reservation fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint });
}

function assertIcloraSelection(value: unknown): CuratedLoraResolvedSelection {
  const raw = asRecord(value, "curated IC-LoRA selection");
  assertExactKeys(raw, [
    "version", "candidateId", "adapterClass", "localPath", "adapterSha256", "strength", "runtime", "target", "benchmarkFingerprint", "fingerprint",
  ].concat("seriesBindingFingerprint" in raw ? ["seriesBindingFingerprint"] : []), "curated IC-LoRA selection");
  if (raw.version !== CURATED_LORA_SELECTION_VERSION) throw new Error("curated IC-LoRA selection version is unsupported");
  if (raw.adapterClass !== "ic_lora") throw new Error("dedicated ComfyUI IC-LoRA path rejects standard LoRA selections");
  if (typeof raw.strength !== "number" || !Number.isFinite(raw.strength) || raw.strength < 0.15 || raw.strength > 0.95) {
    throw new Error("curated IC-LoRA selection strength must be within the benchmarked range");
  }
  const selectionRuntime = asRecord(raw.runtime, "curated IC-LoRA selection.runtime");
  assertExactKeys(selectionRuntime, ["baseModelId", "baseModelVersion", "baseModelSha256", "loader"], "curated IC-LoRA selection.runtime");
  if (selectionRuntime.loader !== "comfyui_ltx_ic_lora") throw new Error("curated IC-LoRA selection must use the dedicated ComfyUI IC-LoRA loader");
  const target = asRecord(raw.target, "curated IC-LoRA selection.target");
  assertExactKeys(target, ["scope", "shotId", "control"], "curated IC-LoRA selection.target");
  if (target.scope !== "shot_control") throw new Error("dedicated ComfyUI IC-LoRA path accepts only shot-control targets");
  const control = asRecord(target.control, "curated IC-LoRA selection.target.control");
  assertExactKeys(control, ["kind", "r2Key", "sha256", "byteLength"], "curated IC-LoRA selection.target.control");
  const normalizedTarget = Object.freeze({
    scope: "shot_control" as const,
    shotId: identifier(target.shotId, "curated IC-LoRA selection.target.shotId"),
    control: Object.freeze({
      kind: controlKind(control.kind, "curated IC-LoRA selection.target.control.kind"),
      r2Key: storageKey(control.r2Key, "curated IC-LoRA selection.target.control.r2Key"),
      sha256: hash(control.sha256, "curated IC-LoRA selection.target.control.sha256"),
      byteLength: positiveInteger(control.byteLength, "curated IC-LoRA selection.target.control.byteLength"),
    }),
  });
  const core = {
    version: CURATED_LORA_SELECTION_VERSION,
    candidateId: identifier(raw.candidateId, "curated IC-LoRA selection.candidateId"),
    adapterClass: "ic_lora" as const,
    localPath: localModelPath(raw.localPath, "curated IC-LoRA selection.localPath"),
    adapterSha256: hash(raw.adapterSha256, "curated IC-LoRA selection.adapterSha256"),
    strength: raw.strength,
    runtime: Object.freeze({
      baseModelId: text(selectionRuntime.baseModelId, "curated IC-LoRA selection.runtime.baseModelId", 320),
      baseModelVersion: text(selectionRuntime.baseModelVersion, "curated IC-LoRA selection.runtime.baseModelVersion", 80),
      baseModelSha256: hash(selectionRuntime.baseModelSha256, "curated IC-LoRA selection.runtime.baseModelSha256"),
      loader: "comfyui_ltx_ic_lora" as const,
    }) as CuratedLoraRuntimePin,
    target: normalizedTarget,
    benchmarkFingerprint: hash(raw.benchmarkFingerprint, "curated IC-LoRA selection.benchmarkFingerprint"),
    ...("seriesBindingFingerprint" in raw ? { seriesBindingFingerprint: hash(raw.seriesBindingFingerprint, "curated IC-LoRA selection.seriesBindingFingerprint") } : {}),
  };
  const fingerprint = hash(raw.fingerprint, "curated IC-LoRA selection.fingerprint");
  if (fingerprint !== sha256Hex(canonicalJson(core))) throw new Error("curated IC-LoRA selection fingerprint does not match its sealed fields");
  return Object.freeze({ ...core, fingerprint }) as CuratedLoraResolvedSelection;
}

function assertSelectionMatchesRuntime(selection: CuratedLoraResolvedSelection, runtime: ComfyIcloraRuntimePin): void {
  const expected: CuratedLoraRuntimePin = {
    baseModelId: runtime.baseModel.modelId,
    baseModelVersion: runtime.baseModel.modelVersion,
    baseModelSha256: runtime.baseModel.modelSha256,
    loader: "comfyui_ltx_ic_lora",
  };
  if (canonicalJson(selection.runtime) !== canonicalJson(expected)) {
    throw new Error("curated IC-LoRA selection runtime does not exactly match the dedicated ComfyUI runtime pin");
  }
}

function assertCandidateMatchesDedicatedRuntime(candidate: CuratedLoraCandidate, runtime: ComfyIcloraRuntimePin): void {
  const sealed = assertCuratedLoraCandidate(candidate);
  if (sealed.adapter.adapterClass !== "ic_lora") throw new Error("dedicated ComfyUI IC-LoRA path rejects standard LoRA candidates");
  if (sealed.status !== "curation_ready") throw new Error("curated IC-LoRA candidate has not completed integrity curation");
  if (sealed.source.immutableRevision === null || sealed.source.sha256 === null || sealed.compatibleRuntime.baseModelSha256 === null) {
    throw new Error("curated IC-LoRA candidate lacks a complete immutable source or base-model pin");
  }
  if (!sealed.compatibleRuntime.allowedLoaders.includes("comfyui_ltx_ic_lora")) {
    throw new Error("curated IC-LoRA candidate is not compatible with the dedicated ComfyUI IC-LoRA loader");
  }
  if (!sealed.compatibleRuntime.baseModelIds.includes(runtime.baseModel.modelId)
    || !sealed.compatibleRuntime.baseModelVersions.includes(runtime.baseModel.modelVersion)
    || sealed.compatibleRuntime.baseModelSha256 !== runtime.baseModel.modelSha256) {
    throw new Error("curated IC-LoRA candidate does not exactly match the dedicated ComfyUI base-model pin");
  }
}

/**
 * Workflow identity is a semantic safety rail in addition to its graph hash.
 * A byte-pinned but inappropriate graph would otherwise be able to apply a
 * reference sheet as a motion guide, or a pose graph to an outpaint task.
 */
export function officialLtxComfyIcloraWorkflowProfile(
  workflowId: string,
): OfficialLtxComfyIcloraWorkflowProfile {
  const profile = OFFICIAL_LTX_COMFY_IC_LORA_WORKFLOW_PROFILES.find((entry) => entry.workflowId === workflowId);
  if (!profile) {
    throw new Error("IC-LoRA workflow is not an approved official LTX 2.5 control workflow family");
  }
  return profile;
}

function assertWorkflowMatchesSelectedControl(
  workflow: ComfyIcloraWorkflowPin,
  selectedControl: ICLoraControl,
): void {
  if (workflow.workflowSource.repository !== OFFICIAL_LTX_COMFY_WORKFLOW_REPOSITORY) {
    throw new Error("IC-LoRA workflow claims an official LTX workflow family but is not pinned to the official ComfyUI-LTXVideo source");
  }
  const profile = officialLtxComfyIcloraWorkflowProfile(workflow.workflowId);
  if (!(profile.guideKinds as readonly ICLoraControl[]).includes(selectedControl)) {
    throw new Error("IC-LoRA workflow family is not appropriate for the selected control kind");
  }
  if (!workflow.requiredGuideKinds.includes(selectedControl)) {
    throw new Error("IC-LoRA workflow pin omits the selected control kind required by its official workflow family");
  }
}

function assertLicenseMatchesCandidate(license: ComfyIcloraLicenseAcceptance, candidate: CuratedLoraCandidate): void {
  if (candidate.source.immutableRevision === null || candidate.source.sha256 === null) {
    throw new Error("curated IC-LoRA candidate lacks an immutable source pin for license binding");
  }
  if (license.candidateId !== candidate.id
    || license.licenseId !== candidate.source.license.id
    || license.termsUrl !== candidate.source.license.termsUrl
    || license.sourceImmutableRevision !== candidate.source.immutableRevision
    || license.sourceSha256 !== candidate.source.sha256) {
    throw new Error("IC-LoRA license acceptance does not exactly bind the selected official source pin");
  }
}

function assertShotBindingMatchesContract(binding: ComfyIcloraShotBinding, shotControl: NarrativeShotControlContract): void {
  if (binding.shotControlFingerprint !== shotControl.fingerprint
    || binding.visualStyle !== shotControl.visualStyle
    || !shotControl.shots.some((shot) => shot.shotId === binding.shotId)) {
    throw new Error("IC-LoRA shot binding does not match the sealed narrative shot-control contract");
  }
  const expectedPlan = planVisualTreatment(binding.treatmentKey);
  if (binding.treatmentPlanFingerprint !== expectedPlan.fingerprint) {
    throw new Error("IC-LoRA shot binding treatment plan fingerprint is not the current sealed treatment plan");
  }
  if (!visualTreatmentDefinition(binding.treatmentKey).channelType.supportedFamilies.includes(binding.family)) {
    throw new Error("IC-LoRA shot binding family is not supported by its treatment");
  }
}

function assertGuides(value: readonly unknown[], workflow: ComfyIcloraWorkflowPin, candidate: CuratedLoraCandidate, binding: ComfyIcloraShotBinding): readonly ComfyIcloraGuideArtifact[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > IC_LORA_CONTROLS.length) {
    throw new Error("IC-LoRA guide artifact list must contain one to six byte-bound artifacts");
  }
  const guides = value.map((guide) => assertComfyIcloraGuideArtifact(guide));
  if (new Set(guides.map((guide) => guide.kind)).size !== guides.length) {
    throw new Error("IC-LoRA guide artifact list may not contain duplicate control kinds");
  }
  for (const guide of guides) {
    if (guide.shotId !== binding.shotId || guide.shotControlFingerprint !== binding.shotControlFingerprint) {
      throw new Error("IC-LoRA guide artifact is not bound to the selected sealed shot");
    }
    if (!workflow.requiredGuideKinds.includes(guide.kind)) {
      throw new Error(`IC-LoRA workflow does not declare ${guide.kind} as a required guide`);
    }
    if (candidate.adapter.adapterClass !== "ic_lora" || !candidate.adapter.controls.includes(guide.kind)) {
      throw new Error(`selected IC-LoRA adapter does not support ${guide.kind}`);
    }
  }
  for (const required of workflow.requiredGuideKinds) {
    if (!guides.some((guide) => guide.kind === required)) throw new Error(`IC-LoRA workflow is missing required ${required} guide bytes`);
  }
  return Object.freeze(guides);
}

function workOrderIntentCore(value: {
  readonly runtime: ComfyIcloraRuntimePin;
  readonly workflow: ComfyIcloraWorkflowPin;
  readonly selection: CuratedLoraResolvedSelection;
  readonly license: ComfyIcloraLicenseAcceptance;
  readonly binding: ComfyIcloraShotBinding;
  readonly guides: readonly ComfyIcloraGuideArtifact[];
  readonly benchmark: ComfyIcloraDedicatedBenchmark;
}): Omit<ComfyIcloraWorkOrderCore, "preSpendReservationFingerprint"> {
  return {
    version: COMFY_IC_LORA_WORK_ORDER_VERSION,
    spendIntentFingerprint: "", // Filled from the canonical intent below; no caller-provided value is trusted.
    runtimeFingerprint: value.runtime.fingerprint,
    provider: value.runtime.provider,
    requiredGpuSku: value.runtime.requiredGpuSku,
    minimumVramGb: value.runtime.minimumVramGb,
    workflowFingerprint: value.workflow.fingerprint,
    candidateId: value.selection.candidateId,
    selectionFingerprint: value.selection.fingerprint,
    adapterSha256: value.selection.adapterSha256,
    licenseAcceptanceFingerprint: value.license.fingerprint,
    shotBindingFingerprint: value.binding.fingerprint,
    guideArtifacts: Object.freeze([...value.guides].sort((left, right) => left.kind.localeCompare(right.kind))),
    benchmarkFingerprint: value.benchmark.fingerprint,
  };
}

export function comfyIcloraSpendIntentFingerprint(value: {
  readonly runtime: ComfyIcloraRuntimePin;
  readonly workflow: ComfyIcloraWorkflowPin;
  readonly selection: CuratedLoraResolvedSelection;
  readonly license: ComfyIcloraLicenseAcceptance;
  readonly binding: ComfyIcloraShotBinding;
  readonly guides: readonly ComfyIcloraGuideArtifact[];
  readonly benchmark: ComfyIcloraDedicatedBenchmark;
}): string {
  return sha256Hex(canonicalJson(workOrderIntentCore(value)));
}

export function comfyIcloraWorkOrderFingerprint(core: ComfyIcloraWorkOrderCore): string {
  return sha256Hex(canonicalJson(core));
}

/**
 * Validate all proofs needed before a future scheduler may submit a paid job.
 * A successful result is still not an execution command, and cannot contact
 * a provider by itself.
 */
export function admitComfyIcloraPreSpend(value: {
  readonly runtime: unknown;
  readonly workflow: unknown;
  readonly candidate: CuratedLoraCandidate;
  readonly selection: unknown;
  readonly licenseAcceptance: unknown;
  readonly shotBinding: unknown;
  readonly shotControl: unknown;
  readonly guideArtifacts: readonly unknown[];
  readonly benchmark: unknown;
  readonly preSpendReservation: unknown;
}): ComfyIcloraPreSpendAdmission {
  const blockers: string[] = [];
  const attempt = <T>(action: () => T): T | undefined => {
    try {
      return action();
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "IC-LoRA pre-spend proof is malformed");
      return undefined;
    }
  };

  const runtime = attempt(() => assertComfyIcloraRuntimePin(value.runtime));
  const workflow = attempt(() => assertComfyIcloraWorkflowPin(value.workflow));
  const selection = attempt(() => assertIcloraSelection(value.selection));
  const license = attempt(() => assertComfyIcloraLicenseAcceptance(value.licenseAcceptance));
  const binding = attempt(() => assertComfyIcloraShotBinding(value.shotBinding));
  const shotControl = attempt(() => NarrativeShotControlContractSchema.parse(value.shotControl));
  const benchmark = attempt(() => assertComfyIcloraDedicatedBenchmark(value.benchmark));
  const reservation = attempt(() => assertComfyIcloraPreSpendReservation(value.preSpendReservation));

  if (!runtime || !workflow || !selection || !license || !binding || !shotControl || !benchmark || !reservation) {
    return { status: "blocked", blockers: Object.freeze([...new Set(blockers)]) };
  }

  const candidate = attempt(() => {
    assertCandidateMatchesDedicatedRuntime(value.candidate, runtime);
    return value.candidate;
  });
  const guides = candidate ? attempt(() => assertGuides(value.guideArtifacts, workflow, candidate, binding)) : undefined;
  if (!candidate || !guides) return { status: "blocked", blockers: Object.freeze([...new Set(blockers)]) };

  attempt(() => {
    if (workflow.runtimeFingerprint !== runtime.fingerprint) throw new Error("IC-LoRA workflow runtime fingerprint does not match the dedicated runtime pin");
    if (benchmark.vramGb < runtime.minimumVramGb) {
      throw new Error("dedicated IC-LoRA benchmark hardware does not meet the sealed runtime VRAM floor");
    }
    if (benchmark.gpuSku !== runtime.requiredGpuSku) {
      throw new Error("dedicated IC-LoRA benchmark GPU does not match the sealed Novita worker requirement");
    }
    if (!workflow.supportedTreatments.includes(binding.treatmentKey) || !workflow.supportedFamilies.includes(binding.family)) {
      throw new Error("IC-LoRA workflow is not benchmarked for the selected treatment and family");
    }
    assertSelectionMatchesRuntime(selection, runtime);
    if (selection.candidateId !== candidate.id || selection.adapterSha256 !== candidate.source.sha256) {
      throw new Error("curated IC-LoRA selection does not match the selected official adapter source pin");
    }
    if (selection.target.scope !== "shot_control") {
      throw new Error("curated IC-LoRA selection is not targeted at the selected sealed shot");
    }
    const selectedTarget = selection.target;
    if (selectedTarget.shotId !== binding.shotId) {
      throw new Error("curated IC-LoRA selection is not targeted at the selected sealed shot");
    }
    assertWorkflowMatchesSelectedControl(workflow, selectedTarget.control.kind);
    if (candidate.adapter.adapterClass !== "ic_lora") {
      throw new Error("dedicated ComfyUI IC-LoRA path rejects standard LoRA candidates");
    }
    const adapter = candidate.adapter;
    if (!adapter.controls.includes(selectedTarget.control.kind) || !workflow.requiredGuideKinds.includes(selectedTarget.control.kind)) {
      throw new Error("curated IC-LoRA selection control is not declared by both adapter and workflow");
    }
    if (!candidate.supportedTreatments.includes(binding.treatmentKey) || !candidate.supportedFamilies.includes(binding.family)) {
      throw new Error("curated IC-LoRA candidate is not curated for the selected treatment and family");
    }
    const selectedGuide = guides.find((guide) => guide.kind === selectedTarget.control.kind);
    if (!selectedGuide
      || selectedGuide.r2Key !== selectedTarget.control.r2Key
      || selectedGuide.sha256 !== selectedTarget.control.sha256
      || selectedGuide.byteLength !== selectedTarget.control.byteLength) {
      throw new Error("curated IC-LoRA selection control bytes do not exactly match the sealed guide artifact");
    }
    assertLicenseMatchesCandidate(license, candidate);
    assertShotBindingMatchesContract(binding, shotControl);
    if (benchmark.runtimeFingerprint !== runtime.fingerprint
      || benchmark.workflowFingerprint !== workflow.fingerprint
      || benchmark.candidateId !== candidate.id
      || benchmark.candidateSourceImmutableRevision !== candidate.source.immutableRevision
      || benchmark.candidateSourceSha256 !== candidate.source.sha256
      || benchmark.adapterSha256 !== selection.adapterSha256
      || benchmark.curatedSelectionBenchmarkFingerprint !== selection.benchmarkFingerprint
      || benchmark.family !== binding.family
      || benchmark.treatmentKey !== binding.treatmentKey
      || benchmark.treatmentPlanFingerprint !== binding.treatmentPlanFingerprint
      || benchmark.controlKind !== selectedTarget.control.kind) {
      throw new Error("dedicated IC-LoRA benchmark evidence does not exactly bind this runtime, workflow, adapter, treatment, and control");
    }
  });
  if (blockers.length > 0) return { status: "blocked", blockers: Object.freeze([...new Set(blockers)]) };

  const spendIntentFingerprint = comfyIcloraSpendIntentFingerprint({ runtime, workflow, selection, license, binding, guides, benchmark });
  if (reservation.spendIntentFingerprint !== spendIntentFingerprint) {
    return {
      status: "blocked",
      blockers: Object.freeze(["IC-LoRA pre-spend reservation does not bind this exact immutable work-order intent"]),
    };
  }
  const intentCore = workOrderIntentCore({ runtime, workflow, selection, license, binding, guides, benchmark });
  const core: ComfyIcloraWorkOrderCore = {
    ...intentCore,
    spendIntentFingerprint,
    preSpendReservationFingerprint: reservation.fingerprint,
  };
  return {
    status: "eligible_for_reserved_spend",
    workOrder: Object.freeze({ ...core, fingerprint: comfyIcloraWorkOrderFingerprint(core) }),
  };
}
