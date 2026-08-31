/**
 * Shared visual-sequence lineage.
 *
 * This module deliberately separates three different facts that were easy to
 * conflate in renderer-specific code:
 *
 * - a renderer receipt says which durable clip key was selected;
 * - a captured artifact manifest says which exact bytes were observed for it;
 * - a final-master ledger says which master and visual-review bytes were
 *   reviewed.
 *
 * A key-only receipt is never upgraded into a byte claim. Likewise, this
 * V1 byte claim is explicitly capture-time local evidence, not a claim that
 * an R2 key still has those bytes after capture or cleanup.
 *
 * ledger intentionally carries assemblyBinding: "unmeasured" until the
 * assembler emits an exact raw-clip-to-master receipt. It is provenance, not
 * a release/readiness/publish authorization.
 */
import { z } from "zod";

import { assertCinematicSequenceRenderBinding } from "@/engine/cinematicSequenceRenderBinding";
import {
  ShotRenderManifestSchema,
  validateQualifiedShotRender,
} from "@/engine/renderArtifacts";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const VISUAL_SEQUENCE_ARTIFACT_MANIFEST_VERSION =
  "visual-sequence-artifact-manifest/v1" as const;
export const VISUAL_SEQUENCE_CONTRACT_VERSION =
  "visual-sequence-contract/v1" as const;
export const VISUAL_SEQUENCE_EVIDENCE_LEDGER_VERSION =
  "visual-sequence-evidence-ledger/v1" as const;
export const VISUAL_SEQUENCE_ARTIFACT_OBJECT_VERIFICATION_VERSION =
  "visual-sequence-artifact-object-verification/v1" as const;
export const VISUAL_SEQUENCE_EVIDENCE_OMISSION_VERSION =
  "visual-sequence-evidence-omission/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const identifier = z.string().trim().min(1).max(160);
const objectKey = z.string().trim().min(1).max(1_500);
const finite = z.number().finite();
const positiveByteLength = z.number().int().positive();

const visualSequenceArtifactItemSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  id: identifier,
  r2Key: objectKey,
  sha256,
  byteLength: positiveByteLength,
}).strict();

function assertUnique<T>(
  values: readonly T[],
  label: string,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  const seen = new Set<T>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: "visual sequence contains duplicate " + label,
      });
    }
    seen.add(value);
  });
}

export const VisualSequenceArtifactManifestSchema = z.object({
  version: z.literal(VISUAL_SEQUENCE_ARTIFACT_MANIFEST_VERSION),
  source: z.enum(["standard_novita", "casefile_cinematic"]),
  sequenceFingerprint: sha256,
  /**
   * V1 is emitted from the accepted file already downloaded for QA. It does
   * not say that the mutable storage key remains byte-identical later.
   */
  captureScope: z.literal("local_post_qa"),
  objectDurability: z.literal("not_reverified"),
  exactOrder: z.literal(true),
  items: z.array(visualSequenceArtifactItemSchema).min(1).max(2_000),
  manifestFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  assertUnique(value.items.map((item) => item.id), "artifact id", ctx, ["items"]);
  const integrityByKey = new Map<string, { sha256: string; byteLength: number }>();
  value.items.forEach((item, index) => {
    if (item.ordinal !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "ordinal"],
        message: "artifact ordinals must preserve exact contiguous sequence order",
      });
    }
    const prior = integrityByKey.get(item.r2Key);
    if (
      prior &&
      (prior.sha256.toLowerCase() !== item.sha256.toLowerCase() ||
        prior.byteLength !== item.byteLength)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index],
        message: "reused artifact storage keys must retain identical captured bytes",
      });
    }
    integrityByKey.set(item.r2Key, {
      sha256: item.sha256,
      byteLength: item.byteLength,
    });
  });
});

export type VisualSequenceArtifactManifest = z.infer<
  typeof VisualSequenceArtifactManifestSchema
>;

export interface VisualSequenceArtifactManifestInput {
  source: VisualSequenceArtifactManifest["source"];
  sequenceFingerprint: string;
  items: ReadonlyArray<{
    id: string;
    r2Key: string;
    sha256: string;
    byteLength: number;
  }>;
}

export function visualSequenceArtifactManifestFingerprint(
  value: Omit<VisualSequenceArtifactManifest, "manifestFingerprint">,
): string {
  return sha256Hex(canonicalJson(value));
}

