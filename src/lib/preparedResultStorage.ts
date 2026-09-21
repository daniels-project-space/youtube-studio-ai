import { performance } from "node:perf_hooks";
import { classifyExecutionError } from "@/engine/executionErrors";
import { getObjectBytes, putObject } from "@/lib/storage";
import { sha256BytesHex } from "@/lib/sha256";
import { preparedObjectAbsent } from "@/lib/preparedMediaStorage";

class PreparedWriteDeadline extends Error {}

/** Recover storage failures within the owning attempt, never generation or claims. */
export async function persistPreparedResult(
  key: string, body: Uint8Array, contentType: string, metadata: Record<string, string>,
): Promise<void> {
  if (key.endsWith(".dispatch.json")) throw new Error("dispatch claims cannot use result reconciliation");
  const deadline = performance.now() + (contentType === "application/json" ? 30_000 : 300_000);
  const digest = sha256BytesHex(body);
  const remaining = () => Math.max(0, Math.ceil(deadline - performance.now()));
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    const timeoutMs = remaining();
    if (!timeoutMs) throw new PreparedWriteDeadline("prepared result storage deadline; retain dispatch claim");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PreparedWriteDeadline("prepared result storage deadline; retain dispatch claim")), timeoutMs); }),
        operation(),
      ]);
    } finally { clearTimeout(timer); }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await bounded(() => putObject(key, body, { contentType, metadata: { ...metadata, sha256: digest }, ifNoneMatch: "*" }));
      return;
    } catch (error) {
      // A timed-out SDK write may still commit. Never overlap it with a new write.
      if (error instanceof PreparedWriteDeadline) throw error;
      let retained: Uint8Array;
      try {
        retained = await bounded(() => getObjectBytes(key, undefined, { maxBytes: body.byteLength, timeoutMs: remaining() }));
      } catch (readError) {
        if (!preparedObjectAbsent(readError)) throw readError;
        if (attempt === 2 || !classifyExecutionError(error).retryable) throw error;
        await bounded(() => new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1))));
        continue;
      }
      if (retained.byteLength !== body.byteLength || sha256BytesHex(retained) !== digest) {
        throw new Error(`STAGE_REUSE_RECONCILIATION_REQUIRED: prepared result differs at ${key}; retain claim and stored bytes`);
      }
      return;
    }
  }
}
