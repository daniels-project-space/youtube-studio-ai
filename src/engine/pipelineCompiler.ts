import { createHash } from "node:crypto";
import type { PipelineEntry } from "./types";
import type { ResolvedPipeline } from "./validate";
import { allManifests, getManifest } from "./registry";
import { configuredMaxCostUsd } from "./moduleManifest";
import {
  assessNovitaVideoRenderBinding,
  assertNovitaVideoRenderBinding,
  compileCatalogExecutionFlow,
  type CatalogExecutionStep,
  type NovitaVideoRenderAssessment,
} from "./goldenExecution";

export interface PipelinePolicy {
  id: string;
  version: string;
  minimumCertification: "contract" | "golden";
  requiredCapabilities: readonly string[];
  requireCrewBindings: boolean;
  requireStoryAlignmentForGeneratedVisuals: boolean;
  allowOpaqueMigrationArtifacts: boolean;
}

export interface CompiledModuleRecord {
  id: string;
  version: string;
  configFingerprint: string;
  certification: string;
  capabilities: readonly string[];
}

export interface PipelineCompilation {
  policyId: string;
  policyVersion: string;
  fingerprint: string;
  capabilities: string[];
  modules: CompiledModuleRecord[];
  /** Exact selected modules mapped to catalog owners; qualification is explicit. */
  catalogFlow: readonly CatalogExecutionStep[];
  /** Read-only admission assessment for the single approved provider AI-video route. */
  videoRenderBinding: NovitaVideoRenderAssessment;
  bindings: Record<string, Record<string, string>>;
  warnings: string[];
  reservedMaxCostUsd: number;
}

export class PipelinePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelinePolicyError";
  }
}

/**
 * Freeze the parameter set that the runner will execute into the persisted
 * pipeline before validation, fingerprinting, and spend reservation. Runtime
 * operator presets must never live only in a side map: doing so lets a more
 * expensive configuration bypass the compiler's budget contract.
 */
export function materializeRuntimePipelineParams(
  entries: readonly PipelineEntry[],
  paramsByBlock: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): PipelineEntry[] {
  return entries.map((entry) => {
    const effectiveParams = paramsByBlock[entry.block];
    return effectiveParams
      ? { ...entry, params: { ...effectiveParams } }
      : entry;
  });
}

/**
 * Runnable production floor. Every selected ABI is mapped to an editorial
 * module-catalog owner for routing/export, but that mapping does not change its
 * certification: contract-certified modules remain contract-certified. Formal
 * Golden promotion still requires selectGoldenProductionModules(), a Golden-
 * certified manifest, and an immutable proof receipt.
 */
export const PRODUCTION_CONTRACT_POLICY: PipelinePolicy = {
  id: "production-contract",
  version: "1.0.0",
  minimumCertification: "contract",
  requiredCapabilities: [
    "topic.researched",
    "topic.selected",
    "final.compliance_passed",
    "master.assembled",
    "master.quality_passed",
    "package.metadata",
    "package.thumbnail",
    "publish.connector_bound",
    "publish.synthetic_disclosed",
  ],
  requireCrewBindings: true,
  requireStoryAlignmentForGeneratedVisuals: true,
  allowOpaqueMigrationArtifacts: true,
};

const certificationRank = { revoked: -1, legacy: 0, contract: 1, golden: 2 } as const;

export const CREW_ARTIFACT_BINDINGS: ReadonlyArray<{
  consumerIds: readonly string[];
  artifact: string;
  capability: string;
}> = [
  { consumerIds: ["script_gen", "story_spine"], artifact: "structure", capability: "crew.director_treatment" },
  {
    consumerIds: [
      "scene_planner",
      "stock_footage",
      "gen_footage",
      "signature_clips",
      "novita_render_images",
      "novita_render_video",
      "whiteboard_scribe",
      "motion_comic",
      "story_spine",
    ],
    artifact: "visualBrief",
    capability: "crew.dp_visual_spec",
  },
  { consumerIds: ["timeline_assemble", "story_spine"], artifact: "cutSheet", capability: "crew.editor_edl" },
  {
    consumerIds: ["music", "narration_tts"],
    artifact: "musicBrief",
    capability: "crew.composer_cue_sheet",
  },
  { consumerIds: ["qa_visual"], artifact: "validationSpec", capability: "crew.critic_validation_spec" },
];