export function assertVisualSequenceArtifactManifest(
  value: unknown,
): VisualSequenceArtifactManifest {
  const manifest = VisualSequenceArtifactManifestSchema.parse(value);
  const { manifestFingerprint, ...unsigned } = manifest;
  if (manifestFingerprint !== visualSequenceArtifactManifestFingerprint(unsigned)) {
    throw new Error(
      "visual-sequence artifact manifest fingerprint does not match its canonical payload",
    );
  }
  return manifest;
}

export function createVisualSequenceArtifactManifest(
  input: VisualSequenceArtifactManifestInput,
): VisualSequenceArtifactManifest {
  const unsigned = {
    version: VISUAL_SEQUENCE_ARTIFACT_MANIFEST_VERSION,
    source: input.source,
    sequenceFingerprint: input.sequenceFingerprint,
    captureScope: "local_post_qa",
    objectDurability: "not_reverified",
    exactOrder: true,
    items: input.items.map((item, ordinal) => ({
      ordinal,
      id: item.id,
      r2Key: item.r2Key,
      sha256: item.sha256,
      byteLength: item.byteLength,
    })),
  } satisfies Omit<VisualSequenceArtifactManifest, "manifestFingerprint">;
  return assertVisualSequenceArtifactManifest({
    ...unsigned,
    manifestFingerprint: visualSequenceArtifactManifestFingerprint(unsigned),
  });
}

/**
 * Runtime callers supply local file integrity explicitly. This helper has no
 * storage/provider dependency, which makes it impossible for capture itself
 * to add an R2 or model request.
 */
export async function captureLocalVisualSequenceArtifactManifest(args: {
  source: VisualSequenceArtifactManifest["source"];
  sequenceFingerprint: string;
  items: ReadonlyArray<{ id: string; r2Key: string; localPath: string }>;
  getLocalFileIntegrity: (
    localPath: string,
  ) => Promise<{ sha256: string; byteLength: number }>;
}): Promise<VisualSequenceArtifactManifest> {
  const captured: Array<{
    id: string;
    r2Key: string;
    sha256: string;
    byteLength: number;
  }> = [];
  for (const item of args.items) {
    const integrity = await args.getLocalFileIntegrity(item.localPath);
    captured.push({
      id: item.id,
      r2Key: item.r2Key,
      sha256: integrity.sha256,
      byteLength: integrity.byteLength,
    });
  }
  return createVisualSequenceArtifactManifest({
    source: args.source,
    sequenceFingerprint: args.sequenceFingerprint,
    items: captured,
  });
}

/**
 * This verifier is deliberately opt-in. The ledger does not claim that a
 * mutable key is still current merely because it was byte-bound at local QA
 * capture. Calling this function is the only supported V1 way to make a
 * current-object assertion, and the returned receipt is scoped to that check.
 */
export const VisualSequenceArtifactObjectVerificationSchema = z.object({
  version: z.literal(VISUAL_SEQUENCE_ARTIFACT_OBJECT_VERIFICATION_VERSION),
  manifestFingerprint: sha256,
  verificationScope: z.literal("current_object_bytes_at_check"),
  objectDurability: z.literal("verified_at_check_only"),
  checkedObjectCount: z.number().int().positive(),
  verificationFingerprint: sha256,
}).strict();

export type VisualSequenceArtifactObjectVerification = z.infer<
  typeof VisualSequenceArtifactObjectVerificationSchema
>;

function visualSequenceArtifactObjectVerificationFingerprint(
  value: Omit<VisualSequenceArtifactObjectVerification, "verificationFingerprint">,
): string {
  return sha256Hex(canonicalJson(value));
}

export async function verifyVisualSequenceArtifactManifestObjects(args: {
  manifest: unknown;
  getObjectIntegrity: (
    r2Key: string,
  ) => Promise<{ sha256: string; byteLength: number }>;
}): Promise<VisualSequenceArtifactObjectVerification> {
  const manifest = assertVisualSequenceArtifactManifest(args.manifest);
  const observed = new Map<string, { sha256: string; byteLength: number }>();
  for (const item of manifest.items) {
    let actual = observed.get(item.r2Key);
    if (!actual) {
      actual = await args.getObjectIntegrity(item.r2Key);
      observed.set(item.r2Key, actual);
    }
    if (
      actual.sha256.toLowerCase() !== item.sha256.toLowerCase() ||
      actual.byteLength !== item.byteLength
    ) {
      throw new Error(
        "visual-sequence artifact " + item.id +
        " no longer matches its captured bytes at " + item.r2Key,
      );
    }
  }
  const unsigned = {
    version: VISUAL_SEQUENCE_ARTIFACT_OBJECT_VERIFICATION_VERSION,
    manifestFingerprint: manifest.manifestFingerprint,
    verificationScope: "current_object_bytes_at_check",
    objectDurability: "verified_at_check_only",
    checkedObjectCount: observed.size,
  } satisfies Omit<
    VisualSequenceArtifactObjectVerification,
    "verificationFingerprint"
  >;
  return VisualSequenceArtifactObjectVerificationSchema.parse({
    ...unsigned,
    verificationFingerprint:
      visualSequenceArtifactObjectVerificationFingerprint(unsigned),
  });
}

