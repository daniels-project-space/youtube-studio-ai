/**
 * `refresh-show-bible` — backfill/refresh a channel's Show Bible + crew pipeline +
 * killer avatar. Runs in the Trigger cloud (ffmpeg + vault + LLM/fal keys present)
 * so it works without any local render. Idempotent: re-running rewrites the Bible,
 * ensures the crew brief blocks are in the pipeline, and regenerates the avatar.
 *
 * Used to migrate existing channels (e.g. Stoic Truths) onto the film-crew layer.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthShowBible } from "@/engine/creative/showBible";
import { generateChannelArt } from "@/lib/channelArt";
import { FAMILY_CREW, CREW_ROLE_BLOCK, type FamilyKey } from "@/engine/families";
import type { PipelineEntry } from "@/engine/types";

export interface RefreshShowBibleArgs {
  ownerId?: string;
  /** Resolve the channel by slug (preferred) or id. */
  slug?: string;
  channelId?: string;
  /** Format family for crew selection + Bible (default narrated_stock). */
  family?: FamilyKey;
  /** Operator-preferred iconic motif (e.g. the hooded stoic statue). */
  motifHint?: string;
  /** Target spoken length used to size crew briefs (seconds). */
  targetSeconds?: number;
  /** Regenerate the avatar from the new motif (default true). */
  regenerateArt?: boolean;
}

/** Insert the family's crew brief blocks after topic_select if missing. */
function withCrew(pipeline: PipelineEntry[], family: FamilyKey, targetSeconds?: number): PipelineEntry[] {
  const roles = FAMILY_CREW[family] ?? [];
  const crewIds = roles.map((r) => CREW_ROLE_BLOCK[r]).filter(Boolean);
  const present = new Set(pipeline.map((e) => e.block));
  const toAdd = crewIds.filter((id) => !present.has(id));
  if (toAdd.length === 0) return pipeline;
  const entries: PipelineEntry[] = toAdd.map((block) => ({
    block,
    params: { family, ...(targetSeconds ? { targetSeconds } : {}) },
  }));
  const at = pipeline.findIndex((e) => e.block === "topic_select");
  const i = at >= 0 ? at + 1 : 0;
  return [...pipeline.slice(0, i), ...entries, ...pipeline.slice(i)];
}

export const refreshShowBibleTask = task({
  id: "refresh-show-bible",
  maxDuration: 600,
  run: async (payload: RefreshShowBibleArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[refresh-show-bible] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    const ownerId = payload.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    // Resolve the channel (fully-typed Doc so the identity spread stays valid).
    const ch = payload.channelId
      ? await convex.query(api.channels.getChannel, { channelId: payload.channelId as Id<"channels"> })
      : payload.slug
        ? await convex.query(api.channels.getChannelBySlug, { ownerId, slug: payload.slug })
        : null;
    if (!ch) throw new Error("refresh-show-bible: channel not found (pass slug or channelId)");
    const identity = ch.identity;
    const family = (payload.family ?? "narrated_stock") as FamilyKey;
    const now = Date.now();

    // Competitor context (best-effort).
    let competitorContext = "";
    if (identity.niche) {
      const [nicheIntel, competitors] = await Promise.all([
        convex.query(api.seo.getNiche, { ownerId, niche: identity.niche }).catch(() => null),
        convex.query(api.competitors.listCompetitors, { ownerId, niche: identity.niche }).catch(() => []),
      ]);
      const titles = (competitors as { topVideos?: { title: string; views: number }[] }[])
        .flatMap((c) => c.topVideos ?? []).sort((a, b) => b.views - a.views).slice(0, 15).map((v) => v.title);
      const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
        .map((p) => p.word).slice(0, 14);
      competitorContext = [
        titles.length ? `Top titles:\n${titles.join("\n")}` : "",
        powerWords.length ? `Power words: ${powerWords.join(", ")}` : "",
      ].filter(Boolean).join("\n\n");
    }

    const creativeBrief = await synthShowBible({
      family, name: ch.name, niche: identity.niche, persona: identity.persona,
      styleGrammar: identity.styleGrammar, competitorContext, motifHint: payload.motifHint, now, log,
    });
    log("bible ready", { motif: creativeBrief.iconicMotif, crew: creativeBrief.activeCrew });

    // Regenerate the avatar from the new motif.
    let artFields: Partial<Awaited<ReturnType<typeof generateChannelArt>>> = {};
    if (payload.regenerateArt !== false) {
      try {
        artFields = await generateChannelArt(ownerId, ch.slug, {
          name: ch.name, persona: identity.persona, styleGrammar: identity.styleGrammar,
          palette: identity.palette, niche: identity.niche,
          iconicMotif: creativeBrief.iconicMotif, vibe: creativeBrief.vibe,
        }, log);
      } catch (e) { log(`art failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
    }

    // Ensure crew blocks are in the pipeline.
    const newPipeline = withCrew(ch.pipeline ?? [], family, payload.targetSeconds);

    await convex.mutation(api.channels.updateChannel, {
      channelId: ch._id,
      identity: { ...identity, ...artFields, creativeBrief },
      pipeline: newPipeline,
    });
    log("channel updated", { slug: ch.slug, crewBlocks: newPipeline.filter((e) => e.block.endsWith("_brief") || e.block === "critic_spec").length });

    return { ok: true, slug: ch.slug, motif: creativeBrief.iconicMotif, activeCrew: creativeBrief.activeCrew };
  },
});