function pipelineCapabilities(entries: readonly PipelineEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) => getManifest(entry.block)?.capabilities ?? []),
  );
}

function findArtifactProducerIndex(entries: readonly PipelineEntry[], artifact: string): number {
  return entries.findIndex((entry) => {
    const manifest = getManifest(entry.block);
    return Boolean(manifest && (artifact in manifest.produces || artifact in manifest.optionalProduces));
  });
}

function insertCapabilityProvider(
  entries: PipelineEntry[],
  capability: string,
  beforeIndex?: number,
): string | null {
  if (pipelineCapabilities(entries).has(capability)) return null;
  const candidates = allManifests()
    .filter(
      (manifest) =>
        manifest.capabilities.includes(capability) &&
        certificationRank[manifest.certification.status] >= certificationRank.contract &&
        !entries.some((entry) => entry.block === manifest.id),
    )
    .sort(
      (a, b) =>
        a.capabilities.length - b.capabilities.length ||
        Object.keys(a.produces).length + Object.keys(a.optionalProduces).length -
          (Object.keys(b.produces).length + Object.keys(b.optionalProduces).length) ||
        a.id.localeCompare(b.id),
    );
  for (const candidate of candidates) {
    const existingProduced = new Set(
      entries.flatMap((entry) => {
        const manifest = getManifest(entry.block);
        return manifest ? [...Object.keys(manifest.produces), ...Object.keys(manifest.optionalProduces)] : [];
      }),
    );
    if (
      [...Object.keys(candidate.produces), ...Object.keys(candidate.optionalProduces)]
        .some((artifact) => existingProduced.has(artifact))
    ) continue;
    const required = Object.keys(candidate.consumes);
    const producerIndexes = required.map((artifact) => findArtifactProducerIndex(entries, artifact));
    if (producerIndexes.some((index) => index < 0)) continue;
    const insertAt = producerIndexes.length ? Math.max(...producerIndexes) + 1 : 0;
    if (beforeIndex !== undefined && insertAt > beforeIndex) continue;
    entries.splice(beforeIndex === undefined ? insertAt : Math.min(insertAt, beforeIndex), 0, {
      block: candidate.id,
    });
    return candidate.id;
  }
  return null;
}

function producesArtifact(entry: PipelineEntry, artifact: string): boolean {
  const manifest = getManifest(entry.block);
  return Boolean(
    manifest &&
      (artifact in manifest.produces || artifact in manifest.optionalProduces),
  );
}

/**
 * A channel that can upload a master must visually review that exact master
 * before the side effect. Older/custom channel rows may predate qa_visual, so
 * insert the shared evidence-backed gate at the one safe point instead of
 * trusting every caller to remember it.
 */
function ensureReleaseVisualReview(entries: PipelineEntry[]): boolean {
  const uploadIndex = entries.findIndex((entry) => entry.block === "upload_draft");
  if (uploadIndex < 0) return false;

  const qaIndexes = entries
    .map((entry, index) => entry.block === "qa_visual" ? index : -1)
    .filter((index) => index >= 0);
  if (qaIndexes.length > 1) {
    throw new PipelinePolicyError("publish pipeline has multiple qa_visual stages; one final evidence review is required");
  }
  if (qaIndexes.length === 1) {
    const qaIndex = qaIndexes[0];
    if (qaIndex > uploadIndex) {
      throw new PipelinePolicyError("qa_visual must run before upload_draft");
    }
    if (entries[qaIndex].params?.["qaProfile"] === "draft") {
      throw new PipelinePolicyError("upload_draft cannot use qa_visual qaProfile=draft");
    }
    return false;
  }

  const upstream = entries.slice(0, uploadIndex);
  if (!upstream.some((entry) => producesArtifact(entry, "videoLocalPath"))) {
    throw new PipelinePolicyError("cannot add qa_visual: upload_draft has no rendered video upstream");
  }
  if (!upstream.some((entry) => producesArtifact(entry, "thumbnailKey"))) {
    throw new PipelinePolicyError("cannot add qa_visual: upload_draft has no thumbnail upstream");
  }
  entries.splice(uploadIndex, 0, { block: "qa_visual", params: { qaProfile: "production" } });
  return true;
}