/**
 * A bounded durable explanation for why a sequence ledger was deliberately
 * omitted. It preserves the distinction between no compatible adapter and an
 * exact adapter rejecting optional evidence, without persisting provider or
 * parser error text.
 */
export const VisualSequenceEvidenceOmissionSchema = z.object({
  version: z.literal(VISUAL_SEQUENCE_EVIDENCE_OMISSION_VERSION),
  status: z.enum(["unsupported", "rejected"]),
  adapter: z.enum([
    "none",
    "ambiguous",
    "standard_novita",
    "casefile_cinematic",
  ]),
  reasonCode: z.enum([
    "no_supported_sequence_contract",
    "ambiguous_sequence_contract",
    "artifact_manifest_invalid",
    "artifact_manifest_source_mismatch",
    "artifact_manifest_sequence_mismatch",
    "artifact_manifest_item_count_mismatch",
    "artifact_manifest_identity_order_mismatch",
    "sequence_receipt_invalid",
    "final_master_or_visual_review_receipt_invalid",
  ]),
  omissionFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  const unsupportedReason =
    value.reasonCode === "no_supported_sequence_contract" ||
    value.reasonCode === "ambiguous_sequence_contract";
  if (value.status === "unsupported") {
    if (!unsupportedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "unsupported omission requires an unsupported-adapter reason",
      });
    }
    const expectedAdapter =
      value.reasonCode === "ambiguous_sequence_contract" ? "ambiguous" : "none";
    if (value.adapter !== expectedAdapter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapter"],
        message: "unsupported omission adapter does not match its reason",
      });
    }
    return;
  }
  if (unsupportedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonCode"],
      message: "rejected omission requires an exact-adapter rejection reason",
    });
  }
  if (
    value.adapter !== "standard_novita" &&
    value.adapter !== "casefile_cinematic"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adapter"],
      message: "rejected omission requires the exact sequence adapter",
    });
  }
});

export type VisualSequenceEvidenceOmission = z.infer<
  typeof VisualSequenceEvidenceOmissionSchema
>;

export interface VisualSequenceEvidenceOmissionInput {
  status: VisualSequenceEvidenceOmission["status"];
  adapter: VisualSequenceEvidenceOmission["adapter"];
  reasonCode: VisualSequenceEvidenceOmission["reasonCode"];
}

export function visualSequenceEvidenceOmissionFingerprint(
  value: Omit<VisualSequenceEvidenceOmission, "omissionFingerprint">,
): string {
  return sha256Hex(canonicalJson(value));
}

export function assertVisualSequenceEvidenceOmission(
  value: unknown,
): VisualSequenceEvidenceOmission {
  const omission = VisualSequenceEvidenceOmissionSchema.parse(value);
  const { omissionFingerprint, ...unsigned } = omission;
  if (
    omissionFingerprint !==
    visualSequenceEvidenceOmissionFingerprint(unsigned)
  ) {
    throw new Error(
      "visual-sequence evidence omission fingerprint does not match its canonical payload",
    );
  }
  return omission;
}

export function createVisualSequenceEvidenceOmission(
  input: VisualSequenceEvidenceOmissionInput,
): VisualSequenceEvidenceOmission {
  const unsigned = {
    version: VISUAL_SEQUENCE_EVIDENCE_OMISSION_VERSION,
    status: input.status,
    adapter: input.adapter,
    reasonCode: input.reasonCode,
  } satisfies Omit<VisualSequenceEvidenceOmission, "omissionFingerprint">;
  return assertVisualSequenceEvidenceOmission({
    ...unsigned,
    omissionFingerprint: visualSequenceEvidenceOmissionFingerprint(unsigned),
  });
}

