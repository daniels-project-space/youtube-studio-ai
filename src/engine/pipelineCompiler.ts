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
import type { GenerationProfileId } from "./runtimeCapability";

/**
 * The render tier every pipeline resolves to unless a caller explicitly selects
 * another one. Keep this literal in ONE place: the draft/hero tiers exist in
 * GENERATION_PROFILES but are only reachable through explicit configuration, so
 * an absent setting must always land back on exactly this value.
 */
export const DEFAULT_GENERATION_PROFILE: GenerationProfileId = "production";

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

/**
 * A Channel Inception probe is a real, private master plus the complete
 * editorial/technical evidence chain. It deliberately omits only publishing
 * capabilities because its source pipeline has already removed `upload_draft`.
 * This is not a softer production policy: crew, story alignment, certification,
 * metadata, thumbnail, compliance, and final-master QA remain mandatory.
 */
export const PRIVATE_PROBE_CONTRACT_POLICY: PipelinePolicy = {
  ...PRODUCTION_CONTRACT_POLICY,
  id: "private-probe-contract",
  version: "1.0.0",
  requiredCapabilities: PRODUCTION_CONTRACT_POLICY.requiredCapabilities.filter(
    (capability) =>
      capability !== "publish.connector_bound" &&
      capability !== "publish.synthetic_disclosed",
  ),
};

const certificationRank = { revoked: -1, legacy: 0, contract: 1, golden: 2 } as const;

type PolicyManifestSource = "runtime" | "structural";

interface PolicyManifestProjection {
  readonly id: string;
  readonly certification: keyof typeof certificationRank;
  readonly capabilities: readonly string[];
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
}

const policyProjection = (
  id: string,
  capabilities: readonly string[] = [],
  consumes: readonly string[] = [],
  produces: readonly string[] = [],
): PolicyManifestProjection => ({
  id,
  certification: "contract",
  capabilities,
  consumes,
  produces,
});

/**
 * Browser-safe structural slice of the executable manifest catalog.
 *
 * Policy completion only needs capability providers and the small set of
 * artifacts used to place them. Keeping that declaration here makes policy
 * order deterministic without importing Trigger block implementations (and
 * their renderer binaries) into read-only web routes. The executable path
 * still resolves and validates every full manifest after registration; parity
 * tests compile every supported family through both sources.
 */
const STRUCTURAL_POLICY_MANIFESTS: readonly PolicyManifestProjection[] = [
  policyProjection("documentary_source_plan", [
    "topic.researched", "documentary.source_plan_sealed",
  ], [], ["plannedTopic", "documentaryEpisodePlan", "sourceReferences", "claimEvidence"]),
  policyProjection("topic_select", ["topic.selected"], [], ["topic"]),
  policyProjection("competitor_research", ["topic.researched"], [], [
    "nicheReady", "niche", "nicheIntel", "seoDatabank", "competitors",
    "thumbnailIdentity", "persona", "thumbnailer",
  ]),
  policyProjection("script_gen", ["script.generated"], ["topic"], ["script", "narrationText"]),
  policyProjection("qa_script", ["script.qa_passed"], ["narrationText"], ["scriptApproved"]),
  policyProjection("compliance_check", ["final.compliance_passed"], ["topic"], [
    "disclosureRequired", "sensitiveTopic", "complianceNote",
  ]),
  policyProjection("director_brief", ["crew.director_treatment"], ["topic"], ["structure"]),
  policyProjection("dp_brief", ["crew.dp_visual_spec"], ["topic"], ["visualBrief"]),
  policyProjection("editor_brief", ["crew.editor_edl"], ["topic"], ["cutSheet"]),
  policyProjection("composer_brief", ["crew.composer_cue_sheet"], ["topic"], ["musicBrief"]),
  policyProjection("critic_spec", ["crew.critic_validation_spec"], ["topic"], ["validationSpec"]),
  policyProjection("thumbnail_gen", ["package.thumbnail"], [
    "title", "thumbnailDescription", "topic", "packageToOpeningPlan",
  ], ["thumbnailKey"]),
  policyProjection("assemble", ["master.assembled"], ["loopUnitKey", "musicUrl"], ["videoLocalPath"]),
  policyProjection("timeline_assemble", ["master.assembled"], [
    "footageClips", "narrationLocalPath", "narrationDurationSec", "musicUrl",
  ], ["videoLocalPath"]),
  policyProjection("scene_compiler", ["visuals.scene_compiled", "master.assembled"], [
    "sceneManifest", "narrationLocalPath", "narrationDurationSec", "musicUrl",
  ], ["videoLocalPath"]),
  policyProjection("whiteboard_scribe", [
    "script.generated", "script.qa_passed", "narration.timed", "visuals.generated",
    "visuals.story_aligned", "master.assembled",
  ], ["topic"], ["videoLocalPath", "narrationText"]),
  policyProjection("motion_comic", [
    "script.generated", "script.qa_passed", "narration.timed", "visuals.generated",
    "visuals.story_aligned", "master.assembled",
  ], ["topic"], ["videoLocalPath", "narrationText"]),
  policyProjection("lore_short", [
    "script.generated", "script.qa_passed", "narration.timed", "visuals.generated",
    "visuals.story_aligned", "master.assembled",
  ], ["topic"], ["videoLocalPath", "narrationText"]),
  policyProjection("quiz_topic_plan", [
    "topic.researched", "topic.selected", "quiz.plan_provenanced", "crew.composer_cue_sheet",
  ], [], ["topic", "quizPlan", "musicBrief"]),
  policyProjection("quiz_topic_safety", ["final.compliance_passed"], ["topic", "quizPlan"], [
    "disclosureRequired", "sensitiveTopic", "complianceNote", "quizSafety",
  ]),
  policyProjection("quiz_critic_spec", ["crew.critic_validation_spec"], ["quizPlan"], ["validationSpec"]),
  policyProjection("quiz_year", ["visuals.generated", "visuals.story_aligned", "master.assembled"], [
    "quizPlan", "quizSafety",
  ], ["videoLocalPath"]),
  policyProjection("documotion_short", [
    "narration.timed", "visuals.documentary_collage", "master.native_vertical", "master.assembled",
  ], ["topic", "beatManifest"], ["videoLocalPath"]),
];

