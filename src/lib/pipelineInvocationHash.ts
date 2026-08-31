import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { stableJson } from "@/lib/publishingPolicy";
import { sha256Hex } from "@/lib/sha256";

export function pipelineInvocationSha256(
  snapshot: PipelineInvocationSnapshot,
): string {
  // This hash is also verified inside Convex queries/mutations. Use the
  // portable synchronous SHA-256 implementation rather than Node crypto so
  // the exact same invocation fence can bundle in both runtimes.
  return sha256Hex(stableJson(normalizePipelineInvocationSnapshot(snapshot)));
}
