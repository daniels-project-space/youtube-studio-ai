import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createPackageToOpeningPlan } from "@/engine/packageToOpening";
import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import type { SceneManifest } from "@/engine/episodeGraph";
import type { ScenarioVisualTreatment } from "@/engine/scenarioVisualTreatment";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import type { Block, StageContext } from "@/engine/types";
import {
  entityImagery,
  qaVisual,
  stockFootage,
  timelineAssemble,
} from "../narratedBlocks";
import { uploadDraft } from "../lofiBlocks";
import { assertSceneCompilerScenarioVisualTreatment } from "../sceneCompilerBlocks";
import { syntheticScenarioBlocks } from "../syntheticScenarioBlocks";
import { thumbnailGen } from "../intelligenceBlocks";

function context(store: Record<string, unknown>): StageContext {
  return {
    ownerId: "owner-scenario-treatment-test",
    channelId: "channel-scenario-treatment-test",
    runId: "run-scenario-treatment-test",
    keyPrefix: "owner/scenario-treatment-test/channel/",
    params: {},
    store,
    budgetUsd: 0,
    log: () => {},
  };
}

function runnable(blocks: readonly Block[], id: string): Block["run"] {
  const block = blocks.find((candidate) => candidate.id === id);
  assert.ok(block, `expected ${id} to be registered`);
  return block.run;
}

async function main(): Promise<void> {
  const topic = "A fictional AI town decides how to share its only bridge";
  const brief = createChannelProgramBrief({
    family: "illustrated_explainer",
    nicheKey: "educational",
    locale: "en",
    concept: "A disclosed fictional scenario channel with non-real visual treatment.",
    programIntent: { kind: "fictional_scenario", profile: "ai_town" },
  });
  const route = resolveChannelProgramRoute(brief);
  const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
  const legacyFictionalSeed = {
    ...seed,
    requiredBlocks: seed.requiredBlocks.filter((block) => block !== "scenario_visual_treatment"),
  };
  const thumbnailTitle = "A Fictional AI Town Chooses Its Only Bridge";
  const thumbnailDescription = "A clearly fictional illustrated town council faces a glowing model bridge while residents debate a made-up resource-sharing consequence.";
  const packagePlan = createPackageToOpeningPlan({
    title: thumbnailTitle,
    thumbnailDescription,
    topic,
    route: seed,
  });
  const legacyPackagePlan = createPackageToOpeningPlan({
    title: thumbnailTitle,
    thumbnailDescription,
    topic,
    route: legacyFictionalSeed,
  });
  const scenario = syntheticScenarioContract("ai_town");
  const treatmentBlock = runnable(syntheticScenarioBlocks, "scenario_visual_treatment");
  const treatmentResult = await treatmentBlock(context({
    topic,
    syntheticScenario: scenario,
    channelProgramRoute: seed,
  }));
  const treatment = treatmentResult.scenarioVisualTreatment as ScenarioVisualTreatment | undefined;
  assert.ok(treatment);

  const treatedStore = {
    topic,
    syntheticScenario: scenario,
    scenarioVisualTreatment: treatment,
    channelProgramRoute: seed,
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("thumbnail provider must not be reached");
  }) as typeof fetch;
  try {
    await assert.rejects(
      thumbnailGen.run(context({
        topic,
        title: thumbnailTitle,
        thumbnailDescription,
        packageToOpeningPlan: packagePlan,
        syntheticScenario: scenario,
        channelProgramRoute: seed,
        // Deliberately omit scenarioVisualTreatment: the guard must run before
        // a checkpoint claim, image provider, or thumbnail art director call.
      })),
      /requires its sealed scenario visual treatment/i,
    );
    await assert.rejects(
      thumbnailGen.run(context({
        topic,
        title: thumbnailTitle,
        thumbnailDescription,
        packageToOpeningPlan: legacyPackagePlan,
        syntheticScenario: scenario,
        channelProgramRoute: legacyFictionalSeed,
      })),
      /legacy fictional route.*cannot generate thumbnail package art/i,
      "legacy fictional package art must stop before checkpoint/provider work",
    );
    await assert.rejects(
      qaVisual.run(context({
        syntheticScenario: scenario,
        channelProgramRoute: legacyFictionalSeed,
      })),
      /legacy fictional route.*cannot certify thumbnail QA/i,
      "legacy fictional runs cannot mint new thumbnail QA/certification evidence",
    );
    await assert.rejects(
      uploadDraft.run(context({
        syntheticScenario: scenario,
        channelProgramRoute: legacyFictionalSeed,
      })),
      /legacy fictional route.*cannot publish thumbnail package art/i,
      "legacy fictional runs cannot reach the upload/publish path",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    fetchCalls,
    0,
    "current or legacy fictional treatment admission must fail before provider, QA, or upload work",
  );

  await assert.rejects(
    stockFootage.run(context({ ...treatedStore })),
    /prohibits real-stock footage/i,
    "stock selection must reject before querying/downloading real footage",
  );
  await assert.rejects(
    entityImagery.run(context({ ...treatedStore })),
    /prohibits real-person\/entity imagery/i,
    "entity imagery must reject before text planning or Wikimedia lookup",
  );
  await assert.rejects(
    timelineAssemble.run(context({ ...treatedStore })),
    /generic real-media assembly is not admitted/i,
    "generic timeline assembly must not combine unknown real-media clips with a fictional scenario",
  );

  const manifest = {
    scenes: [
      {
        id: "scene-opening",
        visualState: {
          syntheticScenarioProfile: "ai_town",
          syntheticScenarioVisualKind: "town_overview",
          scenarioVisualTreatmentFingerprint: treatment.fingerprint,
        },
      },
      {
        id: "scene-resolution",
        visualState: {
          syntheticScenarioProfile: "ai_town",
          syntheticScenarioVisualKind: "town_overview",
          scenarioVisualTreatmentFingerprint: treatment.fingerprint,
        },
      },
    ],
  } as unknown as SceneManifest;
  assert.doesNotThrow(() => assertSceneCompilerScenarioVisualTreatment({
    manifest,
    treatment,
  }));
  assert.throws(
    () => assertSceneCompilerScenarioVisualTreatment({
      manifest: {
        ...manifest,
        scenes: manifest.scenes.map((scene, index) => index === 1
          ? {
              ...scene,
              visualState: {
                ...scene.visualState,
                scenarioVisualTreatmentFingerprint: "f".repeat(64),
              },
            }
          : scene),
      },
      treatment,
    }),
    /does not carry the sealed scenario visual treatment fingerprint/i,
  );
}

main()
  .then(() => console.log("Scenario visual treatment wiring tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