export function classifyVisualSequenceEvidenceRejection(error: unknown): Extract<
  VisualSequenceEvidenceOmission["reasonCode"],
  | "artifact_manifest_invalid"
  | "artifact_manifest_source_mismatch"
  | "artifact_manifest_sequence_mismatch"
  | "artifact_manifest_item_count_mismatch"
  | "artifact_manifest_identity_order_mismatch"
  | "sequence_receipt_invalid"
  | "final_master_or_visual_review_receipt_invalid"
> {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("artifact manifest source does not match")) {
    return "artifact_manifest_source_mismatch";
  }
  if (message.includes("artifact manifest belongs to a different rendered sequence")) {
    return "artifact_manifest_sequence_mismatch";
  }
  if (message.includes("artifact manifest item count")) {
    return "artifact_manifest_item_count_mismatch";
  }
  if (message.includes("artifact manifest item identity/order")) {
    return "artifact_manifest_identity_order_mismatch";
  }
  if (message.includes("visual-sequence artifact manifest")) {
    return "artifact_manifest_invalid";
  }
  if (
    message.includes("final-master") ||
    message.includes("visual-review")
  ) {
    return "final_master_or_visual_review_receipt_invalid";
  }
  return "sequence_receipt_invalid";
}

const artifactEvidenceSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("byte_bound"),
    sha256,
    byteLength: positiveByteLength,
    captureScope: z.literal("local_post_qa"),
    objectDurability: z.literal("not_reverified"),
  }).strict(),
  z.object({
    state: z.literal("hash_bound"),
    sha256,
  }).strict(),
  z.object({
    state: z.literal("receipt_bound"),
  }).strict(),
]);

const standardNovitaSourceSchema = z.object({
  kind: z.literal("standard_novita"),
  renderManifestFingerprint: sha256,
  shotQaReportFingerprint: sha256,
  visualCoverageFingerprint: sha256,
}).strict();

const casefileCinematicSourceSchema = z.object({
  kind: z.literal("casefile_cinematic"),
  scenePlanFingerprint: sha256,
  editDecisionListFingerprint: sha256,
  footageManifestFingerprint: sha256,
}).strict();

const visualSequenceContractItemSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  id: identifier,
  r2Key: objectKey,
  t0: finite.nonnegative(),
  t1: finite.positive(),
  artifact: artifactEvidenceSchema,
}).strict().superRefine((value, ctx) => {
  if (value.t1 <= value.t0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["t1"],
      message: "visual-sequence item t1 must follow t0",
    });
  }
});

export const VisualSequenceContractSchema = z.object({
  version: z.literal(VISUAL_SEQUENCE_CONTRACT_VERSION),
  source: z.discriminatedUnion("kind", [
    standardNovitaSourceSchema,
    casefileCinematicSourceSchema,
  ]),
  sequenceFingerprint: sha256,
  durationSec: finite.positive(),
  exactOrder: z.literal(true),
  /**
   * Existing assemblers do not persist raw-clip-to-master byte lineage. Do not
   * infer it from timeline order, clip keys, or a successful visual review.
   */
  assemblyBinding: z.literal("unmeasured"),
  items: z.array(visualSequenceContractItemSchema).min(1).max(2_000),
  contractFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  assertUnique(value.items.map((item) => item.id), "sequence item id", ctx, ["items"]);
  value.items.forEach((item, index) => {
    if (item.ordinal !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "ordinal"],
        message: "visual-sequence contract must retain exact contiguous item order",
      });
    }
    if (index === 0 && Math.abs(item.t0) > 0.02) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "t0"],
        message: "visual-sequence contract must begin at t=0",
      });
    }
    if (index > 0 && Math.abs(item.t0 - value.items[index - 1]!.t1) > 0.02) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "t0"],
        message: "visual-sequence contract has a timing gap or overlap",
      });
    }
  });
  if (Math.abs(value.items.at(-1)!.t1 - value.durationSec) > 0.02) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSec"],
      message: "visual-sequence contract must end at its declared duration",
    });
  }
});

export type VisualSequenceContract = z.infer<typeof VisualSequenceContractSchema>;

function canonicalFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function visualSequenceContractFingerprint(
  value: Omit<VisualSequenceContract, "contractFingerprint">,
): string {
  return canonicalFingerprint(value);
}

