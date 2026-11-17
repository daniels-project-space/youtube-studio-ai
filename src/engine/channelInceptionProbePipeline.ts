import type { PipelineEntry } from "./types";
import { PRIVATE_PROBE_THUMBNAIL_MODE_PARAM } from "@/lib/channelInceptionProbeContract";
import { isPrivateVideoDeliveryBlock } from "./privateVideoDelivery";

/** Build the bounded private proof pipeline without external publishing. */
export function buildChannelInceptionProbePipeline(
  source: readonly PipelineEntry[],
  options: { thumbnailMode?: "deferred_mvp" } = {},
): PipelineEntry[] {
  return source
    .filter((entry) =>
      !isPrivateVideoDeliveryBlock(entry.block) &&
      !(options.thumbnailMode === "deferred_mvp" && entry.block === "thumbnail_gen"),
    )
    .map((entry) => {
      const params: Record<string, unknown> = { ...(entry.params ?? {}) };
      if (entry.block === "qa_visual" && options.thumbnailMode === "deferred_mvp") {
        params[PRIVATE_PROBE_THUMBNAIL_MODE_PARAM] = "deferred_mvp";
      }
      if (entry.block === "topic_select") {
        params.dryRun = true;
        params.targetSeconds = 60;
      }
      if (entry.block === "script_gen") {
        params.maxSeconds = 60;
        params.endWithSummary = false;
      }
      if (entry.block === "length_check") {
        params.minSeconds = 20;
        params.maxSeconds = 220;
      }
      if (entry.block === "music") params.trackCount = 1;
      if (entry.block === "gen_footage") params.maxClips = 6;
      if (entry.block === "stock_footage") params.signatureGenClips = 0;
      if (entry.block === "visual_inserts") params.maxInserts = 1;
      if (entry.block === "quote_overlays") params.maxQuotes = 1;
      if (entry.block === "assemble") params.durationSec = 60;
      if (entry.block === "whiteboard_scribe") {
        params.targetSeconds = 60;
        params.width = 1280;
      }
      if (entry.block === "motion_comic") {
        params.panels = 4;
        params.width = 1280;
      }
      return { ...entry, params: Object.keys(params).length ? params : undefined };
    });
}
