import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const entries = (value: unknown): value is Array<{ block: string; version?: string; params?: RecordValue }> => Array.isArray(value) && value.every(entry => record(entry) && typeof entry.block === "string" && (entry.version === undefined || typeof entry.version === "string") && (entry.params === undefined || record(entry.params)));

/** Verify the immutable v2 fields before using a draft as a comparison input. */
export function verifiedDurationCandidate(row: unknown, ownerId: string, channelId: string) {
  if (!record(row) || (row.version !== "duration-draft-candidate/v2" && row.version !== "duration-draft-candidate/v3") || row.status !== "untested" || row.ownerId !== ownerId || String(row.channelId) !== channelId || !entries(row.pipeline) || !record(row.baselineModuleConfig) || !record(row.moduleConfig) || typeof row.requestedSeconds !== "number" || typeof row.family !== "string" || typeof row.baselineFingerprint !== "string" || typeof row.fingerprint !== "string") return null;
  if (row.version === "duration-draft-candidate/v3" && row.sourceInception !== null && !record(row.sourceInception)) return null;
  const content = { version: row.version, ownerId, channelId, baselineFingerprint: row.baselineFingerprint, family: row.family, requestedSeconds: row.requestedSeconds, baselineModuleConfig: row.baselineModuleConfig, moduleConfig: row.moduleConfig, pipeline: row.pipeline, ...(row.version === "duration-draft-candidate/v3" ? { sourceInception: row.sourceInception } : {}) };
  return sha256Hex(canonicalJson(content)) === row.fingerprint ? { pipeline: row.pipeline, moduleConfig: row.moduleConfig, sourceInception: row.version === "duration-draft-candidate/v3" ? row.sourceInception : null } : null;
}

/** Retained evidence was admitted by its service-only mutation; check its stored identity and hash again on read. */
export function verifiedRetainedEvidence(row: unknown, ownerId: string, channelId: string) {
  if (!record(row) || row.ownerId !== ownerId || String(row.channelId) !== channelId || typeof row.fingerprint !== "string" || typeof row.createdAt !== "number" || !record(row.candidate)) return null;
  const candidate = row.candidate;
  if (candidate.version !== "retained-pipeline-candidate/v1" || candidate.ownerId !== ownerId || candidate.channelId !== channelId || typeof candidate.sourceRunId !== "string" || !entries(candidate.entries) || !record(candidate.qualification) || !record(candidate.workerDeployment) || typeof candidate.workerDeployment.version !== "string") return null;
  if (sha256Hex(canonicalJson(candidate)) !== row.fingerprint) return null;
  return { fingerprint: row.fingerprint, createdAt: row.createdAt, sourceRunId: candidate.sourceRunId, workerVersion: candidate.workerDeployment.version, entries: candidate.entries };
}