/**
 * Deterministically fills policy/crew capability gaps using certified manifests.
 * It never invents params or replaces an implementation chosen by the designer;
 * ambiguous core engines remain a compile error.
 */
export function completePipelineForPolicy(
  source: readonly PipelineEntry[],
): { entries: PipelineEntry[]; inserted: string[]; retired: string[] } {
  const entries = source.map((entry) => ({
    block: entry.block,
    ...(entry.params ? { params: { ...entry.params } } : {}),
  }));
  const retired: string[] = [];

  // qa_refine is a proven no-op whose implementation was fully replaced by
  // qa_visual's fail-closed deterministic gate and the runner's bounded
  // ownership-aware self-heal. Strip persisted legacy rows before resolution so
  // the retired block no longer needs to remain registered forever.
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].block !== "qa_refine") continue;
    entries.splice(index, 1);
    retired.push("qa_refine");
  }

  // Legacy music-loop channels sometimes persisted both intro_card and the
  // newer deblur-intro assemble mode. The former is dead work in that mode and
  // both modules publish `introApplied`, so it also creates an ambiguous
  // producer graph. Normalize only this proven legacy shape; the prepend-card
  // path (deblurIntro:false) retains its real intro_card dependency.
  for (let assembleIndex = entries.length - 1; assembleIndex >= 0; assembleIndex--) {
    const assembleEntry = entries[assembleIndex];
    if (assembleEntry.block !== "assemble" || assembleEntry.params?.["deblurIntro"] === false) continue;
    for (let index = assembleIndex - 1; index >= 0; index--) {
      if (entries[index].block !== "intro_card") continue;
      entries.splice(index, 1);
      retired.push("intro_card");
      assembleIndex--;
    }
  }
  const inserted: string[] = [];

  // The current designer gives every externally narrated family a versioned,
  // timed story artifact. Persisted pre-overhaul channels must receive the same
  // spine without forcing self-contained whiteboard/comic or music-loop
  // families to adopt narration modules they do not use.
  const narrationIndex = entries.findIndex((entry) => entry.block === "narration_tts");
  if (narrationIndex >= 0 && !entries.some((entry) => entry.block === "story_spine")) {
    const isShorts = entries.some(
      (entry) =>
        entry.params?.["style"] === "shorts" ||
        entry.params?.["aspect"] === "9:16" ||
        entry.params?.["aspectRatio"] === "9:16",
    );
    entries.splice(narrationIndex + 1, 0, {
      block: "story_spine",
      params: {
        generationProfile: "production",
        targetShotSec: isShorts ? 4 : 6,
      },
    });
    inserted.push("story_spine");
  }

  for (const capability of ["topic.researched", "final.compliance_passed"]) {
    const moduleId = insertCapabilityProvider(entries, capability);
    if (moduleId) inserted.push(moduleId);
  }
  if (pipelineCapabilities(entries).has("script.generated")) {
    const moduleId = insertCapabilityProvider(entries, "script.qa_passed");
    if (moduleId) inserted.push(moduleId);
  }

  if (ensureReleaseVisualReview(entries)) {
    inserted.push("qa_visual");
  }

  for (const binding of CREW_ARTIFACT_BINDINGS) {
    const consumerIndex = entries.findIndex((entry) => binding.consumerIds.includes(entry.block));
    if (consumerIndex < 0 || findArtifactProducerIndex(entries, binding.artifact) >= 0) continue;
    const moduleId = insertCapabilityProvider(entries, binding.capability, consumerIndex);
    if (!moduleId) {
      throw new PipelinePolicyError(
        `no certified provider can produce crew artifact "${binding.artifact}" before ${entries[consumerIndex].block}`,
      );
    }
    inserted.push(moduleId);
  }
  return { entries, inserted, retired: [...new Set(retired)] };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

