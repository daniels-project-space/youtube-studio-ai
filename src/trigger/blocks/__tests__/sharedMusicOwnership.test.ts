import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { _resetBlocks, registerAllBlocks } from "@/engine/blocks";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { all, getManifest, require_ } from "@/engine/registry";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { lockableModule } from "@/lib/ownerLockRegistry";
import { lofiBlocks } from "../lofiBlocks";
import { music } from "../musicBlocks";

async function main(): Promise<void> {
  for (const moduleName of ["musicBlocks", "blockContext"]) {
    const source = readFileSync(new URL(`../${moduleName}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'][^"']*lofiBlocks/,
      `${moduleName} must not depend on LoFi to execute shared music`);
  }
  assert.ok(!lofiBlocks.some((block) => block.id === "music"),
    "LoFi must not own or register the shared music block");
  assert.deepEqual(lockableModule("music")?.paths, [
    "src/trigger/blocks/blockContext.ts",
    // Golden also binds music_program_plan, which remains in LoFi.
    "src/trigger/blocks/lofiBlocks.ts",
    "src/trigger/blocks/musicBlocks.ts",
  ], "the generated Music owner lock must protect the implementation and its shared guards");
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
    assert.equal(getManifest("music")?.block, music);
    assert.equal(all().filter((block) => block.id === "music").length, 1);
    assert.equal(music.paid, true);
    assert.deepEqual(music.consumes, ["topic"]);
    assert.deepEqual(music.produces, [
      "musicKey", "musicProvider", "musicUrl", "channelMusicProgramKey",
      "channelMusicProgramFingerprint", "musicRuntimeReceiptKey",
      "musicNativeWavKey", "musicQualityReviewStatus",
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
