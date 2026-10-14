import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { _resetBlocks, registerAllBlocks } from "@/engine/blocks";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { all, getManifest, require_ } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { lockableModule } from "@/lib/ownerLockRegistry";
import { MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION } from "../providerAwareMusic";
import { LOFI_PIPELINE, lofiBlocks } from "../lofiBlocks";
import { music, musicFallbackPromptForRoute, musicProgramPlan } from "../musicBlocks";

async function main(): Promise<void> {
  for (const moduleName of ["musicBlocks", "blockContext"]) {
    const source = readFileSync(new URL(`../${moduleName}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'][^"']*lofiBlocks/,
      `${moduleName} must not depend on LoFi to execute shared music`);
  }
  assert.ok(!lofiBlocks.some((block) => block.id === "music"),
    "LoFi must not own or register the shared music block");
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
  const fallbackInput = {
    family: "music_loop",
    topic: "Rain over the glasshouse",
    channelIdentitySeed: "personal-channel",
  };
  assert.match(musicFallbackPromptForRoute({ ...fallbackInput, contentLaneKey: "music_loop" }), /lofi hip-hop/u);
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
    musicOwnerPaths.includes("src/trigger/blocks/musicBlocks.ts"),
  "the generated Music owner lock must protect the implementation and its shared guards");
  assert.ok(!musicOwnerPaths.includes("src/trigger/blocks/lofiBlocks.ts"),
    "the Music owner lock must not claim LoFi's visual implementation");
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
      "the shared Music module must own the program planner registered into LoFi pipelines");
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

    for (const family of [undefined, "narrated_stock", "music_loop"] as const) {
      const store: Record<string, unknown> = {
        topic: "Quiet focus after midnight",
        reuseMusicKey: "owner/test/base/music.mp3",
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
      if (family) {
        const brief = createChannelProgramBrief({
          family,
          nicheKey: family === "music_loop" ? "lofi" : "educational",
          locale: "en",
          concept: "Original calm sessions with a repeatable viewer promise.",
        });
        store.channelProgramRoute = channelProgramRouteRunSeed({
          route: resolveChannelProgramRoute(brief),
          programBrief: brief,
        });
      }
      if (family === "music_loop") {
        await assert.rejects(
          require_("music").run(ctx),
          /Required|expected object|musicProgramPlan/i,
          "the registry must preserve sealed-program admission before reuse",
        );
        Object.assign(store, await require_("music_program_plan").run({
          ...ctx,
          params: { provider: "minimax_music3", visualStyle: "lofi" },
        }));
        await assert.rejects(
          require_("music").run({ ...ctx, params: { provider: "suno" } }),
          /does not match sealed music program provider/,
        );
      }
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
  console.log("SHARED MUSIC OWNERSHIP PASS: registry ABI, admission and executable reuse across channel families");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
