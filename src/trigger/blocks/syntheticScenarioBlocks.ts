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
  syntheticScenarioContract,
  type SyntheticScenarioContract,
} from "@/engine/syntheticScenario";
import {
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertScenarioVisualTreatmentBinding,
  createScenarioVisualTreatmentFromRoute,
} from "@/engine/scenarioVisualTreatment";
import type { Block, StageContext } from "@/engine/types";

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

/**
 * Voice-performance tags are instructions to the TTS provider, not spoken
 * words. Strip them before measuring a release disclosure's audible position.
 */
function firstSpokenWords(value: string, count: number): string {
  return value
    .replace(/\[[^\]\r\n]{1,120}\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
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

function sameScenarioContract(
  left: SyntheticScenarioContract,
  right: SyntheticScenarioContract,
): boolean {
  return left.version === right.version &&
    left.profile === right.profile &&
    left.fictional === right.fictional &&
    left.visibleDisclosure === right.visibleDisclosure &&
    left.discloseAssumptions === right.discloseAssumptions;
}

function routeScenarioContract(
  ctx: StageContext,
  block: "synthetic_scenario" | "scenario_disclosure_gate",
): SyntheticScenarioContract | undefined {
  const raw = ctx.store["channelProgramRoute"];
  if (raw === undefined) return undefined;
  const route: ChannelProgramRouteRunSeed = parseChannelProgramRouteRunSeed(raw);
  if (!route.requiredBlocks.includes(block)) {
    throw new Error(`${block}: frozen channel program route ${route.routeKey} does not permit this synthetic-scenario block`);
  }
  if (
    route.directives.claimMode !== "fictional_scenario_no_external_claims" ||
    !route.syntheticScenarioProfile
  ) {
    throw new Error(`${block}: frozen channel program route is not a fictional synthetic-scenario route`);
  }
  return syntheticScenarioContract(route.syntheticScenarioProfile);
}

function scenarioForExecution(ctx: StageContext): SyntheticScenarioContract {
  const sealed = routeScenarioContract(ctx, "synthetic_scenario");
  if (!sealed) return scenarioFromParams(ctx.params);
  const hasMutableScenarioInput = [
    "version",
    "profile",
    "fictional",
    "visibleDisclosure",
    "discloseAssumptions",
  ].some((key) => ctx.params[key] !== undefined);
  if (hasMutableScenarioInput) {
    const supplied = scenarioFromParams(ctx.params);
    if (!sameScenarioContract(supplied, sealed)) {
      throw new Error("synthetic_scenario: mutable scenario params do not match the frozen channel program route");
    }
  }
  return sealed;
}

export const syntheticScenarioBlock: Block = {
  id: "synthetic_scenario",
  consumes: ["topic"],
  produces: ["syntheticScenario"],
  run: async (ctx) => {
    const topic = nonEmptyString(ctx.store["topic"], "synthetic_scenario: topic");
    const contract = scenarioForExecution(ctx);
    ctx.log(
      `synthetic_scenario: ${contract.profile} admitted as ${contract.visibleDisclosure} for ${topic.slice(0, 80)}`,
    );
    return {
      syntheticScenario: contract,
    };
  },
};

/**
 * Provider-free visual policy derived from the same frozen route as the
 * synthetic scenario. It is deliberately before script/render work: every
 * downstream visual adapter can either bind it or reject the route before a
 * real-world image source is selected.
 */
export const scenarioVisualTreatmentBlock: Block = {
  id: "scenario_visual_treatment",
  consumes: ["topic", "syntheticScenario", "channelProgramRoute"],
  produces: ["scenarioVisualTreatment"],
  run: async (ctx) => {
    const topic = nonEmptyString(ctx.store["topic"], "scenario_visual_treatment: topic");
    const treatment = createScenarioVisualTreatmentFromRoute({
      route: ctx.store["channelProgramRoute"],
      topic,
    });
    assertScenarioVisualTreatmentBinding({
      treatment,
      route: ctx.store["channelProgramRoute"],
      topic,
      scenario: ctx.store["syntheticScenario"],
    });
    ctx.log(
      `scenario_visual_treatment: ${treatment.profile} sealed (${treatment.policy.depiction}; ` +
        `real entities/places and stock/entity imagery prohibited)`,
    );
    return { scenarioVisualTreatment: treatment };
  },
};

export const scenarioDisclosureGateBlock: Block = {
  id: "scenario_disclosure_gate",
  consumes: ["syntheticScenario", "narrationText"],
  produces: ["syntheticScenarioDisclosure"],
  run: async (ctx) => {
    const scenario = assertSyntheticScenarioContract(ctx.store["syntheticScenario"]);
    const sealed = routeScenarioContract(ctx, "scenario_disclosure_gate");
    if (sealed && !sameScenarioContract(scenario, sealed)) {
      throw new Error("scenario_disclosure_gate: scenario contract does not match the frozen channel program route");
    }
    const narration = nonEmptyString(ctx.store["narrationText"], "scenario_disclosure_gate: narrationText");
    const opening = firstSpokenWords(narration, 40).toLocaleLowerCase();
    const disclosure = scenario.visibleDisclosure.toLocaleLowerCase();
    if (!opening.includes(disclosure)) {
      throw new Error(
        `scenario_disclosure_gate: narration must say "${scenario.visibleDisclosure}" within its first 40 spoken words`,
      );
    }
    if (!/illustrative|assumption|fictional/.test(opening)) {
      throw new Error(
        "scenario_disclosure_gate: the first 40 spoken words must say the scenario is illustrative assumptions, not a real simulation",
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
  scenarioVisualTreatmentBlock,
  scenarioDisclosureGateBlock,
];
