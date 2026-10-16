import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { _resetBlocks, registerAllBlocks } from "@/engine/blocks";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { all, getManifest, require_ } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { lockableModule } from "@/lib/ownerLockRegistry";
import { musicReuseTestReceipt, musicReuseTestStyleDNA } from "./musicReuseFixtures";
import { assertMusicReuseReceipt } from "@/lib/musicReuseReceipt";
import { MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION } from "../providerAwareMusic";
import { LOFI_PIPELINE, lofiBlocks } from "../lofiBlocks";
import { music, musicFallbackPromptForRoute, musicProgramPlan } from "../musicBlocks";

async function main(): Promise<void> {
  for (const moduleName of ["musicBlocks", "blockContext"]) {
    const source = readFileSync(new URL(`../${moduleName}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'][^"']*lofiBlocks/,
      `${moduleName} must not depend on LoFi to execute shared music`);
  }
  const lofiSource = readFileSync(new URL("../lofiBlocks.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lofiSource, /(?:from\s*|import\s*\()\s*["'][^"']*musicBlocks/,
    "LoFi must provide route intent without importing shared Music implementations");
  assert.ok(!lofiBlocks.some((block) => block.id === "music"),
    "LoFi must not own or register the shared music block");
  assert.ok(!lofiBlocks.some((block) => block.id === "music_program_plan"),
    "LoFi must not own or register the shared music planner");
  const lofiMusicParams = LOFI_PIPELINE.find((entry) => entry.block === "music")?.params as
    | Record<string, unknown>
    | undefined;
  assert.equal(
    lofiMusicParams?.provider,
    undefined,
    "the legacy LoFi composition must not override its route-sealed music provider",
  );
  assert.equal(
    (LOFI_PIPELINE.find((entry) => entry.block === "music_program_plan")?.params as Record<string, unknown> | undefined)?.visualStyle,
    "lofi ambient",
    "LoFi must pass its style intent explicitly instead of relying on a shared-module default",
  );
  assert.ok(
    LOFI_PIPELINE.findIndex((entry) => entry.block === "music_program_plan") <
      LOFI_PIPELINE.findIndex((entry) => entry.block === "scene_planner"),
    "legacy LoFi seals its shared music program before scene planning reads it",
  );
  const fallbackInput = {
    family: "music_loop",
    topic: "Rain over the glasshouse",
    channelIdentitySeed: "personal-channel",
  };
  assert.match(musicFallbackPromptForRoute({ ...fallbackInput, contentLaneKey: "music_loop" }), /lo-fi/iu,
    "the shared Lo-Fi prompt must preserve the family identity without pinning every channel to one genre");
  const primaryMusicVideo = musicFallbackPromptForRoute({
    ...fallbackInput,
    family: "cinematic",
    contentLaneKey: "music_video",
  });
  assert.match(primaryMusicVideo, /instrumental/u);
  assert.doesNotMatch(primaryMusicVideo, /lofi|underscore|no percussion|no drums|very low dynamics/iu,
    "non-Lo-Fi primary-music routes must not receive the shared narration-bed prompt");
  assert.doesNotMatch(
    musicFallbackPromptForRoute({ ...fallbackInput, contentLaneKey: "music_loop", role: "sleep_sound_bed" }),
    /lofi|boom-bap|vinyl crackle/iu,
    "an explicit specialized Composer role must also override the family default",
  );
  for (const contentLaneKey of ["sleep", "meditation"]) {
    assert.doesNotMatch(
      musicFallbackPromptForRoute({ ...fallbackInput, contentLaneKey }),
      /lofi|boom-bap|vinyl crackle/iu,
      `${contentLaneKey} intent must not inherit the LoFi-only fallback prompt`,
    );
  }
  const musicOwnerPaths = lockableModule("music")?.paths ?? [];
  assert.ok(musicOwnerPaths.includes("src/trigger/blocks/blockContext.ts") &&
    musicOwnerPaths.includes("src/trigger/blocks/musicBlocks.ts") &&
    musicOwnerPaths.includes("src/trigger/blocks/musicReleaseGate.ts"),
  "the generated Music owner lock must protect its implementation and release policy");
  assert.ok(!musicOwnerPaths.includes("src/trigger/blocks/lofiBlocks.ts"),
    "the Music owner lock must not claim LoFi's visual implementation");
  assert.ok(!lockableModule("lofi")?.paths.includes("src/trigger/blocks/musicReleaseGate.ts"),
    "the Lo-Fi owner lock must not claim the shared Music release policy");
  for (const owner of ["lofi", "topic-intel", "ship", "shorts"]) {
    assert.ok(lockableModule(owner)?.paths.includes("src/trigger/blocks/blockContext.ts"),
      `${owner} must retain protection of helpers extracted from LoFi`);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected network call in music reuse"); };
  _resetBlocks();
  try {
    registerAllBlocks();
    registerAllBlocks();
    assert.equal(require_("music"), music, "the real registry must resolve the shared implementation");
    assert.equal(require_("music_program_plan"), musicProgramPlan,
      "the central registry must resolve the planner from the shared Music module");
    assert.equal(all().filter((block) => block.id === "music_program_plan").length, 1,
      "the shared Music planner must be registered exactly once");
    assert.equal(getManifest("music")?.block, music);
    const plannedMusicEntry = LOFI_PIPELINE.find((entry) => entry.block === "music");
    assert.equal(plannedMusicEntry?.version, MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION,
      "canonical Lo-Fi must select the music module contract that requires its sealed plan");
    const plannedMusicManifest = getManifest("music", MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION)!;
    assert.ok(plannedMusicManifest.consumes.musicProgramPlan);
    assert.equal(plannedMusicManifest.optionalConsumes.musicProgramPlan, undefined);
    assert.ok(plannedMusicManifest.requiredCapabilities.includes("music.program.sealed"));
    assert.deepEqual(plannedMusicManifest.block.consumes, ["topic", "musicProgramPlan"]);
    assert.doesNotThrow(() => validatePipeline([
      { block: "music_program_plan" },
      { block: "music", version: MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION },
    ], ["topic"]), "the sealed music planner must satisfy the shared generator contract");
    assert.throws(() => validatePipeline([
      { block: "music", version: MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION },
    ], ["topic"]), /requires upstream capability "music\.program\.sealed"/);
    assert.doesNotThrow(() => validatePipeline([{ block: "music" }], ["topic"]),
      "the legacy shared music contract must remain usable without a planner");
    assert.equal(all().filter((block) => block.id === "music").length, 1);
    assert.equal(music.paid, true);
    assert.deepEqual(music.consumes, ["topic"]);
    assert.deepEqual(music.produces, [
      "musicKey", "musicProvider", "musicUrl", "channelMusicProgramKey",
      "channelMusicProgramFingerprint", "musicRuntimeReceiptKey",
      "musicNativeWavKey", "musicAuditionSourceKey", "musicAuditionWavKey",
      "musicQualityReviewStatus",
    ]);

    for (const family of [undefined, "narrated_stock", "music_loop", "sleep"] as const) {
      const store: Record<string, unknown> = {
        topic: "Quiet focus after midnight",
        reuseMusicKey: "owner/test/base/music.mp3",
        styleDNA: musicReuseTestStyleDNA,
      };
      const ctx: StageContext = {
        ownerId: "owner-music-test",
        channelId: "channel-music-test",
        runId: "run-music-test",
        keyPrefix: "owner/test/channel/music/",
        params: {},
        store,
        budgetUsd: 0,
        log: () => {},
      };
      let route = resolveChannelProgramRoute(createChannelProgramBrief({
        family: "narrated_stock", nicheKey: "educational", locale: "en",
        concept: "Original calm sessions with a repeatable viewer promise.",
      }));
      if (family) {
        const brief = createChannelProgramBrief({
          family,
          nicheKey: family === "music_loop" ? "lofi" : "educational",
          locale: "en",
          concept: "Original calm sessions with a repeatable viewer promise.",
        });
        route = resolveChannelProgramRoute(brief);
        store.channelProgramRoute = channelProgramRouteRunSeed({
          route,
          programBrief: brief,
        });
      }
      store.reuseMusicReceipt = musicReuseTestReceipt({
        ownerId: "owner-music-test", baseRunId: "base-run", baseChannelId: "base-channel",
        siblingChannelId: "channel-music-test", family: route.family, contentLaneKey: route.contentLaneKey,
        provider: family === "music_loop" ? "minimax_music3" : "mureka",
        musicKey: "owner/test/base/music.mp3",
      });
      if (family === "music_loop") {
        await assert.rejects(
          require_("music").run(ctx),
          /Required|expected object|musicProgramPlan/i,
          "the registry must preserve sealed-program admission before reuse",
        );
        const planPatch = await require_("music_program_plan").run({
          ...ctx,
          params: { provider: "minimax_music3", visualStyle: "lofi" },
        });
        assert.deepEqual(Object.keys(planPatch), ["musicProgramPlan"],
          "the immutable program owns its fingerprint; do not publish a redundant fingerprint artifact");
        assert.equal(typeof (planPatch.musicProgramPlan as { fingerprint?: unknown }).fingerprint, "string");
        Object.assign(store, planPatch);
        assert.throws(() => assertMusicReuseReceipt({
          receipt: store.reuseMusicReceipt,
          ownerId: String(ctx.ownerId),
          siblingChannelId: String(ctx.channelId),
          musicKey: String(store.reuseMusicKey),
          currentFamily: route.family,
          currentContentLaneKey: route.contentLaneKey,
          currentProvider: "minimax_music3",
          currentStyleDNA: store.styleDNA,
        }), /MiniMax music reuse is disabled/u,
        "strict MiniMax channels generate per-channel until native review evidence transfer is supported");
        const makeChannelPlan = async (concept: string, dna: Record<string, unknown>) => {
          const channelBrief = createChannelProgramBrief({
            family: "music_loop",
            nicheKey: "lofi",
            locale: "en",
            concept,
          });
          const channelRoute = channelProgramRouteRunSeed({
            route: resolveChannelProgramRoute(channelBrief),
            programBrief: channelBrief,
          });
          const result = await musicProgramPlan.run({
            ...ctx,
            params: {},
            store: { topic: "Quiet focus after midnight", channelProgramRoute: channelRoute, styleDNA: dna },
          });
          return result.musicProgramPlan as {
            fingerprint: string;
            visual: { setting: string; visualStyle: string };
            audio: { direction: string };
          };
        };
        const glasshousePlan = await makeChannelPlan(
          "Rain-lit glasshouse listening sessions with a distinct warm character.",
          {
            setting: "rain on a greenhouse roof after dark",
            colorGrade: "deep emerald with warm brass highlights",
            audio: {
              genre: "hushed jazz-hop",
              instrumentation: ["felt piano", "upright bass"],
              textures: ["soft rain", "tape warmth"],
              bpmRange: [68, 76],
              moodArc: "intimate and gently hopeful",
            },
          },
        );
        const observatoryPlan = await makeChannelPlan(
          "Quiet observatory sessions beneath clear winter stars.",
          {
            setting: "a high mountain observatory under winter stars",
            colorGrade: "cold indigo with silver moonlight",
            audio: {
              genre: "spacious ambient piano",
              instrumentation: ["prepared piano", "glass harmonics"],
              textures: ["clean air", "distant wind"],
              bpmRange: [52, 60],
              moodArc: "still, spacious, and contemplative",
            },
          },
        );
        assert.notEqual(glasshousePlan.fingerprint, observatoryPlan.fingerprint,
          "distinct channel programs must seal distinct shared music plans");
        assert.notEqual(glasshousePlan.visual.setting, observatoryPlan.visual.setting,
          "the shared planner must retain each channel's setting");
        assert.notEqual(glasshousePlan.visual.visualStyle, observatoryPlan.visual.visualStyle,
          "the shared planner must retain each channel's color identity");
        assert.match(glasshousePlan.audio.direction, /hushed jazz-hop/u);
        assert.match(glasshousePlan.audio.direction, /felt piano, upright bass/u);
        assert.match(observatoryPlan.audio.direction, /spacious ambient piano/u);
        assert.match(observatoryPlan.audio.direction, /prepared piano, glass harmonics/u);

        await assert.rejects(
          require_("music").run({ ...ctx, params: { provider: "suno" } }),
          /does not match sealed music program provider/,
        );
      }
      if (family === "music_loop") continue;
      const result = await require_("music").run(ctx);
      assert.equal(result.musicKey, ctx.store.reuseMusicKey, family);
      assert.equal(result.musicProvider, "reuse", family);
      assert.equal(typeof result.musicUrl, "string", family);
      assert.ok(result.musicUrl, family);
      assert.equal(result.musicQualityReviewStatus, "not-required-reused-master", family);
      assert.equal(result[COST_PATCH_KEY], 0, family);
    }
  } finally {
    globalThis.fetch = originalFetch;
    _resetBlocks();
  }
  console.log("SHARED MUSIC OWNERSHIP PASS: registry ABI, admission and executable reuse across narration, Lo-Fi and sleep routes");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
