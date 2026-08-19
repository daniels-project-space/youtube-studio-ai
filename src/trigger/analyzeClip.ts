/**
 * `analyze-example-clip` is retained only as a safe compatibility endpoint for
 * legacy queued runs. The former provider-backed implementation is retired: it
 * must not claim to have analyzed a clip or reach a model provider.
 */
import { task } from "@trigger.dev/sdk";
import { exampleClipAnalysisUnavailable } from "@/lib/exampleClipAnalysisUnavailable";

export interface AnalyzeClipArgs {
  url: string;
}

export const analyzeClipTask = task({
  id: "analyze-example-clip",
  maxDuration: 180,
  run: async (payload: AnalyzeClipArgs) => {
    const url = (payload.url ?? "").trim();
    if (!url) throw new Error("url is required");
    return exampleClipAnalysisUnavailable();
  },
});