/** Deterministic SHA-256 identity for persisted compilation evidence. */
function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function requireCapability(capabilities: Set<string>, capability: string, reason?: string): void {
  if (!capabilities.has(capability)) {
    throw new PipelinePolicyError(
      `Production policy requires capability "${capability}"${reason ? ` (${reason})` : ""}`,
    );
  }
}

function validatePublicationApproval(entry: PipelineEntry): void {
  const params = (entry.params ?? {}) as Record<string, unknown>;
  if (entry.block === "upload_draft") {
    const mode = String(params.publishMode ?? "draft");
    if ((mode === "public" || mode === "scheduled") && params.approvedForPublish !== true) {
      throw new PipelinePolicyError(
        `upload_draft publishMode=${mode} requires approvedForPublish=true from an authenticated operator`,
      );
    }
  }
  if (entry.block === "shorts_spinoff") {
    const publicShort = params.publishShort === "public";
    const crosspost = params.crosspostShort === true;
    if ((publicShort || crosspost) && params.approvedForPublish !== true) {
      throw new PipelinePolicyError(
        "shorts_spinoff public/crosspost side effects require approvedForPublish=true",
      );
    }
  }
  if (entry.block === "crosspost" && params.approvedForPublish !== true) {
    throw new PipelinePolicyError("crosspost requires approvedForPublish=true");
  }
}

