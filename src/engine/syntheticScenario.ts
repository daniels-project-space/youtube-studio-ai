/**
 * Typed contract for clearly fictional, AI-assisted scenario stories.
 *
 * These episodes are visual thought experiments, not simulations, reporting,
 * or evidence for claims about real people or places. Keeping that distinction
 * as an executable contract lets the script, graph, renderer, and upload path
 * share one visible disclosure instead of relying on a title disclaimer.
 */
import { z } from "zod";

export const SYNTHETIC_SCENARIO_VERSION = "fictional-ai-scenario/v1" as const;
export const SYNTHETIC_SCENARIO_DISCLOSURE_VERSION = "synthetic-scenario-disclosure/v1" as const;
export const SYNTHETIC_SCENARIO_DISCLOSURE = "FICTIONAL AI SCENARIO" as const;

export const SYNTHETIC_SCENARIO_PROFILES = [
  "ai_town",
  "ai_decision",
  "ai_pov",
] as const;
export const SyntheticScenarioProfileSchema = z.enum(SYNTHETIC_SCENARIO_PROFILES);
export type SyntheticScenarioProfile = z.infer<typeof SyntheticScenarioProfileSchema>;

export const SYNTHETIC_SCENARIO_VISUAL_KINDS = [
  "town_overview",
  "town_turn",
  "decision_options",
  "decision_outcome",
  "pov_hud",
] as const;
export const SyntheticScenarioVisualKindSchema = z.enum(SYNTHETIC_SCENARIO_VISUAL_KINDS);
export type SyntheticScenarioVisualKind = z.infer<typeof SyntheticScenarioVisualKindSchema>;

export const SyntheticScenarioContractSchema = z.object({
  version: z.literal(SYNTHETIC_SCENARIO_VERSION),
  profile: SyntheticScenarioProfileSchema,
  fictional: z.literal(true),
  visibleDisclosure: z.literal(SYNTHETIC_SCENARIO_DISCLOSURE),
  discloseAssumptions: z.literal(true),
}).strict();
export type SyntheticScenarioContract = z.infer<typeof SyntheticScenarioContractSchema>;

/** Durable proof that the script's opening disclosed its fictional assumptions. */
export const SyntheticScenarioDisclosureSchema = z.object({
  version: z.literal(SYNTHETIC_SCENARIO_DISCLOSURE_VERSION),
  profile: SyntheticScenarioProfileSchema,
  visibleDisclosure: z.literal(SYNTHETIC_SCENARIO_DISCLOSURE),
  openingVerified: z.literal(true),
}).strict();
export type SyntheticScenarioDisclosure = z.infer<typeof SyntheticScenarioDisclosureSchema>;

export const SYNTHETIC_SCENARIO_CONTRACTS: Readonly<
  Record<SyntheticScenarioProfile, SyntheticScenarioContract>
> = Object.freeze({
  ai_town: Object.freeze({
    version: SYNTHETIC_SCENARIO_VERSION,
    profile: "ai_town",
    fictional: true,
    visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
    discloseAssumptions: true,
  }),
  ai_decision: Object.freeze({
    version: SYNTHETIC_SCENARIO_VERSION,
    profile: "ai_decision",
    fictional: true,
    visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
    discloseAssumptions: true,
  }),
  ai_pov: Object.freeze({
    version: SYNTHETIC_SCENARIO_VERSION,
    profile: "ai_pov",
    fictional: true,
    visibleDisclosure: SYNTHETIC_SCENARIO_DISCLOSURE,
    discloseAssumptions: true,
  }),
});

export function syntheticScenarioContract(profile: SyntheticScenarioProfile): SyntheticScenarioContract {
  return SYNTHETIC_SCENARIO_CONTRACTS[profile];
}

export function isSyntheticScenarioContract(value: unknown): value is SyntheticScenarioContract {
  return SyntheticScenarioContractSchema.safeParse(value).success;
}

export function assertSyntheticScenarioContract(value: unknown): SyntheticScenarioContract {
  return SyntheticScenarioContractSchema.parse(value);
}

/** The scene grammar is deterministic so every retry keeps the same story shape. */
export function syntheticScenarioVisualKindFor(
  profile: SyntheticScenarioProfile,
  index: number,
  total: number,
  purpose?: string,
): SyntheticScenarioVisualKind {
  const normalizedPurpose = purpose?.toLowerCase() ?? "";
  const isFinal = index >= Math.max(0, total - 1);
  switch (profile) {
    case "ai_town":
      return index === 0 || isFinal ? "town_overview" : "town_turn";
    case "ai_decision":
      return /choice|question|problem|experiment|decision/.test(normalizedPurpose)
        ? "decision_options"
        : "decision_outcome";
    case "ai_pov":
      return "pov_hud";
  }
}

/**
 * Prompt material shared by script and hook generation. It does not make any
 * claim that the model made a real decision or that an outcome was simulated.
 */
export function syntheticScenarioWritingDirective(contract: SyntheticScenarioContract): string {
  const format = contract.profile === "ai_town"
    ? "an AI-run fictional town"
    : contract.profile === "ai_decision"
      ? "a fictional AI decision thought experiment"
      : "a fictional first-person AI POV story";
  return [
    `SYNTHETIC-SCENARIO CONTRACT: this is ${format}.`,
    `Within the first 40 spoken words, say the exact phrase "${contract.visibleDisclosure}" and state that the outcomes are illustrative assumptions, not a real simulation or real-world result.`,
    "Never imply that an AI actually controlled people, a real place, a real system, or a real person. Never present invented scores, charts, probabilities, research, or outcomes as measured facts.",
    "Make the viewer care through concrete stakes, trade-offs, reversals, and a payoff—not by pretending the scenario happened.",
  ].join(" ");
}
