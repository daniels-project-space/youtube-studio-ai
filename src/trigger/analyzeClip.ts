/**
 * `analyze-example-clip` — Gemini-analyzes a pasted YouTube clip and returns a
 * family/niche/style recommendation for the channel wizard. No download (Gemini
 * reads the YouTube URL directly).
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { analyzeClip } from "@/lib/clipAnalysis";

export interface AnalyzeClipArgs {
  url: string;
}

export const analyzeClipTask = task({
  id: "analyze-example-clip",
  maxDuration: 180,
  run: async (payload: AnalyzeClipArgs) => {
    await bootstrapSecrets((m) => console.log(`[analyze-clip] ${m}`));
    const url = (payload.url ?? "").trim();
    if (!url) throw new Error("url is required");
    const analysis = await analyzeClip(url);
    console.log("[analyze-clip] →", JSON.stringify(analysis).slice(0, 300));
    return { ok: true, analysis };
  },
});
