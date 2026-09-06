/**
 * `make-multilingual` — clone a base channel into language siblings (DE, ES …)
 * that form a GROUP. A new sibling needs its own localized identity art; that
 * paid work is intentionally not performed by this legacy task because it has
 * no signed per-stage provider admission. Existing group reconciliation remains
 * safe and idempotent.
 *
 * Phase 1: siblings are fully-functional standalone localized channels. Phase 2
 * (render-group reuse) will let them reuse the base render instead of re-rendering.
 */
import { task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { PipelineEntry } from "@/engine/types";

export interface MakeMultilingualArgs {
  // No ownerId. Every sibling inherits the BASE channel's owner, which this
  // task resolves from channelId. An optional ownerId here was declared and
  // never read, which is worse than absent: it reads like a way to place the
  // siblings under a different owner, and silently was not one.
  channelId: string;
  /** Target language codes for the siblings (base stays as-is). */
  languages: string[];
}

/** Ensure emit_bundle is in the base pipeline (before cleanup) so base runs fan out. */
function withEmitBundle(pipeline: PipelineEntry[]): PipelineEntry[] {
  if (pipeline.some((e) => e.block === "emit_bundle")) return pipeline;
  const at = pipeline.findIndex((e) => e.block === "cleanup");
  const entry: PipelineEntry = { block: "emit_bundle" };
  if (at >= 0) return [...pipeline.slice(0, at), entry, ...pipeline.slice(at)];
  return [...pipeline, entry];
}

export const makeMultilingualTask = task({
  id: "make-multilingual",
  maxDuration: 600,
  run: async (payload: MakeMultilingualArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[make-multilingual] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const base = await convex.query(api.channels.getChannel, {
      channelId: payload.channelId as Id<"channels">,
    });
    if (!base) throw new Error("make-multilingual: base channel not found");

    const groupId = base.groupId ?? base._id;
    // Resolve the requested delta before changing the base. Creating a new
    // sibling used to trigger a direct paid flag-banner render with no
    // compiler-signed aggregate envelope or provider lifecycle. Do not create
    // a visually downgraded sibling by silently reusing the base banner.
    const existing = await convex.query(api.channels.listGroup, { groupId });
    const haveLangs = new Set(existing.map((c) => c.language).filter(Boolean));
    const newLanguages = payload.languages.filter(
      (lang) => lang !== (base.language ?? "en") && !haveLangs.has(lang),
    );
    if (newLanguages.length) {
      throw new Error(
        `make-multilingual refuses to create ${newLanguages.join(", ")}: localized identity art requires an admitted per-sibling provider envelope and lifecycle. Use the structured channel-inception flow.`,
      );
    }

    // Mark the base as the group's base + ensure emit_bundle is in its pipeline so
    // its runs persist the asset bundle and fan out to siblings (idempotent).
    const basePipeline = withEmitBundle((base.pipeline ?? []) as PipelineEntry[]);
    const baseWrite = await convex.mutation(api.channels.updateChannel, {
      channelId: base._id,
      groupId,
      language: base.language ?? "en",
      groupRole: "base",
      pipeline: basePipeline,
    });
    if ((baseWrite as { state?: string; blockId?: string }).state === "module_locked") {
      throw new Error(
        `make-multilingual refused: module '${(baseWrite as { blockId?: string }).blockId ?? "unknown"}' is locked`,
      );
    }
    if ((baseWrite as { state?: string }).state === "channel_locked") {
      throw new Error("make-multilingual refused: the owner locked this channel");
    }

    const skipped = payload.languages.filter((lang) =>
      lang === (base.language ?? "en") || haveLangs.has(lang),
    );
    log("no-op group reconciliation complete; sibling creation requires admitted identity art", { skipped });
    return { ok: true, groupId, base: base.slug, created: [], skipped };
  },
});