export function assertVisualSequenceContract(value: unknown): VisualSequenceContract {
  const contract = VisualSequenceContractSchema.parse(value);
  const { contractFingerprint, ...unsigned } = contract;
  if (contractFingerprint !== visualSequenceContractFingerprint(unsigned)) {
    throw new Error(
      "visual-sequence contract fingerprint does not match its canonical payload",
    );
  }
  return contract;
}

function createVisualSequenceContract(
  unsigned: Omit<VisualSequenceContract, "contractFingerprint">,
): VisualSequenceContract {
  return assertVisualSequenceContract({
    ...unsigned,
    contractFingerprint: visualSequenceContractFingerprint(unsigned),
  });
}

export function standardNovitaVisualSequenceFingerprint(manifest: unknown): string {
  const parsed = ShotRenderManifestSchema.parse(manifest);
  // A targeted QA repair may replace a failed provider candidate at the same
  // planned shot id. The sequence identity intentionally pins planning,
  // generation, timing, continuity, and terminal handoffs while leaving the
  // mutable candidate key to the post-QA byte artifact manifest.
  return canonicalFingerprint({
    version: parsed.version,
    generation: parsed.generation,
    durationSec: parsed.durationSec,
    items: parsed.items.map((item) => ({
      shotId: item.shotId,
      t0: item.t0,
      t1: item.t1,
      sourceSentenceIds: item.sourceSentenceIds,
      continuityState: item.continuityState,
      terminalAnchorShotId: item.terminalAnchorShotId,
      terminalStillKey: item.terminalStillKey,
    })),
  });
}

function assertedArtifactsForSequence(args: {
  artifactManifest: unknown | undefined;
  source: VisualSequenceArtifactManifest["source"];
  sequenceFingerprint: string;
  expected: readonly { id: string; r2Key?: string }[];
}): VisualSequenceArtifactManifest | undefined {
  if (args.artifactManifest === undefined) return undefined;
  const manifest = assertVisualSequenceArtifactManifest(args.artifactManifest);
  if (manifest.source !== args.source) {
    throw new Error(
      "visual-sequence artifact manifest source does not match the sequence contract",
    );
  }
  if (manifest.sequenceFingerprint !== args.sequenceFingerprint) {
    throw new Error(
      "visual-sequence artifact manifest belongs to a different rendered sequence",
    );
  }
  if (manifest.items.length !== args.expected.length) {
    throw new Error(
      "visual-sequence artifact manifest item count does not match the rendered sequence",
    );
  }
  manifest.items.forEach((item, index) => {
    const expected = args.expected[index]!;
    if (
      item.id !== expected.id ||
      (expected.r2Key !== undefined && item.r2Key !== expected.r2Key)
    ) {
      throw new Error(
        "visual-sequence artifact manifest item identity/order does not match the rendered sequence",
      );
    }
  });
  return manifest;
}

function artifactEvidenceFor(args: {
  id: string;
  artifacts: VisualSequenceArtifactManifest | undefined;
  sourceProofClipSha256?: string;
}): z.infer<typeof artifactEvidenceSchema> {
  const artifacts = args.artifacts;
  const byteArtifact = artifacts?.items.find((item) => item.id === args.id);
  if (byteArtifact && artifacts) {
    return {
      state: "byte_bound",
      sha256: byteArtifact.sha256,
      byteLength: byteArtifact.byteLength,
      captureScope: artifacts.captureScope,
      objectDurability: artifacts.objectDurability,
    };
  }
  if (args.sourceProofClipSha256) {
    // Current Casefile source-proof receipts expose a source clip hash but not
    // its byte length. Keep the valuable hash binding without claiming the
    // stronger captured-artifact proof.
    return {
      state: "hash_bound",
      sha256: args.sourceProofClipSha256,
    };
  }
  return { state: "receipt_bound" };
}

