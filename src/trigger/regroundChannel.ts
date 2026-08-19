/**
 * `reground-channel` — thin Trigger wrapper around `regroundChannelCore`.
 *
 * Repairs a LEGACY channel that has no `styleDNA`/`qaRubric` (and is therefore
 * permanently refused by `architect-pipeline`) by DERIVING those two fields
 * from the identity the channel already has. It never re-runs inception, never
 * renames the channel, never touches persona / creativeBrief / voice / art.
 *
 * Why a Trigger task and not a Convex action: `synthStyleDNA` pulls in the
 * Mastra agent runtime plus the Anthropic and Gemini SDKs and runs a
 * multi-iteration produce/critique loop (minutes, several LLM calls). Every
 * other caller of `synthStyleDNA` in this repo — `designChannelInception` — is
 * a Trigger task for exactly those reasons, and secrets arrive via
 * `bootstrapSecrets()` from the vault, which is a Trigger-side convention.
 * Convex functions in this repo stay in the Convex runtime and do the DB work.
 *
 * USAGE (operator, once the family mapping is confirmed):
 *   reground-channel  { channelId, family: "music_loop", dryRun: true }
 *   reground-channel  { channelId, family: "music_loop" }
 *
 * `family` is MANDATORY and is not guessed. `dryRun` returns the DNA + rubric
 * it would write and writes nothing. An already-grounded channel is refused
 * unless `force: true`.
 *
 * WRITE PATH / SIDE EFFECTS (honest accounting): the patch handed to
 * `api.channels.updateChannel` contains ONLY `styleDNA` + `qaRubric`. That
 * mutation additionally, by its own design, (a) stamps `contentLane` on legacy
 * rows, (b) forks the write onto a v2 row if the channel is LOCKED (surfaced in
 * the return value as `writeOutcome.forked`), and (c) invalidates persisted
 * inception proofs rooted at `channel-inception-positioning`, which sets
 * `status: "draft"` — but only for channels that actually carry an `inception`
 * ledger. Legacy pre-DNA rows have none, so (c) is a no-op for them. Run with
 * `dryRun: true` first and check the channel's `inception`/`locked` state
 * before the real call.
 */
import { task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthStyleDNA, buildQualityBar } from "@/engine/creative/styleDNA";
import {
  regroundChannelCore,
  type RegroundChannelRecord,
  type RegroundGrounding,
  type RegroundResult,
} from "@/engine/creative/regroundChannel";
import type { FamilyKey } from "@/engine/families";

export interface RegroundChannelPayload {
  channelId: string;
  /** MANDATORY — never inferred. See `assertExplicitFamily`. */
  family: FamilyKey;
  force?: boolean;
  dryRun?: boolean;
}

/** Read-only niche signals (mirrors designChannelInception's groundingSignals). */
async function loadGrounding(
  convex: ConvexHttpClient,
  ownerId: string,
  niche?: string,
): Promise<RegroundGrounding> {
  if (!niche) return {};
  const [nicheIntel, competitors, databank] = await Promise.all([
    convex.query(api.seo.getNiche, { ownerId, niche }).catch(() => null),
    convex.query(api.competitors.listCompetitors, { ownerId, niche }).catch(() => []),
    convex.query(api.seo.getDatabank, { ownerId, niche }).catch(() => null),
  ]);
  const titles = (competitors as { topVideos?: { title: string; views: number }[] }[])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 15)
    .map((v) => v.title);
  const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
    .map((e) => e.word)
    .slice(0, 14);
  return {
    titles,
    powerWords,
    thumbnailStyleGuide: (nicheIntel as RegroundGrounding | null)?.thumbnailStyleGuide,
    databank: (databank as RegroundGrounding["databank"] | null) ?? undefined,
  };
}

export const regroundChannelTask = task({
  id: "reground-channel",
  maxDuration: 600,
  run: async (payload: RegroundChannelPayload): Promise<RegroundResult> => {
    const log = (m: string, x?: Record<string, unknown>) =>
      console.log(`[reground-channel] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    return regroundChannelCore(
      {
        channelId: payload.channelId,
        family: payload.family,
        force: payload.force,
        dryRun: payload.dryRun,
      },
      {
        loadChannel: async (channelId) =>
          (await convex.query(api.channels.getChannel, {
            channelId: channelId as Id<"channels">,
          })) as RegroundChannelRecord | null,
        loadGrounding: (ownerId, niche) => loadGrounding(convex, ownerId, niche),
        synth: synthStyleDNA,
        buildBar: buildQualityBar,
        // ONLY styleDNA + qaRubric cross this boundary. `patch` is built and
        // key-asserted by buildRegroundPatch in the core.
        patchChannel: (channelId, patch) =>
          convex.mutation(api.channels.updateChannel, {
            channelId: channelId as Id<"channels">,
            styleDNA: patch.styleDNA,
            qaRubric: patch.qaRubric,
          }),
        now: () => Date.now(),
        log,
      },
    );
  },
});
