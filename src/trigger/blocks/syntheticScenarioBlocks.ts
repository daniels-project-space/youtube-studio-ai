/**
 * Provider-free scenario admission and disclosure gate for illustrated AI
 * thought experiments. The generated video visibly carries the same contract;
 * this gate makes a missing spoken disclosure a hard failure before narration
 * reaches the renderer.
 */
import {
  SYNTHETIC_SCENARIO_DISCLOSURE,
  SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
  assertSyntheticScenarioContract,
  type SyntheticScenarioContract,
} from "@/engine/syntheticScenario";
import type { Block } from "@/engine/types";

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function scenarioFromParams(params: Record<string, unknown>): SyntheticScenarioContract {
  return assertSyntheticScenarioContract({
    version: params["version"],
    profile: params["profile"],
    fictional: params["fictional"],
    visibleDisclosure: params["visibleDisclosure"],
    discloseAssumptions: params["discloseAssumptions"],
  });
}

export const syntheticScenarioBlock: Block = {
  id: "synthetic_scenario",
  consumes: ["topic"],
  produces: ["syntheticScenario"],
  run: async (ctx) => {
    const topic = nonEmptyString(ctx.store["topic"], "synthetic_scenario: topic");
    const contract = scenarioFromParams(ctx.params);
    ctx.log(
      `synthetic_scenario: ${contract.profile} admitted as ${contract.visibleDisclosure} for ${topic.slice(0, 80)}`,
    );
    return {
      syntheticScenario: contract,
    };
  },
};

export const scenarioDisclosureGateBlock: Block = {
  id: "scenario_disclosure_gate",
  consumes: ["syntheticScenario", "narrationText"],
  produces: ["syntheticScenarioDisclosure"],
  run: async (ctx) => {
    const scenario = assertSyntheticScenarioContract(ctx.store["syntheticScenario"]);
    const narration = nonEmptyString(ctx.store["narrationText"], "scenario_disclosure_gate: narrationText");
    const opening = narration.slice(0, 720).toLocaleLowerCase();
    const disclosure = scenario.visibleDisclosure.toLocaleLowerCase();
    if (!opening.includes(disclosure)) {
      throw new Error(
        `scenario_disclosure_gate: narration must say "${scenario.visibleDisclosure}" within its opening 720 characters`,
      );
    }
    if (!/illustrative|assumption|fictional/.test(opening)) {
      throw new Error(
        "scenario_disclosure_gate: narration opening must say the scenario is illustrative assumptions, not a real simulation",
      );
    }
    ctx.log(`scenario_disclosure_gate: spoken ${SYNTHETIC_SCENARIO_DISCLOSURE} verified`);
    return {
      syntheticScenarioDisclosure: {
        version: SYNTHETIC_SCENARIO_DISCLOSURE_VERSION,
        profile: scenario.profile,
        visibleDisclosure: scenario.visibleDisclosure,
        openingVerified: true,
      },
    };
  },
};

export const syntheticScenarioBlocks: Block[] = [
  syntheticScenarioBlock,
  scenarioDisclosureGateBlock,
];
