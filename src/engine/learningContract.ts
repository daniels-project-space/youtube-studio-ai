import { createHash } from "node:crypto";

import { z } from "zod";

import {
  assertEpisodeGraph,
  childSafeTextDefects,
  episodeGraphFingerprint,
  type EpisodeGraph,
} from "./episodeGraph";
import { ContentLaneSchema } from "./contentLane";

/**
 * A renderer-neutral learning handoff. It deliberately does not invent facts,
 * a grade level, or an educational credential: it locks the objective already
 * present in the approved Episode Graph and makes the review obligations
 * explicit before a learning-oriented episode is rendered or released.
 */
export const LEARNING_CONTRACT_VERSION = "learning-contract/v1" as const;

export const LearningLevelSchema = z.enum([
  "early_learning",
  "beginner",
  "intermediate",
  "advanced",
  "human_review_required",
]);
export type LearningLevel = z.infer<typeof LearningLevelSchema>;

export const RetrievalPracticeSchema = z.object({
  prompt: z.string().trim().min(8).max(320),
  expectedConcepts: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
  responseMode: z.enum(["spoken_or_pointed", "open_response"]),
}).strict();
export type RetrievalPractice = z.infer<typeof RetrievalPracticeSchema>;

export const LearningContractSchema = z.object({
  version: z.literal(LEARNING_CONTRACT_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  episodeGraphFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  audience: z.enum(["general", "children"]),
  topic: z.string().trim().min(2).max(240),
  level: LearningLevelSchema,
  learningObjective: z.string().trim().min(8).max(500),
  demonstrationBeatIds: z.array(z.string().regex(/^beat-[a-z0-9-]+$/)).min(1).max(32),
  recapBeatId: z.string().regex(/^beat-[a-z0-9-]+$/),
  retrievalPractice: RetrievalPracticeSchema,
  sourceRefs: z.array(z.string().regex(/^source-[a-z0-9-]+$/)).min(1).max(32),
  reviewRequirements: z.array(z.string().trim().min(8).max(260)).min(1).max(8),
}).strict();
export type LearningContract = z.infer<typeof LearningContractSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedForFingerprint(contract: Omit<LearningContract, "fingerprint">): Omit<LearningContract, "fingerprint"> {
  return {
    ...contract,
    demonstrationBeatIds: [...contract.demonstrationBeatIds].sort(),
    sourceRefs: [...contract.sourceRefs].sort(),
    reviewRequirements: [...contract.reviewRequirements],
    retrievalPractice: {
      ...contract.retrievalPractice,
      expectedConcepts: [...contract.retrievalPractice.expectedConcepts].sort(),
    },
  };
}

export function learningContractFingerprint(value: Omit<LearningContract, "fingerprint">): string {
  return createHash("sha256")
    .update(canonicalJson(normalizedForFingerprint(value)))
    .digest("hex");
}

function sourceIdsForLearning(graph: EpisodeGraph, demonstrationBeatIds: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const beat of graph.beats) {
    if (!demonstrationBeatIds.includes(beat.id)) continue;
    for (const sourceId of beat.sourceRefs) ids.add(sourceId);
  }
  return [...ids].sort();
}

function reviewRequirements(audience: LearningContract["audience"]): string[] {
  if (audience === "children") {
    return [
      "Human reviewer confirms age suitability and made-for-kids classification.",
      "Human reviewer confirms original characters, assets, music, and voice rights.",
      "Human reviewer confirms the objective and retrieval prompt are accurate and calm.",
    ];
  }
  return [
    "Human reviewer confirms factual accuracy, clarity, and source relevance for the intended learner.",
  ];
}

