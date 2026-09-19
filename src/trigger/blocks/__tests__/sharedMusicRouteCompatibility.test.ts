import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { routeSeedForTopicSelection } from "../blockContext";
import { music } from "../musicBlocks";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("retained shared music must not call a provider");
  };
  try {
    for (const profile of ["world_geography", "sports_championship_timeline"] as const) {
      const brief = createChannelProgramBrief({
        family: "quizyear",
        nicheKey: "educational",
        locale: "en",
        concept: "Original fact-checked trivia with quiet instrumental accompaniment.",
        programIntent: profile === "sports_championship_timeline"
          ? { kind: "sports_championship_timeline" }
          : { kind: "certified_quiz", profile },
      });
      const route = resolveChannelProgramRoute(brief);
      const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
      const ctx: StageContext = {
        ownerId: "owner-shared-music",
        channelId: "channel-shared-music",
        runId: "run-shared-music",
        keyPrefix: "owner/test/channel/music/",
        params: {},
        store: {
          topic: "A complete geography quiz",
          channelProgramRoute: seed,
          reuseMusicKey: "owner/test/base/music.mp3",
        },
        budgetUsd: 0,
        log: () => {},
      };
      assert.ok(route.requiredBlocks.includes("quiz_topic_plan"));
      assert.ok(!route.requiredBlocks.includes("topic_select"));
      assert.throws(() => routeSeedForTopicSelection(ctx), /owned by a different planner/,
        "sharing music must not let a quiz use the generic topic planner");

      const output = await music.run(ctx);
      assert.equal(output.musicKey, ctx.store.reuseMusicKey, profile);
      assert.equal(output.musicProvider, "reuse", profile);
      assert.equal(output[COST_PATCH_KEY], 0, profile);
      assert.equal(calls, 0, "planner-independent music reuse must not spend");

      await assert.rejects(music.run({
        ...ctx,
        store: { ...ctx.store, channelProgramRoute: { ...seed, routeFingerprint: "invalid" } },
      }), { name: "ZodError" }, "the shared module must still reject malformed frozen routes before reuse");
      assert.equal(calls, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("SHARED MUSIC ROUTES PASS: certified quiz planners, zero-spend reuse, strict topic ownership and malformed-route rejection");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
