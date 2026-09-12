import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const artifactRef = z.object({
  artifactId: z.string().min(1), key: z.string().min(1), type: z.string().min(1),
  schemaVersion: z.string().min(1), producerModule: z.string().min(1),
  producerVersion: z.string().min(1), payloadHash: digest,
}).strict();

/** A completed execution's identity, not a new approval for cached output. */
export const StageReuseReceiptSchema = z.object({
  version: z.literal("stage-reuse/v1"),
  invocationHash: digest,
  persistedOutputsHash: digest,
  portableOutputsHash: digest,
  outputRefs: z.array(artifactRef).max(256),
  outputIdentities: z.array(z.object({
    key: z.string().min(1), portablePayloadHash: digest, deferred: z.boolean(),
  }).strict()).max(256),
  fingerprint: digest,
}).strict();

export type StageReuseReceipt = z.infer<typeof StageReuseReceiptSchema>;
export type StageReuseOutputIdentity = StageReuseReceipt["outputIdentities"][number];
export const STAGE_REUSE_RECONCILIATION_MARKER = "STAGE_REUSE_RECONCILIATION_REQUIRED";
