import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Durable, post-narration human-review receipt. This is intentionally a
 * narrow factual-data-story contract: it freezes work that already happened;
 * it does not admit a route, generate a plan, or start a provider.
 */
export const FACTUAL_REVIEW_CHECKPOINT_VERSION = "factual-review-checkpoint/v1" as const;
export const FACTUAL_REVIEW_RESUME_VERSION = "factual-review-resume/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY = "source_attributed_data_story";

export const FACTUAL_REVIEW_REQUIRED_ARTIFACTS = [
  { key: "script", producerModule: "script_gen" },
  { key: "narrationText", producerModule: "script_gen" },
  { key: "scriptApproved", producerModule: "qa_script" },
  { key: "narrationKey", producerModule: "narration_tts" },
  { key: "narrationDurationSec", producerModule: "narration_tts" },
  { key: "narrationTranscriptText", producerModule: "narration_tts" },
  { key: "narrationPerformanceEvidence", producerModule: "narration_tts" },
  { key: "sentenceTimings", producerModule: "narration_tts" },
  { key: "timedScript", producerModule: "story_spine" },
  { key: "narrativeBeats", producerModule: "story_spine" },
  { key: "continuityLedger", producerModule: "story_spine" },
  { key: "shotList", producerModule: "story_spine" },
  { key: "dpVisualSpecs", producerModule: "story_spine" },
  { key: "editorEdl", producerModule: "story_spine" },
  { key: "storyCoverage", producerModule: "story_spine" },
  { key: "episodeSpec", producerModule: "story_spine" },
  { key: "episodeGraph", producerModule: "episode_graph" },
  { key: "sceneManifest", producerModule: "episode_graph" },
] as const;

export type FactualReviewArtifactKey = (typeof FACTUAL_REVIEW_REQUIRED_ARTIFACTS)[number]["key"];

export interface FactualReviewArtifactBinding {
  readonly key: FactualReviewArtifactKey;
  readonly artifactId: string;
  readonly payloadHash: string;
  readonly producerModule: string;
  readonly producerVersion: string;
  readonly schemaVersion: string;
}

export interface FactualReviewSourceAuthority {
  readonly authorityKind: "data_story_source_ledger";
  readonly authorityContentFingerprint: string;
  /** Hash of the raw, source-first ledger itself; never the ledger payload. */
  readonly rawLedgerFingerprint: string;
  readonly reviewedPackId: string;
  readonly reviewedPackContentFingerprint: string;
  readonly routeSeedFingerprint: string;
  readonly topicFingerprint: string;
  readonly showProfileFingerprint: string;
  readonly selectedCapabilityKeys: readonly string[];
}