export function createStandardNovitaVisualSequenceContract(args: {
  shotRenderManifest: unknown;
  shotQaReport: unknown;
  visualCoverage: unknown;
  artifactManifest?: unknown;
}): VisualSequenceContract {
  const qualified = validateQualifiedShotRender({
    manifest: args.shotRenderManifest,
    qaReport: args.shotQaReport,
    coverage: args.visualCoverage,
  });
  const sequenceFingerprint = standardNovitaVisualSequenceFingerprint(qualified.manifest);
  const artifacts = assertedArtifactsForSequence({
    artifactManifest: args.artifactManifest,
    source: "standard_novita",
    sequenceFingerprint,
    // The artifact manifest is emitted after QA. It may hold a targeted
    // repaired candidate key, so only its ordered shot identity is inherited
    // from the initial render manifest; its own byte receipt supplies the
    // actual accepted key.
    expected: qualified.manifest.items.map((item) => ({ id: item.shotId })),
  });
  return createVisualSequenceContract({
    version: VISUAL_SEQUENCE_CONTRACT_VERSION,
    source: {
      kind: "standard_novita",
      renderManifestFingerprint: canonicalFingerprint(qualified.manifest),
      shotQaReportFingerprint: canonicalFingerprint(qualified.qaReport),
      visualCoverageFingerprint: canonicalFingerprint(qualified.coverage),
    },
    sequenceFingerprint,
    durationSec: qualified.manifest.durationSec,
    exactOrder: true,
    assemblyBinding: "unmeasured",
    items: qualified.manifest.items.map((item, ordinal) => {
      const byteArtifact = artifacts?.items[ordinal];
      return {
        ordinal,
        id: item.shotId,
        r2Key: byteArtifact?.r2Key ?? item.clipKey,
        t0: item.t0,
        t1: item.t1,
        artifact: artifactEvidenceFor({ id: item.shotId, artifacts }),
      };
    }),
  });
}

export function createCasefileCinematicVisualSequenceContract(args: {
  scenePlan: unknown;
  editDecisionList: unknown;
  footageManifest: unknown;
  narrationDurationSec: number;
  artifactManifest?: unknown;
}): VisualSequenceContract {
  const binding = assertCinematicSequenceRenderBinding({
    scenePlan: args.scenePlan,
    editDecisionList: args.editDecisionList,
    footageManifest: args.footageManifest,
    narrationDurationSec: args.narrationDurationSec,
  });
  const sequenceFingerprint = binding.scenePlan.sequenceFingerprint;
  const artifacts = assertedArtifactsForSequence({
    artifactManifest: args.artifactManifest,
    source: "casefile_cinematic",
    sequenceFingerprint,
    expected: binding.footageManifest.items.map((item) => ({
      id: item.sceneId,
      r2Key: item.clipKey,
    })),
  });
  return createVisualSequenceContract({
    version: VISUAL_SEQUENCE_CONTRACT_VERSION,
    source: {
      kind: "casefile_cinematic",
      scenePlanFingerprint: canonicalFingerprint(binding.scenePlan),
      editDecisionListFingerprint: canonicalFingerprint(binding.editDecisionList),
      footageManifestFingerprint: canonicalFingerprint(binding.footageManifest),
    },
    sequenceFingerprint,
    durationSec: binding.scenePlan.durationSec,
    exactOrder: true,
    assemblyBinding: "unmeasured",
    items: binding.footageManifest.items.map((item, ordinal) => ({
      ordinal,
      id: item.sceneId,
      r2Key: item.clipKey,
      t0: item.t0!,
      t1: item.t1!,
      artifact: artifactEvidenceFor({
        id: item.sceneId,
        artifacts,
        sourceProofClipSha256: item.sourceProofMediaReceipt?.sourceProofClipSha256,
      }),
    })),
  });
}

const finalMasterSchema = z.object({
  sha256,
  byteLength: positiveByteLength,
  durationSec: finite.positive(),
}).strict();

const visualReviewFrameArtifactSchema = z.object({
  r2Key: objectKey,
  contentSha256: sha256,
  byteLength: positiveByteLength,
}).strict();

const visualReviewBindingSchema = z.object({
  evidenceManifestKey: objectKey,
  reviewFingerprint: z.string().trim().min(1).max(256),
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
  source: z.object({
    sha256,
    durationSec: finite.positive(),
  }).strict(),
  frameArtifacts: z.array(visualReviewFrameArtifactSchema).min(1).max(20_000),
}).strict().superRefine((value, ctx) => {
  assertUnique(value.frameArtifacts.map((frame) => frame.r2Key), "visual-review frame key", ctx, ["frameArtifacts"]);
  value.frameArtifacts.forEach((frame, index) => {
    const previous = value.frameArtifacts[index - 1];
    if (previous && previous.r2Key.localeCompare(frame.r2Key) >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frameArtifacts", index, "r2Key"],
        message: "visual-review frame artifacts must be sorted by storage key",
      });
    }
  });
});

