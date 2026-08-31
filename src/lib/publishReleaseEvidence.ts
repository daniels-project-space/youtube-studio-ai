import type { Id } from "../../convex/_generated/dataModel";
import {
  parseFinalMasterReleaseCertificateBytes,
  type FinalMasterReleaseCertificate,
  verifyFinalMasterReleaseEvidenceForLocalUpload,
  verifyFinalMasterReleaseEvidenceObjects,
} from "@/lib/finalMasterReleaseCertificate";

const SHA256 = /^[a-f0-9]{64}$/;

export interface PublishIntentReleaseEvidenceBinding {
  releaseEvidenceCertificateKey?: string;
  releaseEvidenceCertificateFingerprint?: string;
}

export interface PublishIntentReleaseEvidenceSubject
  extends PublishIntentReleaseEvidenceBinding {
  ownerId: string;
  channelId: Id<"channels">;
  runId?: Id<"runs">;
  videoArtifactId: string;
  videoArtifactKey: string;
  videoSha256: string;
}

export interface PublishRunReleaseEvidence
  extends PublishIntentReleaseEvidenceBinding {
  ownerId: string;
  channelId: Id<"channels">;
  releaseEvidenceStatus?: string;
}

export interface ResolvedPublishReleaseEvidenceBinding {
  certificateKey: string;
  certificateFingerprint: string;
  source: "intent" | "legacy_run";
}

export class PublishReleaseEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishReleaseEvidenceError";
  }
}

function releaseEvidenceError(message: string): never {
  throw new PublishReleaseEvidenceError(`publish release evidence: ${message}`);
}

function optionalNonEmptyString(value: unknown, subject: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    releaseEvidenceError(`${subject} is missing or malformed`);
  }
  return value.trim();
}

/**
 * Parse the compact intent-side pointer without treating a partial pointer as
 * a historical record. Historical rows have neither field; a one-sided pair
 * is corruption and may never enter a retry path.
 */
export function resolvePublishIntentReleaseEvidenceBinding(
  value: PublishIntentReleaseEvidenceBinding,
): ResolvedPublishReleaseEvidenceBinding | undefined {
  const certificateKey = optionalNonEmptyString(
    value.releaseEvidenceCertificateKey,
    "certificate key",
  );
  const certificateFingerprint = optionalNonEmptyString(
    value.releaseEvidenceCertificateFingerprint,
    "certificate fingerprint",
  );
  if (Boolean(certificateKey) !== Boolean(certificateFingerprint)) {
    releaseEvidenceError("certificate key/fingerprint pair is incomplete");
  }
  if (!certificateKey || !certificateFingerprint) return undefined;
  if (!SHA256.test(certificateFingerprint)) {
    releaseEvidenceError("certificate fingerprint is not a SHA-256 digest");
  }
  return {
    certificateKey,
    certificateFingerprint,
    source: "intent",
  };
}

function assertExactRunIdentity(args: {
  intent: PublishIntentReleaseEvidenceSubject;
  run: PublishRunReleaseEvidence | null | undefined;
}): PublishRunReleaseEvidence {
  const { intent, run } = args;
  if (
    !run ||
    run.ownerId !== intent.ownerId ||
    String(run.channelId) !== String(intent.channelId)
  ) {
    releaseEvidenceError("run identity is missing or does not match the publish intent");
  }
  return run;
}

/**
 * Resolve the immutable certificate pointer for a dispatch attempt. New
 * intent rows carry the pointer themselves. Older rows remain serviceable only
 * when their owning run still has an exact recorded release-evidence pointer;
 * no legacy row is allowed to infer a certificate from mutable channel state.
 */
export async function resolvePublishReleaseEvidenceBinding(args: {
  intent: PublishIntentReleaseEvidenceSubject;
  getRun: (runId: Id<"runs">) => Promise<PublishRunReleaseEvidence | null | undefined>;
}): Promise<ResolvedPublishReleaseEvidenceBinding> {
  if (!args.intent.runId) {
    releaseEvidenceError("intent has no owning run for release-evidence verification");
  }
  const run = assertExactRunIdentity({
    intent: args.intent,
    run: await args.getRun(args.intent.runId),
  });
  const runBinding = resolvePublishIntentReleaseEvidenceBinding(run);
  if (
    run.releaseEvidenceStatus !== "release_evidence_recorded" ||
    !runBinding
  ) {
    releaseEvidenceError("owning run has no recorded final-master release evidence");
  }

  const intentBinding = resolvePublishIntentReleaseEvidenceBinding(args.intent);
  if (!intentBinding) {
    return { ...runBinding, source: "legacy_run" };
  }
  if (
    intentBinding.certificateKey !== runBinding.certificateKey ||
    intentBinding.certificateFingerprint !== runBinding.certificateFingerprint
  ) {
    releaseEvidenceError("intent certificate pointer does not match its owning run");
  }
  return intentBinding;
}

