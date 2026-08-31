import type { Block } from "@/engine/types";
import { EpisodeGraphSchema } from "@/engine/episodeGraph";
import { StorySpineSchema } from "@/engine/storySpine";
import {
  bindNarrativeEpisodeToSeries,
  createNarrativeShotControlContract,
} from "@/engine/narrativeSeriesIntelligence";
import { parseChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import {
  assertNarrativeSeriesAcceptedCharacterAdapters,
  assertNarrativeSeriesRunAdmission,
  NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY,
  NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK,
  parseNarrativeSeriesRunSelector,
} from "@/lib/narrativeSeriesRunAdmission";
import {
  getAcceptedCharacterLoRARecord,
  getNarrativeSeriesPlanRecord,
  recordNarrativeEpisodeReceipt,
} from "@/lib/narrativeSeriesStateRuntime";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../../convex/_generated/dataModel";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function storySpineFromStore(store: Readonly<Record<string, unknown>>) {
  return StorySpineSchema.parse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
}

/**
 * Provider-free continuity bridge for a future admitted serialized cinematic
 * route. It neither trains nor calls an adapter: it records an immutable
 * binding/shot contract and exposes opaque references to adapters that were
 * already accepted outside the run.
 */
export const narrativeSeriesVisualControlsBlock: Block = {
  id: NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK,
  consumes: [
    "serializedProgramEpisodeContext",
    "timedScript",
    "narrativeBeats",
    "continuityLedger",
    "shotList",
    "dpVisualSpecs",
    "editorEdl",
    "storyCoverage",
    "episodeGraph",
  ],
  produces: [
    "narrativeEpisodeBinding",
    "narrativeShotControl",
    "narrativeAcceptedCharacterAdapters",
  ],
  run: async (ctx) => {
    const selector = parseNarrativeSeriesRunSelector(
      ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY],
    );
    const route = parseChannelProgramRouteRunSeed(ctx.store["channelProgramRoute"]);
    if (!route.serializedProgram) {
      throw new Error("narrative_series_visual_controls requires a serialized_program/v1 route");
    }
    const client = convex();
    const record = await getNarrativeSeriesPlanRecord({
      client,
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      fingerprint: selector.seriesPlanFingerprint,
    });
    if (
      !record ||
      record.ownerId !== ctx.ownerId ||
      String(record.channelId) !== ctx.channelId ||
      record.fingerprint !== selector.seriesPlanFingerprint
    ) {
      throw new Error("narrative_series_visual_controls cannot reload its immutable owner-scoped series plan");
    }
    const admission = assertNarrativeSeriesRunAdmission({
      selector,
      plan: record.plan,
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      routeSeed: route,
    });
    const adapterEntries = await Promise.all(
      admission.selector.acceptedCharacterAdapters.map(async (adapter) => {
        const accepted = await getAcceptedCharacterLoRARecord({
          client,
          ownerId: ctx.ownerId,
          channelId: ctx.channelId as Id<"channels">,
          characterId: adapter.characterId,
          characterSpecFingerprint: adapter.characterSpecFingerprint,
        });
        if (!accepted) {
          throw new Error("narrative_series_visual_controls found no accepted character LoRA for its frozen selector");
        }
        return accepted.entry;
      }),
    );
    const acceptedAdapters = assertNarrativeSeriesAcceptedCharacterAdapters({
      admission,
      entries: adapterEntries,
    });
    const storySpine = storySpineFromStore(ctx.store);
    const episodeGraph = EpisodeGraphSchema.parse(ctx.store["episodeGraph"]);
    const episodeBinding = bindNarrativeEpisodeToSeries({
      plan: admission.plan,
      serializedEpisodeContext: ctx.store["serializedProgramEpisodeContext"],
      episodeGraph,
      storySpine,
    });
    const shotControl = createNarrativeShotControlContract({
      binding: episodeBinding,
      // The complete Program Route run seed is a sealed immutable project
      // brief at this point; its fingerprint guards against route drift.
      immutableProjectBriefFingerprint: selector.routeRunSeedFingerprint,
      visualStyle: admission.plan.visualStyle,
      episodeGraph,
      storySpine,
    });
    await recordNarrativeEpisodeReceipt({
      client,
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      seriesPlanFingerprint: admission.plan.fingerprint,
      episodeBinding,
      shotControl,
    });
    const currentCharacterIds = new Set(episodeGraph.characters.map((character) => character.id));
    const currentAdapters = acceptedAdapters.filter((adapter) => currentCharacterIds.has(adapter.characterId));
    ctx.log(
      `${NARRATIVE_SERIES_VISUAL_CONTROL_BLOCK}: episode ${episodeBinding.episodeNumber} ` +
        `binding ${episodeBinding.fingerprint.slice(0, 12)} controls ${shotControl.fingerprint.slice(0, 12)} ` +
        `accepted-adapters ${currentAdapters.length}; provider calls: 0`,
    );
    return {
      narrativeEpisodeBinding: episodeBinding,
      narrativeShotControl: shotControl,
      narrativeAcceptedCharacterAdapters: currentAdapters,
    };
  },
};

export const narrativeSeriesVisualControlsBlocks: Block[] = [
  narrativeSeriesVisualControlsBlock,
];