interface VisualReviewBindingInput {
  evidenceManifestKey: string;
  reviewFingerprint: string;
  reviewReceiptVersion: string;
  reviewReceiptFingerprint: string;
  releaseReceiptFingerprint: string;
  source: { sha256: string; durationSec: number };
  frameArtifacts: ReadonlyArray<{
    r2Key: string;
    contentSha256: string;
    byteLength: number;
  }>;
}

function normalizeVisualReviewBinding(
  value: VisualReviewBindingInput,
): z.infer<typeof visualReviewBindingSchema> {
  return visualReviewBindingSchema.parse({
    ...value,
    frameArtifacts: [...value.frameArtifacts].sort((left, right) =>
      left.r2Key.localeCompare(right.r2Key),
    ),
  });
}

const visualSequenceSourceArtifactBindingSchema = z.object({
  // Weakest binding across all sequence clips; details stay per-item below.
  binding: z.enum(["byte_bound", "hash_bound", "receipt_bound"]),
  byteBoundItemIds: z.array(identifier),
  /**
   * Byte-bound items are local capture receipts in V1. They are not a current
   * object assertion, even when their historical R2 key still exists.
   */
  byteBoundCaptureScope: z.enum(["local_post_qa", "absent"]),
  byteBoundObjectDurability: z.enum(["not_reverified", "not_applicable"]),
  hashBoundItemIds: z.array(identifier),
  receiptBoundItemIds: z.array(identifier),
}).strict();

function deriveSourceArtifactBinding(
  contract: VisualSequenceContract,
): z.infer<typeof visualSequenceSourceArtifactBindingSchema> {
  const byteBoundItemIds = contract.items
    .filter((item) => item.artifact.state === "byte_bound")
    .map((item) => item.id);
  const hashBoundItemIds = contract.items
    .filter((item) => item.artifact.state === "hash_bound")
    .map((item) => item.id);
  const receiptBoundItemIds = contract.items
    .filter((item) => item.artifact.state === "receipt_bound")
    .map((item) => item.id);
  return {
    binding: receiptBoundItemIds.length > 0
      ? "receipt_bound"
      : hashBoundItemIds.length > 0
        ? "hash_bound"
        : "byte_bound",
    byteBoundItemIds,
    byteBoundCaptureScope:
      byteBoundItemIds.length > 0 ? "local_post_qa" : "absent",
    byteBoundObjectDurability:
      byteBoundItemIds.length > 0 ? "not_reverified" : "not_applicable",
    hashBoundItemIds,
    receiptBoundItemIds,
  };
}

export const VisualSequenceEvidenceLedgerSchema = z.object({
  version: z.literal(VISUAL_SEQUENCE_EVIDENCE_LEDGER_VERSION),
  contract: VisualSequenceContractSchema,
  finalMaster: finalMasterSchema,
  visualReview: visualReviewBindingSchema,
  /**
   * Captured raw-artifact coverage only. It is not a claim that these raw
   * clips were assembled into the master below.
   */
  sourceArtifactBinding: visualSequenceSourceArtifactBindingSchema,
  assemblyBinding: z.literal("unmeasured"),
  ledgerFingerprint: sha256,
}).strict();

export type VisualSequenceEvidenceLedger = z.infer<
  typeof VisualSequenceEvidenceLedgerSchema
>;

export interface VisualSequenceEvidenceLedgerInput {
  contract: VisualSequenceContract;
  finalMaster: {
    sha256: string;
    byteLength: number;
    durationSec: number;
  };
  visualReview: VisualReviewBindingInput;
}

export function visualSequenceEvidenceLedgerFingerprint(
  value: Omit<VisualSequenceEvidenceLedger, "ledgerFingerprint">,
): string {
  return canonicalFingerprint(value);
}

function assertIntrinsicVisualSequenceEvidenceLedger(
  value: VisualSequenceEvidenceLedger,
): VisualSequenceEvidenceLedger {
  const contract = assertVisualSequenceContract(value.contract);
  const expectedSourceArtifactBinding = deriveSourceArtifactBinding(contract);
  if (
    canonicalJson(value.sourceArtifactBinding) !==
    canonicalJson(expectedSourceArtifactBinding)
  ) {
    throw new Error(
      "visual-sequence ledger source-artifact binding does not match its contract",
    );
  }
  if (value.assemblyBinding !== "unmeasured" || contract.assemblyBinding !== "unmeasured") {
    throw new Error(
      "visual-sequence ledger cannot claim assembly binding without an exact assembler receipt",
    );
  }
  if (
    value.visualReview.source.sha256 !== value.finalMaster.sha256 ||
    Math.abs(value.visualReview.source.durationSec - value.finalMaster.durationSec) > 0.01
  ) {
    throw new Error(
      "visual-sequence ledger visual-review evidence belongs to a different final master",
    );
  }
  const { ledgerFingerprint, ...unsigned } = value;
  if (ledgerFingerprint !== visualSequenceEvidenceLedgerFingerprint(unsigned)) {
    throw new Error(
      "visual-sequence evidence ledger fingerprint does not match its canonical payload",
    );
  }
  return value;
}

