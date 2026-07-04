/**
 * `build-channel-package` — autonomous channel creation from one seed idea.
 *
 *   seed → (best-effort niche research) → Claude concept → archetype pipeline
 *        → createChannel(draft) → Flux avatar+banner → validate graph
 *        → status active|draft.
 *
 * Fully autonomous: no mid-flight review. The channel is editable in the hub
 * afterward. validatePipeline is the "validation run" — a free graph check (no
 * blocks execute, no spend); only archetypes whose blocks are all registered
 * pass, so un-ported archetypes land as drafts until Stage 3.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthChannelConcept } from "@/lib/conceptSynth";
import { generateChannelArt } from "@/lib/channelArt";
import { getArchetype } from "@/engine/archetypes";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import type { PipelineEntry } from "@/engine/types";

export interface BuildChannelArgs {
  seed: string;
  ownerId?: string;
  budget?: number;
}

function slugify(name: string, now: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "channel"}-${now}`;
}

export const buildChannelPackageTask = task({
  id: "build-channel-package",
  maxDuration: 600,
  run: async (payload: BuildChannelArgs) => {
    const log = (m: string, x?: Record<string, unknown>) =>
      console.log(`[build-channel-package] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    registerAllBlocks();

    const seed = (payload.seed ?? "").trim();
    if (!seed) throw new Error("seed is required");
    const ownerId = payload.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    // 1. Concept (research-enriched once the YouTube Data API is enabled; the
    //    seed alone is sufficient today).
    const concept = await synthChannelConcept(seed, undefined, log);
    const archetype = getArchetype(concept.archetypeKey);
    const pipeline = archetype.pipeline as PipelineEntry[];

    // 2. Validate the chosen pipeline graph (free; no blocks execute).
    let valid = false;
    let validationError: string | undefined;
    try {
      validatePipeline(pipeline);
      valid = true;
    } catch (e) {
      validationError = e instanceof Error ? e.message : String(e);
      log(`pipeline not yet runnable (draft): ${validationError}`);
    }

    // 3. Create the channel (draft first; promoted to active if valid).
    const now = Date.now();
    const slug = slugify(concept.name, now);
    const identity = {
      persona: concept.persona,
      styleGrammar: concept.styleGrammar,
      palette: concept.palette,
      topicPool: concept.topicPool,
      bannedWords: concept.bannedWords,
      requiredCallbacks: [] as string[],
      cadence: concept.cadence,
      niche: concept.niche,
      voiceId: concept.voiceId,
      thumbnailTemplate: archetype.thumbnailTemplate,
    };
    const channelId = (await convex.mutation(api.channels.createChannel, {
      ownerId,
      slug,
      name: concept.name,
      identity,
      thumbnailer:
        archetype.thumbnailTemplate === "title_card" ? "title_card" : "banana",
      template: archetype.template,
      pipeline,
      budget: payload.budget ?? 5,
      status: "draft",
    })) as Id<"channels">;
    log("channel created", { channelId, slug, archetype: archetype.key });

    // 4. Channel art (avatar + banner), then persist keys onto the identity.
    try {
      const art = await generateChannelArt(
        ownerId,
        slug,
        {
          name: concept.name,
          persona: concept.persona,
          styleGrammar: concept.styleGrammar,
          palette: concept.palette,
          niche: concept.niche,
        },
        log,
      );
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        identity: { ...identity, ...art },
      });
    } catch (e) {
      log(`channel art failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }

    // 5. Promote iff the pipeline validated — to PAUSED, never straight to
    // active: this legacy path skips DNA/architect/probe grounding entirely,
    // and the fleet safety rule is that the autopilot scheduler never
    // auto-spends on a channel the operator hasn't flipped on. (Prefer the
    // design-channel wizard path; this seed path is kept for API back-compat.)
    const status = valid ? "paused" : "draft";
    await convex.mutation(api.channels.updateChannel, { channelId, status });

    log("done", { channelId, slug, status, archetype: archetype.key });
    return {
      ok: true,
      channelId,
      slug,
      name: concept.name,
      archetype: archetype.key,
      status,
      valid,
      validationError,
    };
  },
});