function assertCertificateMatchesIntent(args: {
  certificate: FinalMasterReleaseCertificate;
  binding: ResolvedPublishReleaseEvidenceBinding;
  intent: PublishIntentReleaseEvidenceSubject;
}): void {
  const { certificate, binding, intent } = args;
  if (certificate.certificateFingerprint !== binding.certificateFingerprint) {
    releaseEvidenceError("certificate bytes do not match the persisted fingerprint");
  }
  if (
    certificate.finalMaster.r2Key !== intent.videoArtifactKey ||
    certificate.finalMaster.sha256 !== intent.videoSha256 ||
    intent.videoArtifactId !== `sha256:${certificate.finalMaster.sha256}`
  ) {
    releaseEvidenceError("certificate final master does not match the immutable publish intent");
  }
}

/**
 * Revalidate the exact final master and every retained proof object immediately
 * before a provider-facing upload. Any evidence defect is deliberately typed
 * so the dispatcher can terminal-block rather than minting a retry that might
 * publish after the reviewer evidence was lost or overwritten.
 */
export async function verifyPublishIntentReleaseEvidence(args: {
  intent: PublishIntentReleaseEvidenceSubject;
  getRun: (runId: Id<"runs">) => Promise<PublishRunReleaseEvidence | null | undefined>;
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  getObjectIntegrity: (key: string) => Promise<{ sha256: string; byteLength: number }>;
  headObjectMetadata: (key: string) => Promise<{ contentLength?: number } | null>;
  localFilePath: string;
}): Promise<{ certificate: FinalMasterReleaseCertificate; binding: ResolvedPublishReleaseEvidenceBinding }> {
  const binding = await resolvePublishReleaseEvidenceBinding({
    intent: args.intent,
    getRun: args.getRun,
  });
  let certificate: FinalMasterReleaseCertificate;
  try {
    certificate = parseFinalMasterReleaseCertificateBytes(
      await args.getObjectBytes(binding.certificateKey),
    );
  } catch (error) {
    releaseEvidenceError(
      `certificate is unavailable or invalid (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  assertCertificateMatchesIntent({ certificate, binding, intent: args.intent });
  try {
    // The local source is the exact file that will be handed to YouTube. The
    // verifier still checks durable master availability plus every receipt and
    // frame object, while avoiding a second full-master R2 stream.
    await verifyFinalMasterReleaseEvidenceForLocalUpload({
      certificate,
      filePath: args.localFilePath,
      getObjectBytes: args.getObjectBytes,
      headObjectMetadata: args.headObjectMetadata,
    });
  } catch (error) {
    releaseEvidenceError(
      `certificate objects no longer verify (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { certificate, binding };
}

/** Exported for callers that have no local upload file and need the strict R2 path. */
export async function verifyPublishIntentReleaseEvidenceObjects(args: {
  intent: PublishIntentReleaseEvidenceSubject;
  getRun: (runId: Id<"runs">) => Promise<PublishRunReleaseEvidence | null | undefined>;
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  getObjectIntegrity: (key: string) => Promise<{ sha256: string; byteLength: number }>;
}): Promise<{ certificate: FinalMasterReleaseCertificate; binding: ResolvedPublishReleaseEvidenceBinding }> {
  const binding = await resolvePublishReleaseEvidenceBinding({
    intent: args.intent,
    getRun: args.getRun,
  });
  let certificate: FinalMasterReleaseCertificate;
  try {
    certificate = parseFinalMasterReleaseCertificateBytes(
      await args.getObjectBytes(binding.certificateKey),
    );
  } catch (error) {
    releaseEvidenceError(
      `certificate is unavailable or invalid (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  assertCertificateMatchesIntent({ certificate, binding, intent: args.intent });
  try {
    await verifyFinalMasterReleaseEvidenceObjects({
      certificate,
      getObjectBytes: args.getObjectBytes,
      getObjectIntegrity: args.getObjectIntegrity,
    });
  } catch (error) {
    releaseEvidenceError(
      `certificate objects no longer verify (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { certificate, binding };
}
