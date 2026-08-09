import { z } from "zod";
import { CHANNEL_INCEPTION_MODULE_CONTRACTS } from "./channelInceptionContracts";
import { GOLDEN_MODULES, type GoldenModule } from "./golden";
import type { ModuleManifest } from "./moduleManifest";

export interface CatalogExecutionBinding {
  kind: "pipeline-module" | "external-task" | "catalog-only";
  executableIds: readonly string[];
  note?: string;
}

export const GoldenPromotionProofSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  catalogKey: z.string().min(1),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  executableIds: z.array(z.string().min(1)).min(1),
  moduleVersions: z.record(z.string(), z.string().min(1)),
  verifiedAt: z.string().datetime(),
  testCommand: z.string().min(1),
  operatorApproval: z.object({
    approved: z.literal(true),
    actor: z.string().min(1),
    evidence: z.string().min(1),
  }),
  gates: z.array(z.object({
    gate: z.string().min(1),
    passed: z.literal(true),
    evidence: z.string().min(1),
  })).min(1),
}).strict();

export type GoldenPromotionProof = z.infer<typeof GoldenPromotionProofSchema>;

export interface GoldenPromotionDecision {
  promoted: boolean;
  catalogKey: string;
  executableIds: readonly string[];
  blockers: readonly string[];
}

export type CatalogStepQualification =
  | "catalog-mapped"
  | "reference-executable"
  | "equivalence-proven";

export interface ReferenceExecutableProvenance {
  catalogKey: string;
  callerFile: string;
  callerSymbol: string;
  referenceFile: string;
  referenceSymbol: string;
}

/** One selected executable, mapped honestly to its editorial catalog owner. */
export interface CatalogExecutionStep {
  sequence: number;
  stage: string;
  catalogKey: string;
  catalogTitle: string;
  catalogStatus: GoldenModule["status"];
  executableId: string;
  executableVersion: string;
  certification: ModuleManifest["certification"]["status"];
  capabilities: readonly string[];
  qualification: CatalogStepQualification;
  goldenQualified: boolean;
  qualificationBlockers: readonly string[];
  sourceProvenance?: ReferenceExecutableProvenance;
}

/**
 * The only approved AI-video render route. Local deterministic composition
 * (FFmpeg/Python/Remotion) does not require this binding; provider-generated
 * motion does. Infrastructure must satisfy this contract before strict rollout.
 */
export const NOVITA_GPU_VIDEO_RENDER_BINDING = {
  id: "novita-gpu-zimage-ltx-v1",
  catalogKey: "novita-render-farm",
  providerExecutableIds: ["novita_render_images", "novita_render_video"] as const,
  requiredChain: ["novita_render_images", "qa_assets", "novita_render_video", "qa_shots"] as const,
  specializedChains: [
    ["keyframes", "loop_clips"],
    ["gen_footage"],
    ["signature_clips"],
  ] as const,
  legacyProviderExecutableIds: [] as const,
  imageModel: "Tongyi-MAI/Z-Image-Turbo",
  imageStorage: "local-persistent-disk",
  videoModel: "Lightricks/LTX-2.3@7caa482d5cd10a2eae6b34cb48f093ebc45a263e",
  productionPipeline: "two-stage-hq",
  elasticGpuCeiling: 8,
} as const;

export interface NovitaVideoRenderAssessment {
  bindingId: typeof NOVITA_GPU_VIDEO_RENDER_BINDING.id;
  required: boolean;
  compliant: boolean;
  selectedProviderExecutables: readonly string[];
  violations: readonly string[];
}

export class GoldenPromotionError extends Error {
  readonly blockers: readonly string[];

  constructor(catalogKey: string, blockers: readonly string[]) {
    super(`catalog module "${catalogKey}" is not production-Golden: ${blockers.join("; ")}`);
    this.name = "GoldenPromotionError";
    this.blockers = blockers;
  }
}

/**
 * Honest bridge from the product catalog to executable policy. Entries without
 * a registered ModuleManifest are visibly catalog-only; an editorial reference
 * flag can no longer imply that the compiler can execute or promote it.
 */