export function createVisualSequenceEvidenceLedger(
  input: VisualSequenceEvidenceLedgerInput,
): VisualSequenceEvidenceLedger {
  const contract = assertVisualSequenceContract(input.contract);
  const unsigned = {
    version: VISUAL_SEQUENCE_EVIDENCE_LEDGER_VERSION,
    contract,
    finalMaster: finalMasterSchema.parse(input.finalMaster),
    visualReview: normalizeVisualReviewBinding(input.visualReview),
    sourceArtifactBinding: deriveSourceArtifactBinding(contract),
    assemblyBinding: "unmeasured" as const,
  } satisfies Omit<VisualSequenceEvidenceLedger, "ledgerFingerprint">;
  return assertIntrinsicVisualSequenceEvidenceLedger(VisualSequenceEvidenceLedgerSchema.parse({
    ...unsigned,
    ledgerFingerprint: visualSequenceEvidenceLedgerFingerprint(unsigned),
  }));
}

export function assertVisualSequenceEvidenceLedger(args: {
  ledger: unknown;
  finalMaster: VisualSequenceEvidenceLedgerInput["finalMaster"];
  visualReview: VisualSequenceEvidenceLedgerInput["visualReview"];
}): VisualSequenceEvidenceLedger {
  const ledger = assertIntrinsicVisualSequenceEvidenceLedger(
    VisualSequenceEvidenceLedgerSchema.parse(args.ledger),
  );
  const finalMaster = finalMasterSchema.parse(args.finalMaster);
  const visualReview = normalizeVisualReviewBinding(args.visualReview);
  if (canonicalJson(ledger.finalMaster) !== canonicalJson(finalMaster)) {
    throw new Error("visual-sequence ledger belongs to a different final-master byte receipt");
  }
  if (canonicalJson(ledger.visualReview) !== canonicalJson(visualReview)) {
    throw new Error("visual-sequence ledger belongs to a different visual-review byte receipt");
  }
  return ledger;
}

export type VisualSequenceEvidenceLedgerResolution =
  | {
    status: "supported";
    contract: VisualSequenceContract;
    ledger: VisualSequenceEvidenceLedger;
  }
  | {
    status: "unsupported";
    reason: "no_supported_sequence_contract" | "ambiguous_sequence_contract";
  };

/**
 * Adapts only the two existing evidence-rich renderer families. All other
 * lanes are explicitly unsupported rather than receiving a made-up generic
 * sequence score or synthetic byte proof.
 */
export function deriveVisualSequenceEvidenceLedger(args: {
  standardNovita?: {
    shotRenderManifest: unknown;
    shotQaReport: unknown;
    visualCoverage: unknown;
    artifactManifest?: unknown;
  };
  casefileCinematic?: {
    scenePlan: unknown;
    editDecisionList: unknown;
    footageManifest: unknown;
    narrationDurationSec: number;
    artifactManifest?: unknown;
  };
  finalMaster: VisualSequenceEvidenceLedgerInput["finalMaster"];
  visualReview: VisualSequenceEvidenceLedgerInput["visualReview"];
}): VisualSequenceEvidenceLedgerResolution {
  if (args.standardNovita && args.casefileCinematic) {
    return {
      status: "unsupported",
      reason: "ambiguous_sequence_contract",
    };
  }
  if (!args.standardNovita && !args.casefileCinematic) {
    return {
      status: "unsupported",
      reason: "no_supported_sequence_contract",
    };
  }
  const contract = args.standardNovita
    ? createStandardNovitaVisualSequenceContract(args.standardNovita)
    : createCasefileCinematicVisualSequenceContract(args.casefileCinematic!);
  return {
    status: "supported",
    contract,
    ledger: createVisualSequenceEvidenceLedger({
      contract,
      finalMaster: args.finalMaster,
      visualReview: args.visualReview,
    }),
  };
}
