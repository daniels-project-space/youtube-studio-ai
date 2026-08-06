import { z } from "zod";
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
  loreshort: { kind: "catalog-only", executableIds: [], note: "Standalone library; pipeline adapter pending." },
  "novita-render-farm": { kind: "pipeline-module", executableIds: ["novita_render_images", "novita_render_video"] },
  "imagecraft-novita": { kind: "pipeline-module", executableIds: ["novita_render_images"] },
  "videocraft-novita": { kind: "pipeline-module", executableIds: ["novita_render_video"] },
  lofi: { kind: "pipeline-module", executableIds: ["scene_planner", "keyframes", "loop_clips", "upscale", "assemble"] },
  quiz: { kind: "catalog-only", executableIds: [], note: "Proof engine is not registered in the production runner." },
  thumbnail: { kind: "pipeline-module", executableIds: ["thumbnail_gen"] },
  "topic-intel": { kind: "pipeline-module", executableIds: ["competitor_research", "topic_select"] },
  "show-bible": {
    kind: "pipeline-module",
    executableIds: ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"],
  },
  script: { kind: "pipeline-module", executableIds: ["script_gen", "hook_craft", "qa_script"] },
  guard: { kind: "pipeline-module", executableIds: ["originality_gate", "compliance_check"] },
  narration: { kind: "pipeline-module", executableIds: ["narration_tts"] },
  visuals: { kind: "pipeline-module", executableIds: ["stock_footage", "entity_imagery", "gen_footage", "signature_clips"] },
  cinematic: { kind: "catalog-only", executableIds: [], note: "Cinecraft exists as a library; the family remains unavailable." },
  documotion: { kind: "catalog-only", executableIds: [], note: "Standalone library; no production block manifest." },
  motioncraft: { kind: "pipeline-module", executableIds: ["visual_inserts"], note: "Only the registered insert layer is compiler-visible." },
  "speech-tv": { kind: "catalog-only", executableIds: [], note: "Proof composition is not a production pipeline module." },
  inserts: { kind: "pipeline-module", executableIds: ["visual_inserts"] },
  layer: { kind: "pipeline-module", executableIds: ["intro_card", "quote_overlays", "captions"] },
  assemble: { kind: "pipeline-module", executableIds: ["timeline_assemble", "assemble"] },
  metadata: { kind: "pipeline-module", executableIds: ["metadata"] },
  verify: { kind: "pipeline-module", executableIds: ["length_check", "qa_visual", "qa_refine"] },
  whiteboard: { kind: "pipeline-module", executableIds: ["whiteboard_scribe"] },
  comic: { kind: "pipeline-module", executableIds: ["motion_comic"] },
  ship: { kind: "pipeline-module", executableIds: ["upload_draft", "shorts_spinoff", "crosspost", "notify"] },
  "channel-planner": { kind: "external-task", executableIds: ["plan-week-ahead"], note: "Executable Trigger task, outside the module ABI." },
  shorts: { kind: "pipeline-module", executableIds: ["shorts_spinoff"] },
};

/**
 * No catalog proof is silently grandfathered. Add a receipt here only after an
 * operator-approved render and its immutable evidence are available.
 */
export const GOLDEN_PROMOTION_PROOFS: Readonly<Partial<Record<string, GoldenPromotionProof>>> = {};

export function catalogExecutionBinding(key: string): CatalogExecutionBinding {
  return CATALOG_EXECUTION_BINDINGS[key] ?? {
    kind: "catalog-only",
    executableIds: [],
    note: "No executable binding declared.",
  };
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