export const CATALOG_EXECUTION_BINDINGS: Readonly<Record<string, CatalogExecutionBinding>> = {
  ...Object.fromEntries(
    CHANNEL_INCEPTION_MODULE_CONTRACTS.map((contract) => [
      contract.key,
      {
        kind: "catalog-only" as const,
        executableIds: [],
        note: `Channel Inception ${contract.version} contract only; resumable executor and proof receipt are not bound.`,
      },
    ]),
  ),
  loreshort: { kind: "catalog-only", executableIds: [], note: "Standalone library; pipeline adapter pending." },
  "novita-render-farm": { kind: "pipeline-module", executableIds: ["novita_render_images", "novita_render_video"] },
  "imagecraft-novita": { kind: "catalog-only", executableIds: [], note: "Reference engine is executed through the Novita render-farm module." },
  "videocraft-novita": { kind: "catalog-only", executableIds: [], note: "Reference engine is executed through the Novita render-farm module." },
  lofi: { kind: "pipeline-module", executableIds: ["scene_planner", "keyframes", "loop_clips", "upscale", "assemble"] },
  quiz: { kind: "catalog-only", executableIds: [], note: "Proof engine is not registered in the production runner." },
  thumbnail: { kind: "pipeline-module", executableIds: ["thumbnail_gen"] },
  "topic-intel": { kind: "pipeline-module", executableIds: ["competitor_research", "topic_select"] },
  "show-bible": {
    kind: "pipeline-module",
    executableIds: ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec", "story_spine"],
  },
  script: { kind: "pipeline-module", executableIds: ["script_gen", "hook_craft"] },
  guard: { kind: "pipeline-module", executableIds: ["qa_script", "originality_gate", "compliance_check"] },
  narration: { kind: "pipeline-module", executableIds: ["narration_tts"] },
  music: { kind: "pipeline-module", executableIds: ["music"] },
  visuals: { kind: "pipeline-module", executableIds: ["stock_footage", "entity_imagery", "gen_footage", "signature_clips"] },
  // Cinematic is the editorial composition of the Novita render-farm modules.
  // The render modules retain their single catalog owner below, so this entry
  // must not duplicate them or claim a separate executable ABI.
  cinematic: {
    kind: "catalog-only",
    executableIds: [],
    note: "Cinematic channels execute the enforced Z-Image → QA → LTX → QA chain owned by novita-render-farm; a frozen spend ceiling and Golden proof receipt are both required before promotion.",
  },
  documotion: {
    kind: "pipeline-module",
    executableIds: ["short_strategy", "documotion_short"],
    note: "Native 9:16 documentary-collage lane; direct Short uploads remain private-first through upload_draft.",
  },
  motioncraft: { kind: "catalog-only", executableIds: [], note: "Standalone library; the production data-viz subset is owned by Inserts." },
  "speech-tv": { kind: "catalog-only", executableIds: [], note: "Proof composition is not a production pipeline module." },
  inserts: { kind: "pipeline-module", executableIds: ["visual_inserts"] },
  layer: { kind: "pipeline-module", executableIds: ["intro_card", "quote_overlays", "captions"] },
  assemble: { kind: "pipeline-module", executableIds: ["timeline_assemble"] },
  metadata: { kind: "pipeline-module", executableIds: ["metadata"] },
  verify: { kind: "pipeline-module", executableIds: ["qa_assets", "qa_shots", "short_scene_qa", "length_check", "qa_visual"] },
  whiteboard: { kind: "pipeline-module", executableIds: ["whiteboard_scribe"] },
  comic: { kind: "pipeline-module", executableIds: ["motion_comic"] },
  ship: { kind: "pipeline-module", executableIds: ["upload_draft", "crosspost", "notify", "emit_bundle", "cleanup"] },
  "channel-planner": { kind: "external-task", executableIds: ["plan-week-ahead"], note: "Executable Trigger task, outside the module ABI." },
  shorts: {
    kind: "pipeline-module",
    // Candidate mining is planning-only: it identifies full-documentary windows
    // for a later, freshly rendered native Short and never crops or publishes.
    executableIds: ["shorts_spinoff", "documentary_short_candidates"],
  },
};

/**
 * No catalog proof is silently grandfathered. Add a receipt here only after an
 * operator-approved render and its immutable evidence are available.
 */
export const GOLDEN_PROMOTION_PROOFS: Readonly<Partial<Record<string, GoldenPromotionProof>>> = {};

/**
 * Direct source-symbol provenance, limited to registered blocks that actually
 * call the named catalog reference engine. A catalog owner mapping alone is
 * intentionally absent from this table and never earns this qualification.
 */
