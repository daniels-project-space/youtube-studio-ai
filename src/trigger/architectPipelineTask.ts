/**
 * `architect-pipeline` — run the LLM Pipeline Architect on an EXISTING channel
 * (new channels get it automatically inside design-channel). dryRun returns
 * the full decision report without touching the channel — the validation mode.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { architectPipeline } from "@/engine/creative/architect";
import type { PipelineEntry } from "@/engine/types";
import type { ShowBible, StyleDNA, QualityBar } from "@/engine/creative/types";

/** Family KIND from the persisted template letter (channels don't store family). */
function familyFromTemplate(template?: string): string {
  if (template === "C") return "music_loop";
  if (template === "E") return "sleep";
  return "narrated_stock";
}

export const architectPipelineTask = task({
  id: "architect-pipeline",
  maxDuration: 600,
  run: async (payload: { channelId: string; dryRun?: boolean }) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[architect] ${m}`, x ?? "");
    await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channelId = payload.channelId as Id<"channels">;
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel) throw new Error(`channel not found: ${payload.channelId}`);

    const identity = channel.identity as
      | { niche?: string; persona?: string; creativeBrief?: ShowBible }
      | undefined;
    const dna = (channel as { styleDNA?: StyleDNA }).styleDNA ?? null;
    const bar = (channel as { qaRubric?: QualityBar }).qaRubric ?? null;
    if (!dna) {
      log("channel has NO Style DNA — the architect refuses to design blind (run design-channel grounding first)");
      return { ok: false, reason: "no styleDNA" };
    }

    let competitorCount = 0;
    try {
      if (identity?.niche) {
        const comps = await convex.query(api.competitors.listCompetitors, {
          ownerId: channel.ownerId,
          niche: identity.niche,
        });
        competitorCount = (comps as unknown[]).length;
      }
    } catch { /* evidence stays 0 — the architect will order repair */ }

    const arch = await architectPipeline({
      family: familyFromTemplate((channel as { template?: string }).template),
      channelName: channel.name,
      niche: identity?.niche,
      persona: identity?.persona,
      pipeline: (channel.pipeline ?? []) as PipelineEntry[],
      dna,
      bible: identity?.creativeBrief ?? null,
      qualityBar: bar,
      competitorCount,
      log,
    });
    if (!arch) return { ok: false, reason: "architect agent failed (floor kept)" };

    if (!payload.dryRun) {
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        pipeline: arch.pipeline,
        architectReport: arch.report,
      });
      log(`APPLIED: ${arch.report.applied.length} op(s); pipeline now ${arch.pipeline.length} blocks`);
    } else {
      log("DRY RUN — nothing written");
    }
    return {
      ok: true,
      dryRun: Boolean(payload.dryRun),
      report: arch.report,
      pipeline: arch.pipeline.map((e) => ({ block: e.block, params: e.params })),
    };
  },
});
