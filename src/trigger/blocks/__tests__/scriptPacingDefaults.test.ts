import assert from "node:assert/strict";
import Module from "node:module";
import type { StageContext } from "@/engine/types";
import type { ScriptRequest } from "@/lib/scriptGen";
import { narrationPhysicsFor, narrationSpeedForStyleDNA } from "@/engine/golden";

const stopBeforeGeneration = new Error("offline request captured before generation");
let captured: ScriptRequest | undefined;
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (request === "@/lib/scriptGen") return {
    ...resolved,
    synthScript: async (req: ScriptRequest) => {
      captured = req;
      throw stopBeforeGeneration;
    },
  };
  if (request === "@/lib/creativeText") return { ...resolved, hasCreativeTextKey: () => false };
  return resolved;
};

async function main(): Promise<void> {
  try {
    globalThis.fetch = async () => { throw new Error("Unexpected network call in offline pacing regression"); };
    const { scriptGen } = await import("../narratedBlocks");
    const base: StageContext = {
      ownerId: "pacing-owner", channelId: "pacing-channel", runId: "pacing-run",
      keyPrefix: "test/pacing/", budgetUsd: 0, params: {}, log: () => {},
      store: { topic: "Letting an unfinished chore wait", niche: "meditation" },
    };
    async function request(
      params: StageContext["params"] = {},
      store: StageContext["store"] = base.store,
    ): Promise<ScriptRequest> {
      captured = undefined;
      await assert.rejects(() => scriptGen.run({ ...base, params, store }), (error) => error === stopBeforeGeneration);
      // TypeScript does not track the async mock callback's assignment.
      const result = captured as ScriptRequest | undefined;
      assert.ok(result, "the actual script block must reach its synthesis request");
      return result;
    }

    const physics = narrationPhysicsFor("meditation");
    assert.equal(physics.speed, 0.85);
    assert.equal(physics.sentenceGap, 1.25);
    const defaults = await request();
    assert.equal(defaults.sentenceGapSec, physics.sentenceGap, "omitted gap must match narration_tts's 1.25s, not script's 0s default");
    assert.equal(defaults.ttsSpeed, physics.speed, "omitted speed must match narration_tts's 0.85x, not script's 1x default");

    for (const narrative of [{ pacing: "gentle and unhurried" }, { delivery: "energetic" }]) {
      const dna = await request({}, { ...base.store, styleDNA: { narrative } });
      assert.equal(dna.ttsSpeed, narrationSpeedForStyleDNA(narrative), "authored pacing/delivery outranks niche speed");
      assert.equal(dna.sentenceGapSec, physics.sentenceGap, "Style DNA does not replace the niche gap");
    }
    const explicit = await request({ sentenceGapSec: 0, ttsSpeed: 1.1 }, {
      ...base.store, styleDNA: { narrative: { pacing: "very slow" } },
    });
    assert.equal(explicit.sentenceGapSec, 0, "explicit zero gap must survive default resolution");
    assert.equal(explicit.ttsSpeed, 1.1, "explicit speed outranks Style DNA and physics");
    const gapOnly = await request({ sentenceGapSec: 0 });
    assert.equal(gapOnly.sentenceGapSec, 0);
    assert.equal(gapOnly.ttsSpeed, physics.speed);
    const speedOnly = await request({ ttsSpeed: 1 });
    assert.equal(speedOnly.ttsSpeed, 1, "explicit native speed is intentional");
    assert.equal(speedOnly.sentenceGapSec, physics.sentenceGap);
    for (const niche of [undefined, "unrecognized niche"]) {
      const fallback = await request({}, { topic: base.store.topic, niche });
      const neutral = narrationPhysicsFor(niche);
      assert.equal(fallback.ttsSpeed, neutral.speed);
      assert.equal(fallback.sentenceGapSec, neutral.sentenceGap ?? 0.85);
    }
    for (const ttsSpeed of [null, "0.93", NaN, Infinity, 0, 4]) {
      captured = undefined;
      await assert.rejects(() => scriptGen.run({ ...base, params: { ttsSpeed } }), /script_gen: ttsSpeed must be a finite/);
      assert.equal(captured, undefined, "invalid speed must fail before generation");
    }
    console.log("script_gen effective pacing defaults passed (actual request, offline)");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
