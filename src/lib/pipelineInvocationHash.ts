import { createHash } from "node:crypto";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { stableJson } from "@/lib/publishingPolicy";

export function pipelineInvocationSha256(
  snapshot: PipelineInvocationSnapshot,
): string {
  return createHash("sha256")
    .update(stableJson(normalizePipelineInvocationSnapshot(snapshot)))
    .digest("hex");
}
