import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => sha256Hex(canonicalJson(value));
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function verifyDurationCandidateLocalReceipt(value: unknown, expected: { ownerId?: string; channelId: string; candidateFingerprint: string; baselineFingerprint: string; pipeline: unknown; moduleConfig: unknown }) {
  if (!object(value) || !object(value.body) || !fingerprint(value.fingerprint)) return null;
  const body = value.body;
  if (body.version !== "duration-candidate-local-preflight-receipt/v1" || body.channelId !== expected.channelId || body.candidateFingerprint !== expected.candidateFingerprint || body.baselineFingerprint !== expected.baselineFingerprint || body.pipelineFingerprint !== hash(expected.pipeline) || body.moduleConfigFingerprint !== hash(expected.moduleConfig) || body.provenance !== "owner-supplied-options-unattested" || body.workerAttestation !== null || body.dispatchAuthorized !== false || body.channelQualification !== false || typeof body.ownerId !== "string" || !body.ownerId || (expected.ownerId !== undefined && body.ownerId !== expected.ownerId) || ![body.routeReceiptFingerprint, body.routeBindingFingerprint, body.localCompilationFingerprint, body.sourceOptionsFingerprint, body.sourceInceptionRequestFingerprint].every(fingerprint) || hash(body) !== value.fingerprint) return null;
  return { fingerprint: value.fingerprint, routeReceiptFingerprint: body.routeReceiptFingerprint as string, localCompilationFingerprint: body.localCompilationFingerprint as string };
}