export const REFERENCE_EXECUTABLE_PROVENANCE: Readonly<
  Record<string, ReferenceExecutableProvenance>
> = {
  novita_render_images: {
    catalogKey: "novita-render-farm",
    callerFile: "src/trigger/blocks/novitaRenderBlocks.ts",
    callerSymbol: "novitaRenderImages.run",
    referenceFile: "src/lib/novitaRenderFarm.ts",
    referenceSymbol: "renderImages",
  },
  novita_render_video: {
    catalogKey: "novita-render-farm",
    callerFile: "src/trigger/blocks/novitaRenderBlocks.ts",
    callerSymbol: "novitaRenderVideo.run",
    referenceFile: "src/lib/novitaRenderFarm.ts",
    referenceSymbol: "renderVideo",
  },
  thumbnail_gen: {
    catalogKey: "thumbnail",
    callerFile: "src/trigger/blocks/intelligenceBlocks.ts",
    callerSymbol: "thumbnailGen.run",
    referenceFile: "src/lib/thumbnailLab.ts",
    referenceSymbol: "renderCandidate",
  },
  whiteboard_scribe: {
    catalogKey: "whiteboard",
    callerFile: "src/trigger/blocks/whiteboardScribeBlocks.ts",
    callerSymbol: "whiteboardScribe.run",
    referenceFile: "src/lib/whiteboardSync.ts",
    referenceSymbol: "castWhiteboardSync",
  },
  motion_comic: {
    catalogKey: "comic",
    callerFile: "src/trigger/blocks/motionComicBlocks.ts",
    callerSymbol: "motionComicBlock.run",
    referenceFile: "src/lib/motionComic.ts",
    referenceSymbol: "castMotionComic",
  },
};

export function catalogExecutionBinding(key: string): CatalogExecutionBinding {
  return CATALOG_EXECUTION_BINDINGS[key] ?? {
    kind: "catalog-only",
    executableIds: [],
    note: "No executable binding declared.",
  };
}

function executableCatalogOwners(): ReadonlyMap<string, GoldenModule> {
  const modulesByKey = new Map(GOLDEN_MODULES.map((module) => [module.key, module]));
  const owners = new Map<string, GoldenModule>();
  for (const [catalogKey, binding] of Object.entries(CATALOG_EXECUTION_BINDINGS)) {
    if (binding.kind !== "pipeline-module") continue;
    const catalogModule = modulesByKey.get(catalogKey);
    if (!catalogModule) throw new Error(`execution binding references missing catalog module "${catalogKey}"`);
    for (const executableId of binding.executableIds) {
      const prior = owners.get(executableId);
      if (prior) {
        throw new Error(
          `executable module "${executableId}" has multiple catalog owners: ${prior.key}, ${catalogKey}`,
        );
      }
      owners.set(executableId, catalogModule);
    }
  }
  return owners;
}

/** Map the exact selected manifests without claiming reference equivalence. */
export function compileCatalogExecutionFlow(
  manifests: readonly ModuleManifest[],
): readonly CatalogExecutionStep[] {
  const owners = executableCatalogOwners();
  return manifests.map((manifest, sequence) => {
    const catalogModule = owners.get(manifest.id);
    if (!catalogModule) {
      throw new Error(`executable module "${manifest.id}" has no catalog binding`);
    }
    const promotion = assessGoldenPromotion({
      module: catalogModule,
      manifests,
      proof: GOLDEN_PROMOTION_PROOFS[catalogModule.key],
    });
    const provenance = REFERENCE_EXECUTABLE_PROVENANCE[manifest.id];
    const directReference = provenance?.catalogKey === catalogModule.key ? provenance : undefined;
    const goldenQualified = promotion.promoted && promotion.executableIds.includes(manifest.id);
    const qualification: CatalogStepQualification = goldenQualified
      ? "equivalence-proven"
      : directReference
        ? "reference-executable"
        : "catalog-mapped";
    return {
      sequence,
      stage: catalogModule.stage,
      catalogKey: catalogModule.key,
      catalogTitle: catalogModule.title,
      catalogStatus: catalogModule.status,
      executableId: manifest.id,
      executableVersion: manifest.version,
      certification: manifest.certification.status,
      capabilities: manifest.capabilities,
      qualification,
      goldenQualified,
      qualificationBlockers: goldenQualified
        ? []
        : directReference
          ? ["direct reference call is not an approved equivalence proof"]
          : ["catalog owner only; no direct reference call or approved equivalence proof"],
      ...(directReference ? { sourceProvenance: directReference } : {}),
    };
  });
}

