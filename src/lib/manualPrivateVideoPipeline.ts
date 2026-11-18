import type { PipelineEntry } from "@/engine/types";
import { assertPrivateVideoHasNoDelivery } from "@/engine/privateVideoDelivery";
import { PRIVATE_PROBE_THUMBNAIL_MODE_PARAM } from "@/lib/channelInceptionProbeContract";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";

/** Full-length private form; intentionally defers the thumbnail, not the video. */
export function buildManualPrivateVideoPipeline(source: readonly PipelineEntry[]): PipelineEntry[] {
  const pipeline = buildRouteQualificationBenchmarkPipeline(source)
    .filter(entry => entry.block !== "thumbnail_gen")
    .map(entry => entry.block === "qa_visual"
      ? { ...entry, params: { ...entry.params, [PRIVATE_PROBE_THUMBNAIL_MODE_PARAM]: "deferred_mvp" } }
      : entry.block === "assemble"
        ? { ...entry, params: { ...entry.params, exactFinalDuration: true } }
        : entry);
  assertPrivateVideoHasNoDelivery(pipeline);
  return pipeline;
}
