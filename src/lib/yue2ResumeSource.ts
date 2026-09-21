import { createHash } from "node:crypto";
import { z } from "zod";
import { YuE2SourceApprovalBasisSchema } from "@/engine/yue2SourceApproval";
import { canonicalJson } from "./canonicalJson";
import { sha256Hex } from "./sha256";
import { getObjectBytes } from "./storage";
import { getStudioPrivateBucket } from "./studioPrivateStorage";

const checkpointSchema = z.object({
  state: z.literal("consumed"),
  basis: YuE2SourceApprovalBasisSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  approvalFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

/** Pre-spend byte availability check; never dispatches inference or grants publishing authority. */
export async function verifyYuE2ResumeSource(input: {
  ownerId: string; channelId: string; runId: string; invocationSha256: string;
  readApproved: () => Promise<unknown>;
  assertLease: () => Promise<void>;
}, readBytes = getObjectBytes) {
  await input.assertLease();
  const approved = checkpointSchema.parse(await input.readApproved());
  const basis = approved.basis;
  if (basis.ownerId !== input.ownerId || basis.channelId !== input.channelId || basis.runId !== input.runId ||
    basis.invocationSha256 !== input.invocationSha256 || approved.fingerprint !== sha256Hex(canonicalJson(basis))) {
    throw new Error("YuE2 resume source scope or invocation mismatch");
  }
  // The listening digest was independently verified at owner approval. Only
  // those exact bytes need reloading here, not all native/pre-clamp versions.
  const pcmBytes = basis.nativeFrames * 8;
  if (!Number.isSafeInteger(pcmBytes) || pcmBytes > 256 * 1024 * 1024 - 65536) {
    throw new Error("YuE2 resume source exceeds the bounded native audio size");
  }
  const bytes = await readBytes(basis.listeningAudioKey, getStudioPrivateBucket(), {
    timeoutMs: 120_000, maxBytes: pcmBytes + 65536,
  });
  if (bytes.byteLength < pcmBytes + 44 || bytes.byteLength > pcmBytes + 65536 ||
    createHash("sha256").update(bytes).digest("hex") !== basis.listeningAudioSha256) {
    throw new Error("YuE2 resume source no longer matches the approved listening bytes");
  }
  const current = checkpointSchema.parse(await input.readApproved());
  if (canonicalJson(current) !== canonicalJson(approved)) throw new Error("YuE2 approval changed during source preflight");
  await input.assertLease();
  return { listeningAudioSha256: basis.listeningAudioSha256, byteLength: bytes.byteLength };
}