/**
 * Strict Golden selection is separate from ordinary production compilation.
 * It rejects catalog mapping and direct-call provenance unless every selected
 * step has an approved immutable equivalence proof.
 */
export function compileGoldenExecutionFlow(
  manifests: readonly ModuleManifest[],
): readonly CatalogExecutionStep[] {
  const steps = compileCatalogExecutionFlow(manifests);
  const unqualified = steps.filter((step) => !step.goldenQualified);
  if (unqualified.length) {
    throw new Error(
      `selected flow is not Golden-qualified: ${unqualified
        .map((step) => `${step.executableId}=${step.qualification}`)
        .join(", ")}`,
    );
  }
  return steps;
}

/** Audit an exact selected manifest list without adding or replacing modules. */
export function assessNovitaVideoRenderBinding(
  manifests: readonly ModuleManifest[],
): NovitaVideoRenderAssessment {
  const ids = manifests.map((manifest) => manifest.id);
  const providerCandidates = new Set<string>([
    ...NOVITA_GPU_VIDEO_RENDER_BINDING.providerExecutableIds,
    ...NOVITA_GPU_VIDEO_RENDER_BINDING.specializedChains.flatMap((chain) => chain),
    ...NOVITA_GPU_VIDEO_RENDER_BINDING.legacyProviderExecutableIds,
  ]);
  const selectedProviderExecutables = ids.filter((id) => providerCandidates.has(id));
  if (!selectedProviderExecutables.length) {
    return {
      bindingId: NOVITA_GPU_VIDEO_RENDER_BINDING.id,
      required: false,
      compliant: true,
      selectedProviderExecutables: [],
      violations: [],
    };
  }

  const violations: string[] = [];
  for (const legacyId of NOVITA_GPU_VIDEO_RENDER_BINDING.legacyProviderExecutableIds) {
    if (ids.includes(legacyId)) {
      violations.push(`${legacyId} is a legacy provider-video route; ${NOVITA_GPU_VIDEO_RENDER_BINDING.id} is required`);
    }
  }
  const selectedSpecializedChains = NOVITA_GPU_VIDEO_RENDER_BINDING.specializedChains.filter((chain) =>
    chain.some((id) => ids.includes(id)),
  );
  const selectedStandard = NOVITA_GPU_VIDEO_RENDER_BINDING.providerExecutableIds.some((id) => ids.includes(id));
  if (selectedSpecializedChains.length && selectedStandard) {
    violations.push("specialized and standard Novita video-render chains must not be mixed");
  }
  for (const chain of selectedSpecializedChains) {
    const indexes = chain.map((id) => ids.indexOf(id));
    for (let index = 0; index < chain.length; index++) {
      const id = chain[index];
      if (indexes[index] < 0) violations.push(`required specialized Novita render module is missing: ${id}`);
      if (ids.filter((candidate) => candidate === id).length > 1) {
        violations.push(`specialized Novita render module is duplicated: ${id}`);
      }
    }
    if (indexes.every((index) => index >= 0)) {
      for (let index = 1; index < indexes.length; index++) {
        if (indexes[index] <= indexes[index - 1]) {
          violations.push(`specialized Novita render chain is out of order at ${chain[index]}`);
          break;
        }
      }
    }
  }
  const chainIndexes = NOVITA_GPU_VIDEO_RENDER_BINDING.requiredChain.map((id) => ids.indexOf(id));
  if (selectedStandard) {
    for (let index = 0; index < NOVITA_GPU_VIDEO_RENDER_BINDING.requiredChain.length; index++) {
      const id = NOVITA_GPU_VIDEO_RENDER_BINDING.requiredChain[index];
      if (chainIndexes[index] < 0) violations.push(`required Novita render-chain module is missing: ${id}`);
      if (ids.filter((candidate) => candidate === id).length > 1) {
        violations.push(`required Novita render-chain module is duplicated: ${id}`);
      }
    }
    if (chainIndexes.every((index) => index >= 0)) {
      for (let index = 1; index < chainIndexes.length; index++) {
        if (chainIndexes[index] <= chainIndexes[index - 1]) {
          violations.push(`Novita render chain is out of order at ${NOVITA_GPU_VIDEO_RENDER_BINDING.requiredChain[index]}`);
          break;
        }
      }
    }
  }
  return {
    bindingId: NOVITA_GPU_VIDEO_RENDER_BINDING.id,
    required: true,
    compliant: violations.length === 0,
    selectedProviderExecutables,
    violations,
  };
}