export interface FactualReviewCheckpointFingerprintInput {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly invocationSha256: string;
  readonly sourceAuthority: FactualReviewSourceAuthority;
  readonly artifacts: readonly FactualReviewArtifactBinding[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = requiredString(value, label);
  if (!SHA256.test(output)) throw new Error(`${label} must be a sha256 fingerprint`);
  return output;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be a string array`);
  }
  return [...new Set(value)].sort();
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Extract the only source authority Phase I is allowed to resume. The raw
 * data-story ledger remains primary; a derived editorial packet cannot become
 * a replacement authority merely because it accompanies the frozen run seed.
 */
export function factualReviewSourceAuthorityFromInvocation(
  invocation: unknown,
): FactualReviewSourceAuthority {
  const snapshot = record(invocation, "frozen pipeline invocation");
  const seedStore = record(snapshot["seedStore"], "frozen pipeline invocation seedStore");
  const admission = record(
    seedStore["reviewedEvidencePackRunAdmission"],
    "reviewed evidence run admission",
  );
  const selector = record(admission["selector"], "reviewed evidence selector");
  const pack = record(seedStore["reviewedEvidencePack"], "reviewed evidence pack");
  const sourceAuthority = record(pack["sourceAuthority"], "reviewed evidence source authority");

  if (admission["version"] !== "reviewed-evidence-pack-run-admission/v1") {
    throw new Error("factual review requires the sealed reviewed evidence run admission");
  }
  if (admission["authorityKind"] !== "data_story_source_ledger" || sourceAuthority["kind"] !== "data_story_source_ledger") {
    throw new Error("factual review requires raw data-story ledger authority");
  }
  const selectedCapabilityKeys = stringList(
    admission["selectedCapabilityKeys"],
    "reviewed evidence selected capabilities",
  );
  if (!selectedCapabilityKeys.includes(SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY)) {
    throw new Error("factual review requires the source_attributed_data_story capability");
  }

  const reviewedPackContentFingerprint = fingerprint(
    admission["contentFingerprint"],
    "reviewed evidence content fingerprint",
  );
  if (fingerprint(pack["contentFingerprint"], "reviewed evidence pack content fingerprint") !== reviewedPackContentFingerprint) {
    throw new Error("factual review reviewed evidence pack content fingerprint changed");
  }
  if (
    fingerprint(selector["contentFingerprint"], "reviewed evidence selector content fingerprint") !==
    reviewedPackContentFingerprint
  ) {
    throw new Error("factual review selector is not bound to the frozen reviewed evidence pack");
  }
  const authorityContentFingerprint = fingerprint(
    admission["authorityContentFingerprint"],
    "reviewed data-story authority fingerprint",
  );
  if (
    fingerprint(pack["authorityContentFingerprint"], "reviewed pack authority fingerprint") !==
      authorityContentFingerprint
  ) {
    throw new Error("factual review raw data-story authority fingerprint changed");
  }
  const rawLedger = sourceAuthority["dataStorySourceLedger"];
  if (rawLedger === undefined || !sameCanonical(rawLedger, seedStore["dataStorySourceLedger"])) {
    throw new Error("factual review raw data-story ledger is not the exact frozen ledger");
  }

  const showProfileFingerprint = fingerprint(
    admission["showProfileFingerprint"],
    "reviewed evidence Show Profile fingerprint",
  );
  if (
    snapshot["showProfileFingerprint"] !== undefined &&
    fingerprint(snapshot["showProfileFingerprint"], "frozen invocation Show Profile fingerprint") !==
      showProfileFingerprint
  ) {
    throw new Error("factual review Show Profile fingerprint changed in the frozen invocation");
  }

  return Object.freeze({
    authorityKind: "data_story_source_ledger" as const,
    authorityContentFingerprint,
    rawLedgerFingerprint: sha256Hex(canonicalJson(rawLedger)),
    reviewedPackId: requiredString(selector["packId"], "reviewed evidence selector pack id"),
    reviewedPackContentFingerprint,
    routeSeedFingerprint: fingerprint(admission["routeSeedFingerprint"], "reviewed evidence route seed fingerprint"),
    topicFingerprint: fingerprint(admission["topicFingerprint"], "reviewed evidence topic fingerprint"),
    showProfileFingerprint,
    selectedCapabilityKeys,
  });
}

export function assertFactualReviewArtifactBindings(
  value: readonly FactualReviewArtifactBinding[],
): readonly FactualReviewArtifactBinding[] {
  const byKey = new Map(value.map((artifact) => [artifact.key, artifact]));
  if (byKey.size !== value.length) throw new Error("factual review artifact bindings contain duplicate keys");
  const normalized: FactualReviewArtifactBinding[] = [];
  for (const requirement of FACTUAL_REVIEW_REQUIRED_ARTIFACTS) {
    const artifact = byKey.get(requirement.key);
    if (!artifact) throw new Error(`factual review retained artifact is missing: ${requirement.key}`);
    if (artifact.producerModule !== requirement.producerModule) {
      throw new Error(
        `factual review artifact ${requirement.key} must be produced by ${requirement.producerModule}`,
      );
    }
    if (!artifact.artifactId.trim() || !artifact.producerVersion.trim() || !artifact.schemaVersion.trim()) {
      throw new Error(`factual review artifact ${requirement.key} has incomplete immutable identity`);
    }
    normalized.push({
      key: requirement.key,
      artifactId: artifact.artifactId,
      payloadHash: fingerprint(artifact.payloadHash, `factual review artifact ${requirement.key} payload hash`),
      producerModule: artifact.producerModule,
      producerVersion: artifact.producerVersion,
      schemaVersion: artifact.schemaVersion,
    });
  }
  return normalized;
}

export function factualReviewCheckpointFingerprint(
  input: FactualReviewCheckpointFingerprintInput,
): string {
  const artifacts = assertFactualReviewArtifactBindings(input.artifacts)
    .map((artifact) => ({ ...artifact }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return sha256Hex(canonicalJson({
    version: FACTUAL_REVIEW_CHECKPOINT_VERSION,
    ownerId: requiredString(input.ownerId, "factual review owner id"),
    channelId: requiredString(input.channelId, "factual review channel id"),
    runId: requiredString(input.runId, "factual review run id"),
    invocationSha256: fingerprint(input.invocationSha256, "factual review invocation fingerprint"),
    sourceAuthority: input.sourceAuthority,
    artifacts,
  }));
}

export function factualReviewApprovalFingerprint(input: {
  readonly checkpointFingerprint: string;
  readonly reviewerId: string;
  readonly approvedAt: number;
}): string {
  if (!Number.isFinite(input.approvedAt) || input.approvedAt <= 0) {
    throw new Error("factual review approval time is invalid");
  }
  return sha256Hex(canonicalJson({
    version: FACTUAL_REVIEW_RESUME_VERSION,
    decision: "approved",
    checkpointFingerprint: fingerprint(input.checkpointFingerprint, "factual review checkpoint fingerprint"),
    reviewerId: requiredString(input.reviewerId, "factual review reviewer id"),
    approvedAt: input.approvedAt,
  }));
}
