/**
 * `refresh-niche-research` Trigger tasks (competitor-intelligence engine).
 *
 * Thin Trigger wrappers around `refreshNicheResearchCore` (src/lib/nicheResearch
 * — the pure core, importable by blocks without task() side effects):
 *   - refreshNicheResearchTask     — callable; args {ownerId, niche, channelId?, force?}
 *   - refreshNicheResearchSchedule — weekly (Mon 06:00 UTC); refreshes every
 *                                    active channel's identity.niche.
 *
 * SOURCE: YouTube Data API v3 ONLY. Graceful degradation on missing keys.
 */
import { task, schedules } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  refreshNicheResearchCore,
  type RefreshArgs,
  type RefreshResult,
  type Logger,
} from "@/lib/nicheResearch";

export type { RefreshArgs, RefreshResult } from "@/lib/nicheResearch";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

/** Callable task — invoke from the pipeline / manually with args. */
export const refreshNicheResearchTask = task({
  id: "refresh-niche-research",
  maxDuration: 600,
  run: async (payload: RefreshArgs) => {
    await bootstrapSecrets((m, x) =>
      console.log(`[refresh-niche-research] ${m}`, x ?? ""),
    );
    return refreshNicheResearchCore(payload, (m, x) =>
      console.log(`[refresh-niche-research] ${m}`, x ?? ""),
    );
  },
});

/**
 * Scheduled weekly refresh. Iterates active channels and refreshes each
 * distinct niche (from identity.niche). Skips channels without a niche set.
 */
export const refreshNicheResearchSchedule = schedules.task({
  id: "refresh-niche-research-weekly",
  cron: "0 6 * * 1", // Mondays 06:00 UTC
  maxDuration: 1800,
  run: async () => {
    const log: Logger = (m, x) =>
      console.log(`[refresh-niche-research-weekly] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    const ownerId = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
    const convex = convexClient();
    const channels = await convex.query(api.channels.listChannels, { ownerId });
    const seen = new Set<string>();
    const results: RefreshResult[] = [];
    for (const ch of channels) {
      if (ch.status === "archived") continue;
      const niche = ch.identity?.niche;
      if (!niche || seen.has(niche)) continue;
      seen.add(niche);
      try {
        results.push(
          await refreshNicheResearchCore(
            { ownerId, niche, channelId: ch._id },
            log,
          ),
        );
      } catch (e) {
        log(`refresh failed for niche "${niche}": ${e instanceof Error ? e.message : e}`);
      }
    }
    log(`weekly refresh complete: ${results.length} niches`);
    return { ok: true, niches: results.length };
  },
});