/** Builds a contract from an already-validated graph; no provider or model call occurs. */
export function buildLearningContract(value: unknown, contentLane: unknown): LearningContract {
  const graph = assertEpisodeGraph(value);
  const lane = ContentLaneSchema.parse(contentLane);
  if (graph.audience === "children" && lane.key !== "children_learning_supervised") {
    throw new Error("learning_contract: children Episode Graphs require the children_learning_supervised lane");
  }
  const objectiveBeats = graph.beats.filter((beat) => Boolean(beat.learningObjective));
  if (!objectiveBeats.length) {
    throw new Error("learning_contract: Episode Graph has no explicit learning objective");
  }
  const demonstrationBeatIds = objectiveBeats.map((beat) => beat.id);
  const recapBeatId = graph.beats.at(-1)?.id;
  if (!recapBeatId) throw new Error("learning_contract: Episode Graph has no recap beat");
  const sourceRefs = sourceIdsForLearning(graph, demonstrationBeatIds);
  const objective = objectiveBeats[0].learningObjective!;
  const unsigned: Omit<LearningContract, "fingerprint"> = {
    version: LEARNING_CONTRACT_VERSION,
    episodeGraphFingerprint: episodeGraphFingerprint(graph),
    audience: graph.audience,
    topic: graph.topic,
    level: graph.audience === "children" ? "early_learning" : "beginner",
    learningObjective: objective,
    demonstrationBeatIds,
    recapBeatId,
    retrievalPractice: {
      prompt: `What is one thing you learned about ${graph.topic}?`,
      expectedConcepts: [graph.topic],
      responseMode: graph.audience === "children" ? "spoken_or_pointed" : "open_response",
    },
    sourceRefs,
    reviewRequirements: reviewRequirements(graph.audience),
  };
  return assertLearningContract({
    ...unsigned,
    fingerprint: learningContractFingerprint(unsigned),
  }, graph);
}

/**
 * Verifies the contract still describes this exact Episode Graph. This blocks a
 * stale lesson receipt from being attached to a changed script, source ledger,
 * or scene plan during retry/resume.
 */
export function assertLearningContract(value: unknown, graphValue: unknown): LearningContract {
  const contract = LearningContractSchema.parse(value);
  const graph = assertEpisodeGraph(graphValue);
  const { fingerprint: _fingerprint, ...unsigned } = contract;
  if (contract.fingerprint !== learningContractFingerprint(unsigned)) {
    throw new Error("learning_contract: fingerprint does not match the contract contents");
  }
  if (contract.episodeGraphFingerprint !== episodeGraphFingerprint(graph)) {
    throw new Error("learning_contract: contract does not match the active Episode Graph");
  }
  if (contract.audience !== graph.audience || contract.topic !== graph.topic) {
    throw new Error("learning_contract: audience and topic must match the active Episode Graph");
  }
  const beatsById = new Map(graph.beats.map((beat) => [beat.id, beat]));
  const objectiveBeats = contract.demonstrationBeatIds.map((id) => beatsById.get(id));
  if (objectiveBeats.some((beat) => !beat?.learningObjective)) {
    throw new Error("learning_contract: every demonstration beat must carry an explicit learning objective");
  }
  if (!objectiveBeats.some((beat) => beat?.learningObjective === contract.learningObjective)) {
    throw new Error("learning_contract: learning objective is not grounded in a demonstration beat");
  }
  const recap = beatsById.get(contract.recapBeatId);
  if (!recap || recap.id !== graph.beats.at(-1)?.id) {
    throw new Error("learning_contract: recap must be the final Episode Graph beat");
  }
  const graphSources = new Map(graph.sources.map((source) => [source.id, source]));
  for (const sourceId of contract.sourceRefs) {
    if (!graphSources.has(sourceId)) throw new Error(`learning_contract: unknown source ${sourceId}`);
  }
  if (graph.audience === "children") {
    const defects = [
      ...childSafeTextDefects(contract.topic, "learning topic"),
      ...childSafeTextDefects(contract.learningObjective, "learning objective"),
      ...childSafeTextDefects(contract.retrievalPractice.prompt, "retrieval prompt"),
    ];
    if (defects.length) throw new Error(`learning_contract: ${defects.join("; ")}`);
    if (contract.level !== "early_learning") {
      throw new Error("learning_contract: children contracts must declare early_learning level");
    }
    if (!contract.sourceRefs.some((sourceId) => {
      const kind = graphSources.get(sourceId)?.kind;
      return kind === "curriculum" || kind === "primary";
    })) {
      throw new Error("learning_contract: children contracts require curriculum or primary source evidence");
    }
    if (contract.retrievalPractice.responseMode !== "spoken_or_pointed") {
      throw new Error("learning_contract: children retrieval practice must support spoken_or_pointed response");
    }
    if (contract.reviewRequirements.length < 3) {
      throw new Error("learning_contract: children contracts require the full human review checklist");
    }
  }
  return contract;
}
