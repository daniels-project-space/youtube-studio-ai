import {
  ILLUSTRATED_EXPLAINER_DETERMINISTIC_FOUNDATION_PROFILE,
  buildDeterministicChannelFoundation,
  verifyDeterministicFoundationPersistence,
  type DeterministicChannelFoundation,
  type DeterministicFoundationPersistenceReceipt,
} from "@/engine/deterministicChannelFoundation";
import type { DeterministicFoundationObjectWriter } from "@/trigger/deterministicQuizYearFoundation";

export interface PersistedIllustratedFoundation {
  readonly foundation: DeterministicChannelFoundation;
  readonly receipt: DeterministicFoundationPersistenceReceipt;
}

/**
 * These are format seeds, not factual topic research. Each declares an
 * assumption-led story rather than claiming that a model actually simulated or
 * predicted an outcome, so the corresponding foundation carries no sources.
 */
function starterSlate() {
  return [
    {
      id: "fictional-ai-town",
      ordinal: 1,
      title: "AI Runs a Fictional Town: Day One",
      premise: "A made-up town follows three stated rules; the story explores the trade-offs rather than presenting a real simulation.",
      keywords: ["fictional ai town", "ai thought experiment", "systems story"],
      sourceIds: [],
    },
    {
      id: "fictional-ai-decision",
      ordinal: 2,
      title: "What Would AI Do? A Fictional Choice",
      premise: "A decision board compares invented options and their illustrative consequences without claiming a real model chose one.",
      keywords: ["what would ai do", "ai decision", "thought experiment"],
      sourceIds: [],
    },
    {
      id: "fictional-ai-pov",
      ordinal: 3,
      title: "AI POV: A Fictional Day in the System",
      premise: "A first-person visual story makes its fictional assumptions visible rather than representing an actual AI perspective.",
      keywords: ["ai pov", "fictional ai story", "visual scenario"],
      sourceIds: [],
    },
  ] as const;
}

export function buildIllustratedFoundation(args: {
  readonly channelName: string;
  readonly storagePrefix: string;
  readonly programBriefFingerprint: string;
  readonly programBriefPositioningText: string;
}): DeterministicChannelFoundation {
  return buildDeterministicChannelFoundation({
    profile: ILLUSTRATED_EXPLAINER_DETERMINISTIC_FOUNDATION_PROFILE,
    family: "illustrated_explainer",
    channelName: args.channelName,
    storagePrefix: args.storagePrefix,
    programBriefFingerprint: args.programBriefFingerprint,
    programBriefPositioningText: args.programBriefPositioningText,
    sources: [],
    starterSlate: starterSlate(),
  });
}

export async function buildAndPersistIllustratedFoundation(args: {
  readonly channelName: string;
  readonly storagePrefix: string;
  readonly programBriefFingerprint: string;
  readonly programBriefPositioningText: string;
  readonly writer: DeterministicFoundationObjectWriter;
}): Promise<PersistedIllustratedFoundation> {
  const foundation = buildIllustratedFoundation(args);
  const [avatar, banner, manifest] = await Promise.all([
    args.writer.writeImmutable(foundation.brandAssets[0]),
    args.writer.writeImmutable(foundation.brandAssets[1]),
    args.writer.writeImmutable(foundation.manifestArtifact),
  ]);
  const receipt = verifyDeterministicFoundationPersistence(foundation, {
    positioningFingerprint: foundation.positioning.fingerprint,
    avatar,
    banner,
    starterSlate: manifest,
    providerCostUsd: 0,
    publishingState: "draft",
  });
  return Object.freeze({ foundation, receipt });
}
