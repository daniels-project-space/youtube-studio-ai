import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes, putObject } from "@/lib/storage";
import {
  planWeekPreparedScriptKey, planWeekPreparedNarrationKey, planWeekPreparedMusicKey,
  planWeekPreparedImagesKey, planWeekPreparationManifestSha256, type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";

const destinations = { script: planWeekPreparedScriptKey, narration: planWeekPreparedNarrationKey,
  music: planWeekPreparedMusicKey, images: planWeekPreparedImagesKey };

/** Only a newly created, re-read claim permits work. No expiry authorizes replay. */
export async function claimPreparedGeneration(
  stage: keyof typeof destinations, manifest: PlanWeekPreparationManifest, request: unknown,
): Promise<void> {
  const key = `${destinations[stage](manifest)}.dispatch.json`;
  const bytes = Buffer.from(canonicalJson({
    version: "prepared-generation-dispatch/v1", stage,
    ownerId: manifest.ownerId, channelId: manifest.channelId, batchId: manifest.batchId, itemId: manifest.itemId,
    manifestSha256: planWeekPreparationManifestSha256(manifest),
    requestSha256: sha256Hex(canonicalJson(request)), costUsd: null,
  }));
  try {
    // A timed-out SDK write may still commit. Its later success cannot admit work.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        putObject(key, bytes, { contentType: "application/json", ifNoneMatch: "*" }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("claim write deadline")), 30_000); }),
      ]);
    } finally { clearTimeout(timer); }
    const saved = await getObjectBytes(key, undefined, { maxBytes: bytes.byteLength, timeoutMs: 30_000 });
    if (saved.byteLength !== bytes.byteLength || sha256BytesHex(saved) !== sha256BytesHex(bytes)) {
      throw new Error("claim readback mismatch");
    }
  } catch {
    throw new AbortTaskRunError(
      `PAID_STAGE_RECONCILIATION_REQUIRED: prepared ${stage} dispatch not exclusively confirmed at ${key}; ` +
      "retain the claim and any provider results; do not regenerate or delete the claim to retry",
    );
  }
}
