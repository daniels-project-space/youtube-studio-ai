/**
 * `architect-pipeline` — run the LLM Pipeline Architect on an EXISTING channel
 * (new channels get it automatically inside design-channel). The task returns
 * a proposal; activating a pipeline requires the separate release workflow.
 */
import { task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { architectPipeline } from "@/engine/creative/architect";
import type { PipelineEntry } from "@/engine/types";
import type { ShowBible, StyleDNA, QualityBar } from "@/engine/creative/types";

/**
 * LEGACY fallback only: template letter → family guess, for channels created
 * before `family` was persisted (it collapses whiteboard/shorts/comic into
 * narrated_stock — the reason family is now a stored field).
 */
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
    // The architect is the approved non-Google creative-text route. Its own
    // boundary enforces the pinned OpenRouter Gemini Flash capability.
    await bootstrapSecrets(log);

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
    } catch (e) {
      // The architect DOES order repair on zero evidence, so degrading is right.
      // But "the query failed" and "this niche genuinely has no tracked
      // competitors" produce the same 0 and used to read identically.
      log(
        `competitor evidence UNAVAILABLE — designing on 0 competitors, which will ` +
          `order repair (${e instanceof Error ? e.message : e})`,
      );
    }

    const arch = await architectPipeline({
      // Persisted family is the source of truth; template letter is the
      // legacy-row fallback. Operator hard rail (disabledBlocks) rides along
      // so no later architect pass can re-add wizard-disabled modules.
      family:
        (channel as { family?: string }).family ??
        familyFromTemplate((channel as { template?: string }).template),
      channelName: channel.name,
      niche: identity?.niche,
      persona: identity?.persona,
      pipeline: (channel.pipeline ?? []) as PipelineEntry[],
      dna,
      bible: identity?.creativeBrief ?? null,
      qualityBar: bar,
      competitorCount,
      disabledBlocks: (channel as { disabledBlocks?: string[] }).disabledBlocks ?? [],
      log,
    });
    if (!arch) return { ok: false, reason: "architect agent failed (floor kept)" };

    log("PROPOSAL ONLY — active channel pipeline unchanged");
    return {
      ok: true,
      dryRun: true,
      report: arch.report,
      pipeline: arch.pipeline.map((e) => ({ ...e })),
    };
  },
});