/** Strict admission gate for new/converted AI-video pipelines. */
export function assertNovitaVideoRenderBinding(manifests: readonly ModuleManifest[]): void {
  const assessment = assessNovitaVideoRenderBinding(manifests);
  if (!assessment.compliant) {
    throw new Error(`AI-video render binding rejected: ${assessment.violations.join("; ")}`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assessGoldenPromotion(args: {
  module: GoldenModule;
  manifests: readonly ModuleManifest[];
  proof?: unknown;
}): GoldenPromotionDecision {
  const binding = catalogExecutionBinding(args.module.key);
  const blockers: string[] = [];
  const manifestsById = new Map(args.manifests.map((manifest) => [manifest.id, manifest]));
  const boundManifests = binding.executableIds
    .map((id) => manifestsById.get(id))
    .filter((manifest): manifest is ModuleManifest => Boolean(manifest));

  if (args.module.status !== "reference") {
    blockers.push("catalog entry is not even a reference candidate");
  }
  if (binding.kind !== "pipeline-module") {
    blockers.push(`execution binding is ${binding.kind}, not a registered pipeline module`);
  }
  if (!binding.executableIds.length) blockers.push("execution binding has no module ids");
  for (const id of binding.executableIds) {
    const manifest = manifestsById.get(id);
    if (!manifest) {
      blockers.push(`registered manifest missing for ${id}`);
      continue;
    }
    if (manifest.certification.status !== "golden") {
      blockers.push(`${id} is ${manifest.certification.status}-certified, not golden-certified`);
    }
  }
  if (
    boundManifests.length > 0 &&
    !boundManifests.some((manifest) => manifest.qualityContract.required && manifest.qualityContract.failClosed)
  ) {
    blockers.push("bound module set has no required fail-closed quality contract");
  }

  const parsed = GoldenPromotionProofSchema.safeParse(args.proof);
  if (!parsed.success) {
    blockers.push("machine-readable promotion proof is missing or invalid");
  } else {
    const proof = parsed.data;
    if (proof.catalogKey !== args.module.key) blockers.push("proof catalog key does not match");
    if (!sameStrings(proof.executableIds, [...binding.executableIds])) {
      blockers.push("proof executable ids do not exactly match the binding");
    }
    for (const manifest of boundManifests) {
      if (proof.moduleVersions[manifest.id] !== manifest.version) {
        blockers.push(`proof version does not match ${manifest.id}@${manifest.version}`);
      }
    }
    const expectedVersionKeys = [...binding.executableIds].sort();
    const actualVersionKeys = Object.keys(proof.moduleVersions).sort();
    if (!sameStrings(actualVersionKeys, expectedVersionKeys)) {
      blockers.push("proof module-version set does not exactly match the binding");
    }
    const proofGateNames = proof.gates.map((gate) => gate.gate);
    if (new Set(proofGateNames).size !== proofGateNames.length) {
      blockers.push("proof contains duplicate gate verdicts");
    }
    for (const gate of args.module.gates) {
      if (!proofGateNames.includes(gate)) blockers.push(`proof is missing gate: ${gate}`);
    }
    for (const gate of proofGateNames) {
      if (!args.module.gates.includes(gate)) blockers.push(`proof contains undeclared gate: ${gate}`);
    }
  }

  return {
    promoted: blockers.length === 0,
    catalogKey: args.module.key,
    executableIds: binding.executableIds,
    blockers,
  };
}

export function selectGoldenProductionModules(
  catalogKey: string,
  manifests: readonly ModuleManifest[],
  proof: unknown = GOLDEN_PROMOTION_PROOFS[catalogKey],
): readonly ModuleManifest[] {
  const catalogModule = GOLDEN_MODULES.find((candidate) => candidate.key === catalogKey);
  if (!catalogModule) throw new GoldenPromotionError(catalogKey, ["catalog entry does not exist"]);
  const decision = assessGoldenPromotion({ module: catalogModule, manifests, proof });
  if (!decision.promoted) throw new GoldenPromotionError(catalogKey, decision.blockers);
  const manifestsById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  return decision.executableIds.map((id) => manifestsById.get(id)!);
}