export function compilePipeline(
  resolved: ResolvedPipeline,
  policy: PipelinePolicy = PRODUCTION_CONTRACT_POLICY,
): PipelineCompilation {
  if (resolved.manifests.length !== resolved.entries.length) {
    throw new PipelinePolicyError("resolved pipeline lost its executable manifest alignment");
  }

  const capabilities = new Set<string>();
  const warnings: string[] = [];
  let reservedMaxCostUsd = 0;
  const producerByArtifact = new Map<string, string>();
  const bindings: Record<string, Record<string, string>> = {};

  for (let i = 0; i < resolved.manifests.length; i++) {
    const manifest = resolved.manifests[i];
    const entry = resolved.entries[i];
    if (certificationRank[manifest.certification.status] < certificationRank[policy.minimumCertification]) {
      throw new PipelinePolicyError(
        `module "${manifest.id}" is ${manifest.certification.status}; policy requires ${policy.minimumCertification} certification`,
      );
    }
    manifest.configSchema.parse(entry.params ?? {});
    for (const capability of manifest.capabilities) capabilities.add(capability);

    if (manifest.costAndLatency.paid) {
      if (!manifest.providerProfiles.length) {
        throw new PipelinePolicyError(`paid module "${manifest.id}" has no pinned provider profile`);
      }
      if (manifest.providerProfiles.some((profile) => profile.allowFallback)) {
        throw new PipelinePolicyError(`paid module "${manifest.id}" permits silent provider fallback`);
      }
      if (manifest.costAndLatency.maxCostUsd === undefined) {
        throw new PipelinePolicyError(`paid module "${manifest.id}" has no maximum cost envelope`);
      }
      reservedMaxCostUsd += configuredMaxCostUsd(manifest, entry.params ?? {}, {
        entries: resolved.entries,
        index: i,
      });
    }

    const inputBindings: Record<string, string> = {};
    for (const key of [...Object.keys(manifest.consumes), ...Object.keys(manifest.optionalConsumes)]) {
      const producer = producerByArtifact.get(key);
      if (producer) inputBindings[key] = `${producer}:${key}`;
    }
    bindings[manifest.id] = inputBindings;

    for (const [key, contract] of Object.entries(manifest.produces)) {
      producerByArtifact.set(key, manifest.id);
      if (contract.opaque) warnings.push(`${manifest.id}.${key} still uses a migration artifact schema`);
    }
    for (const [key, contract] of Object.entries(manifest.optionalProduces)) {
      producerByArtifact.set(key, manifest.id);
      if (contract.opaque) warnings.push(`${manifest.id}.${key} still uses a migration artifact schema`);
    }
    for (const [key, contract] of Object.entries(manifest.consumes)) {
      if (contract.opaque && !policy.allowOpaqueMigrationArtifacts) {
        throw new PipelinePolicyError(`${manifest.id} requires opaque migration artifact "${key}"`);
      }
    }
    validatePublicationApproval(entry);
  }

  for (const capability of policy.requiredCapabilities) requireCapability(capabilities, capability);

  if (capabilities.has("script.generated")) {
    requireCapability(capabilities, "script.qa_passed", "a script-producing pipeline must certify its script");
    requireCapability(capabilities, "narration.timed", "a script-producing pipeline must produce timed narration");
    requireCapability(capabilities, "final.originality_passed", "a script-producing pipeline must pass originality");
  }
  if (policy.requireStoryAlignmentForGeneratedVisuals && capabilities.has("visuals.generated")) {
    requireCapability(
      capabilities,
      "visuals.story_aligned",
      "generated visuals require exact story/beat alignment",
    );
  }

  if (policy.requireCrewBindings) {
    for (const binding of CREW_ARTIFACT_BINDINGS) {
      const consumerIndexes = resolved.manifests
        .map((manifest, index) => (binding.consumerIds.includes(manifest.id) ? index : -1))
        .filter((index) => index >= 0);
      if (!consumerIndexes.length) continue;
      requireCapability(capabilities, binding.capability, `${binding.artifact} is consumed by production modules`);
      const producerIndex = resolved.manifests.findIndex(
        (manifest) =>
          binding.artifact in manifest.produces || binding.artifact in manifest.optionalProduces,
      );
      if (producerIndex < 0) {
        throw new PipelinePolicyError(`crew artifact "${binding.artifact}" has no producer`);
      }
      for (const consumerIndex of consumerIndexes) {
        const consumer = resolved.manifests[consumerIndex];
        if (producerIndex >= consumerIndex) {
          throw new PipelinePolicyError(
            `crew artifact "${binding.artifact}" must be produced before "${consumer.id}"`,
          );
        }
        if (!(binding.artifact in consumer.consumes) && !(binding.artifact in consumer.optionalConsumes)) {
          throw new PipelinePolicyError(
            `module "${consumer.id}" uses crew artifact "${binding.artifact}" without declaring it`,
          );
        }
      }
    }
  }

  const modules: CompiledModuleRecord[] = resolved.manifests.map((manifest, index) => ({
    id: manifest.id,
    version: manifest.version,
    configFingerprint: fingerprint(resolved.entries[index].params ?? {}),
    certification: manifest.certification.status,
    capabilities: manifest.capabilities,
  }));
  const catalogFlow = compileCatalogExecutionFlow(resolved.manifests);
  const videoRenderBinding = assessNovitaVideoRenderBinding(resolved.manifests);
  try {
    assertNovitaVideoRenderBinding(resolved.manifests);
  } catch (error) {
    throw new PipelinePolicyError(
      error instanceof Error ? error.message : "AI-video render binding rejected",
    );
  }
  const record = {
    policyId: policy.id,
    policyVersion: policy.version,
    capabilities: [...capabilities].sort(),
    modules,
    catalogFlow,
    videoRenderBinding,
  };
  return {
    ...record,
    fingerprint: fingerprint(record),
    bindings,
    warnings: [...new Set(warnings)].sort(),
    reservedMaxCostUsd,
  };
}
