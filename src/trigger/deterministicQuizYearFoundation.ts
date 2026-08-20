import { createHash } from "node:crypto";

import {
  QUIZYEAR_DETERMINISTIC_FOUNDATION_PROFILE,
  buildDeterministicChannelFoundation,
  verifyDeterministicFoundationPersistence,
  type DeterministicBrandAsset,
  type DeterministicChannelFoundation,
  type DeterministicFoundationManifestArtifact,
  type DeterministicFoundationPersistenceReceipt,
  type PersistedFoundationObject,
} from "@/engine/deterministicChannelFoundation";

type FoundationArtifact = DeterministicBrandAsset | DeterministicFoundationManifestArtifact;

export interface DeterministicFoundationObjectWriter {
  writeImmutable(artifact: FoundationArtifact): Promise<PersistedFoundationObject>;
}

export interface PersistedQuizYearFoundation {
  readonly foundation: DeterministicChannelFoundation;
  readonly receipt: DeterministicFoundationPersistenceReceipt;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * This is a source-first *starter slate*, not episode-answer evidence. Every
 * generated QuizYear round still obtains and verifies its own facts through
 * the deterministic QuizYear fact path before rendering.
 */
function starterSources() {
  const rows = [
    [
      "wikidata-q405",
      "https://www.wikidata.org/wiki/Q405",
      "A CC0 Wikidata starter reference reserved for the space-trivia slate.",
    ],
    [
      "wikidata-q193",
      "https://www.wikidata.org/wiki/Q193",
      "A CC0 Wikidata starter reference reserved for the science-trivia slate.",
    ],
    [
      "wikidata-q243",
      "https://www.wikidata.org/wiki/Q243",
      "A CC0 Wikidata starter reference reserved for the landmark-trivia slate.",
    ],
  ] as const;
  return rows.map(([id, sourceUrl, claim]) => Object.freeze({
    id,
    sourceUrl,
    claim,
    contentFingerprint: fingerprint(`${id}\n${sourceUrl}\n${claim}`),
    license: "CC0-1.0",
    // This revision date is part of the deterministic source packet, rather
    // than a fabricated live retrieval timestamp.
    retrievedAt: 1_704_067_200_000,
  }));
}

function starterSlate() {
  return [
    {
      id: "space-exploration-round",
      ordinal: 1,
      title: "Space Exploration Trivia Challenge #1",
      premise: "A fair timed round whose eventual answers are independently verified before render.",
      keywords: ["space trivia", "astronomy quiz", "NASA quiz"],
      sourceIds: ["wikidata-q405"],
    },
    {
      id: "science-discovery-round",
      ordinal: 2,
      title: "Science Discovery Trivia Challenge #1",
      premise: "A fair timed round whose eventual answers are independently verified before render.",
      keywords: ["science trivia", "discovery quiz", "STEM trivia"],
      sourceIds: ["wikidata-q193"],
    },
    {
      id: "landmark-round",
      ordinal: 3,
      title: "Landmark Trivia Challenge #1",
      premise: "A fair timed round whose eventual answers are independently verified before render.",
      keywords: ["landmark trivia", "architecture quiz", "history quiz"],
      sourceIds: ["wikidata-q243"],
    },
  ] as const;
}

export function buildQuizYearFoundation(args: {
  readonly channelName: string;
  readonly storagePrefix: string;
  readonly programBriefFingerprint: string;
  readonly programBriefPositioningText: string;
}): DeterministicChannelFoundation {
  return buildDeterministicChannelFoundation({
    profile: QUIZYEAR_DETERMINISTIC_FOUNDATION_PROFILE,
    family: "quizyear",
    channelName: args.channelName,
    storagePrefix: args.storagePrefix,
    programBriefFingerprint: args.programBriefFingerprint,
    programBriefPositioningText: args.programBriefPositioningText,
    sources: starterSources(),
    starterSlate: starterSlate(),
  });
}

export async function buildAndPersistQuizYearFoundation(args: {
  readonly channelName: string;
  readonly storagePrefix: string;
  readonly programBriefFingerprint: string;
  readonly programBriefPositioningText: string;
  readonly writer: DeterministicFoundationObjectWriter;
}): Promise<PersistedQuizYearFoundation> {
  const foundation = buildQuizYearFoundation(args);
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