const structuralPolicyManifestById = new Map(
  STRUCTURAL_POLICY_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

function projectRuntimeManifest(id: string): PolicyManifestProjection | undefined {
  const manifest = getManifest(id);
  if (!manifest) return undefined;
  return {
    id: manifest.id,
    certification: manifest.certification.status,
    capabilities: manifest.capabilities,
    consumes: Object.keys(manifest.consumes),
    produces: [...Object.keys(manifest.produces), ...Object.keys(manifest.optionalProduces)],
  };
}

function getPolicyManifest(
  id: string,
  source: PolicyManifestSource,
): PolicyManifestProjection | undefined {
  return source === "runtime" ? projectRuntimeManifest(id) : structuralPolicyManifestById.get(id);
}

function allPolicyManifests(source: PolicyManifestSource): readonly PolicyManifestProjection[] {
  if (source === "structural") return STRUCTURAL_POLICY_MANIFESTS;
  return allManifests().map((manifest) => ({
    id: manifest.id,
    certification: manifest.certification.status,
    capabilities: manifest.capabilities,
    consumes: Object.keys(manifest.consumes),
    produces: [...Object.keys(manifest.produces), ...Object.keys(manifest.optionalProduces)],
  }));
}

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
      "lore_short",
      "story_spine",
      "visual_matter",
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

function pipelineCapabilities(
  entries: readonly PipelineEntry[],
  source: PolicyManifestSource,
): Set<string> {
  return new Set(
    entries.flatMap((entry) => getPolicyManifest(entry.block, source)?.capabilities ?? []),
  );
}

function findArtifactProducerIndex(
  entries: readonly PipelineEntry[],
  artifact: string,
  source: PolicyManifestSource,
): number {
  return entries.findIndex((entry) => {
    const manifest = getPolicyManifest(entry.block, source);
    return Boolean(manifest?.produces.includes(artifact));
  });
}

function insertCapabilityProvider(
  entries: PipelineEntry[],
  capability: string,
  source: PolicyManifestSource,
  beforeIndex?: number,
): string | null {
  if (pipelineCapabilities(entries, source).has(capability)) return null;
  const candidates = allPolicyManifests(source)
    .filter(
      (manifest) =>
        manifest.capabilities.includes(capability) &&
        certificationRank[manifest.certification] >= certificationRank.contract &&
        !entries.some((entry) => entry.block === manifest.id),
    )
    .sort(
      (a, b) =>
        a.capabilities.length - b.capabilities.length ||
        a.produces.length - b.produces.length ||
        a.id.localeCompare(b.id),
    );
  for (const candidate of candidates) {
    const existingProduced = new Set(
      entries.flatMap((entry) => {
        return getPolicyManifest(entry.block, source)?.produces ?? [];
      }),
    );
    if (candidate.produces.some((artifact) => existingProduced.has(artifact))) continue;
    const producerIndexes = candidate.consumes.map((artifact) =>
      findArtifactProducerIndex(entries, artifact, source));
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

function producesArtifact(
  entry: PipelineEntry,
  artifact: string,
  source: PolicyManifestSource,
): boolean {
  return Boolean(getPolicyManifest(entry.block, source)?.produces.includes(artifact));
}

/**
 * A channel that can upload a master must visually review that exact master
 * before the side effect. Older/custom channel rows may predate qa_visual, so
 * insert the shared evidence-backed gate at the one safe point instead of
 * trusting every caller to remember it.
 */
function ensureReleaseVisualReview(
  entries: PipelineEntry[],
  source: PolicyManifestSource,
): boolean {
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
    // A final master always has an audience-facing audio experience. Upgrade
    // old/custom production QA in place before it can become a frozen
    // invocation; the runner must never discover this omission after render.
    entries[qaIndex] = {
      ...entries[qaIndex],
      params: {
        ...(entries[qaIndex].params ?? {}),
        ...(entries[qaIndex].params?.["qaProfile"] === undefined ? { qaProfile: "production" } : {}),
        audioQa: true,
      },
    };
    return false;
  }

  const upstream = entries.slice(0, uploadIndex);
  if (!upstream.some((entry) => producesArtifact(entry, "videoLocalPath", source))) {
    throw new PipelinePolicyError("cannot add qa_visual: upload_draft has no rendered video upstream");
  }
  if (!upstream.some((entry) => producesArtifact(entry, "thumbnailKey", source))) {
    throw new PipelinePolicyError("cannot add qa_visual: upload_draft has no thumbnail upstream");
  }
  entries.splice(uploadIndex, 0, {
    block: "qa_visual",
    params: { qaProfile: "production", audioQa: true },
  });
  return true;
}

/**
 * The package promise must be frozen before thumbnail generation spends. This
 * is not a semantic claim: final QA later binds the plan to the exact thumbnail
 * bytes and a retained opening frame, or records an explicit omission.
 */
function ensurePackageToOpeningPlan(entries: PipelineEntry[]): boolean {
  const thumbnailIndex = entries.findIndex((entry) => entry.block === "thumbnail_gen");
  if (thumbnailIndex < 0) return false;
  const planIndexes = entries
    .map((entry, index) => entry.block === "package_to_opening_plan" ? index : -1)
    .filter((index) => index >= 0);
  if (planIndexes.length > 1) {
    throw new PipelinePolicyError("package pipeline has multiple package_to_opening_plan stages");
  }
  if (planIndexes.length === 1) {
    if (planIndexes[0] > thumbnailIndex) {
      throw new PipelinePolicyError("package_to_opening_plan must run before thumbnail_gen");
    }
    return false;
  }
  const metadataIndex = entries
    .map((entry, index) =>
      (entry.block === "metadata" || entry.block === "quiz_metadata") && index < thumbnailIndex
        ? index
        : -1,
    )
    .filter((index) => index >= 0)
    .at(-1);
  if (metadataIndex === undefined) {
    throw new PipelinePolicyError(
      "cannot add package_to_opening_plan: thumbnail_gen has no upstream metadata or quiz_metadata producer",
    );
  }
  entries.splice(thumbnailIndex, 0, { block: "package_to_opening_plan" });
  return true;
}

/**
 * Deterministically fills policy/crew capability gaps using certified manifests.
 * It never invents params or replaces an implementation chosen by the designer;
 * ambiguous core engines remain a compile error.
 */
export function completePipelineForPolicy(
  source: readonly PipelineEntry[],
  options?: {
    /**
     * Render tier stamped onto a story_spine this function has to BACKFILL.
     * Omitted by every legacy-repair caller, which is why it falls back to
     * DEFAULT_GENERATION_PROFILE and reproduces the previous hardcoded value
     * byte-for-byte. designPipeline passes the channel's resolved tier so a
     * freshly designed pipeline stays internally consistent.
     */
    readonly generationProfile?: GenerationProfileId;
    /** Runtime manifests for execution; browser-safe structural catalog for read-only previews. */
    readonly manifestSource?: PolicyManifestSource;
  },
): { entries: PipelineEntry[]; inserted: string[]; retired: string[] } {
  const generationProfileId = options?.generationProfile ?? DEFAULT_GENERATION_PROFILE;
  const manifestSource = options?.manifestSource ?? "runtime";
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
        generationProfile: generationProfileId,
        targetShotSec: isShorts ? 4 : 6,
      },
    });
    inserted.push("story_spine");
  }

  for (const capability of ["topic.researched", "final.compliance_passed"]) {
    const moduleId = insertCapabilityProvider(entries, capability, manifestSource);
    if (moduleId) inserted.push(moduleId);
  }
  if (pipelineCapabilities(entries, manifestSource).has("script.generated")) {
    const moduleId = insertCapabilityProvider(entries, "script.qa_passed", manifestSource);
    if (moduleId) inserted.push(moduleId);
  }

  if (ensurePackageToOpeningPlan(entries)) {
    inserted.push("package_to_opening_plan");
  }

  if (ensureReleaseVisualReview(entries, manifestSource)) {
    inserted.push("qa_visual");
  }

  for (const binding of CREW_ARTIFACT_BINDINGS) {
    const consumerIndex = entries.findIndex((entry) => binding.consumerIds.includes(entry.block));
    if (
      consumerIndex < 0 ||
      findArtifactProducerIndex(entries, binding.artifact, manifestSource) >= 0
    ) continue;
    const moduleId = insertCapabilityProvider(
      entries,
      binding.capability,
      manifestSource,
      consumerIndex,
    );
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

/**
 * A module contract that declares `publish.private_only` (every Casefile
 * source/evidence/cinematic-signing admission module, the children curriculum
 * seed, the children show bible, and the child-content safety receipt) is
 * asserting that this content may only ever surface as a private,
 * human-reviewed draft — never an automatic or channel-approved public
 * release. This is a fail-closed pipeline-graph guarantee, not a per-block
 * default: it must hold regardless of family/lane naming, regardless of
 * `approvedForPublish` (validatePublicationApproval, above), and regardless
 * of a channel's `approvalMode` schedule setting
 * (src/lib/publishingPolicy.ts) — none of those may ever satisfy it.
 */
const PRIVATE_ONLY_CAPABILITY = "publish.private_only";

interface PublicPublishAttemptSpec {
  block: string;
  isPublicAttempt: (params: Readonly<Record<string, unknown>>) => boolean;
}

/**
 * Every pipeline block capable of an actual external/public side effect,
 * paired with the exact param shape that means "this call leaves
 * draft/private". Kept in lockstep with channelPublishConfiguration()'s
 * block/action mapping (src/lib/channelPublishPolicy.ts) and with
 * validatePublicationApproval() above.
 */
const PUBLIC_PUBLISH_ATTEMPTS: readonly PublicPublishAttemptSpec[] = [
  {
    block: "upload_draft",
    isPublicAttempt: (params) => {
      const mode = String(params["publishMode"] ?? "draft");
      return mode === "public" || mode === "scheduled";
    },
  },
  {
    block: "shorts_spinoff",
    isPublicAttempt: (params) =>
      params["publishShort"] === "public" || params["crosspostShort"] === true,
  },
  // crosspost has exactly one capability, `publish.crossposted`: its mere
  // presence in the graph is itself the public side effect, with no private
  // mode to opt out of.
  { block: "crosspost", isPublicAttempt: () => true },
];

/**
 * Fail-closed guard for `publish.private_only`. `capabilities` is the
 * pipeline's fully-aggregated capability set (every module's manifest,
 * regardless of position), so a single Casefile/children-safety admission
 * module anywhere in the graph poisons the whole compiled run: no
 * `upload_draft` / `shorts_spinoff` / `crosspost` entry may attempt a
 * public, scheduled, or crossposted release. Unlike `validatePublicationApproval`,
 * this check is deliberately NOT satisfiable by any param (there is no
 * `approvedForPublish`-shaped escape hatch here) and runs independently of
 * the channel's `approvalMode` setting, which this compiler never reads.
 */
function enforcePrivateOnlyPublication(
  entries: readonly PipelineEntry[],
  capabilities: ReadonlySet<string>,
): void {
  if (!capabilities.has(PRIVATE_ONLY_CAPABILITY)) return;
  for (const entry of entries) {
    const spec = PUBLIC_PUBLISH_ATTEMPTS.find((candidate) => candidate.block === entry.block);
    if (!spec) continue;
    const params = (entry.params ?? {}) as Record<string, unknown>;
    if (spec.isPublicAttempt(params)) {
      throw new PipelinePolicyError(
        `pipeline declares capability "${PRIVATE_ONLY_CAPABILITY}" (a private-only admission module is present), so "${entry.block}" may never leave a private draft; public/scheduled/crosspost publish attempts are rejected regardless of approvedForPublish or the channel's approvalMode setting`,
      );
    }
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

  // Worked-example arithmetic is registered for controlled private review,
  // but its decoded-clock/native-render/natural-speech qualification is still
  // held. Keep it out of ordinary production compilation even though the
  // Golden registry now has an auditable private-release owner for the ABI.
  if (capabilities.has("learning.worked_example_held")) {
    throw new PipelinePolicyError(
      "worked-example modules are registered private-review foundations only; decoded narration, native renderer, and editorial qualification are still held",
    );
  }

  for (const capability of policy.requiredCapabilities) requireCapability(capabilities, capability);

  enforcePrivateOnlyPublication(resolved.entries, capabilities);

  if (capabilities.has("script.generated")) {
    requireCapability(capabilities, "script.qa_passed", "a script-producing pipeline must certify its script");
    requireCapability(capabilities, "narration.timed", "a script-producing pipeline must produce timed narration");
    requireCapability(
      capabilities,
      "final.lexical_script_self_dedup_passed",
      "a script-producing pipeline must pass measured local script self-dedup",
    );
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
