import { createHash } from "node:crypto";

import { z } from "zod";

import { ChildrenShowBibleSchema } from "./childrenShowBible";
import { ContentLaneSchema } from "./contentLane";
import { assertEpisodeGraph, episodeGraphFingerprint } from "./episodeGraph";
import { assertLearningContract } from "./learningContract";

/**
 * Renderer-neutral visual handoff for a child-directed learning episode.
 *
 * This is deliberately not a lane, a safety gate, a thumbnail generator, or
 * a publisher. It turns already-approved lesson + identity artifacts into the
 * exact direction that specialist consumers (Ernie images, MiniMax H3 motion,
 * thumbnail packaging) need to do their own one job correctly.
 */
export const CHILDREN_VIDEO_TREATMENT_VERSION = "children-video-treatment/v1" as const;

export const ChildrenVideoTreatmentSchema = z.object({
  version: z.literal(CHILDREN_VIDEO_TREATMENT_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  episodeGraphFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lessonContractFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  childrenShowBibleFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.object({
    primarySurface: z.enum(["long_form", "shorts"]),
    aspect: z.enum(["16:9", "9:16"]),
    durationSec: z.number().positive().finite(),
  }).strict(),
  ernieImage: z.object({
    subjectLock: z.string().min(8).max(420),
    worldLock: z.string().min(8).max(420),
    visualRules: z.array(z.string().min(8).max(240)).min(3).max(8),
  }).strict(),
  minimaxH3: z.object({
    motionRules: z.array(z.string().min(8).max(240)).min(3).max(8),
    maxShotSeconds: z.number().positive().max(12),
  }).strict(),
  thumbnailHandoff: z.object({
    heroSubject: z.string().min(8).max(320),
    composition: z.string().min(8).max(320),
    visualRules: z.array(z.string().min(8).max(240)).min(3).max(8),
  }).strict(),
}).strict();

export type ChildrenVideoTreatment = z.infer<typeof ChildrenVideoTreatmentSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function childrenVideoTreatmentFingerprint(value: Omit<ChildrenVideoTreatment, "fingerprint">): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Build only the cross-module handoff. No provider, safety, or release action occurs here. */
export function buildChildrenVideoTreatment(args: {
  episodeGraph: unknown;
  lessonContract: unknown;
  childrenShowBible: unknown;
  contentLane: unknown;
}): ChildrenVideoTreatment {
  const graph = assertEpisodeGraph(args.episodeGraph);
  const lesson = assertLearningContract(args.lessonContract, graph);
  const show = ChildrenShowBibleSchema.parse(args.childrenShowBible);
  const lane = ContentLaneSchema.parse(args.contentLane);
  if (lane.key !== "children_learning_supervised" || graph.audience !== "children" || lesson.audience !== "children") {
    throw new Error("children_video_treatment: supervised children graph and learning contract are required");
  }
  if (
    show.episodeGraphFingerprint !== episodeGraphFingerprint(graph) ||
    show.lessonContractFingerprint !== lesson.fingerprint
  ) {
    throw new Error("children_video_treatment: show identity must be bound to this exact graph and learning contract");
  }
  const guide = show.identity.recurringCharacters[0];
  if (!guide) throw new Error("children_video_treatment: an approved recurring guide is required");
  const primarySurface = graph.durationSec <= 60 ? "shorts" : "long_form";
  const unsigned: Omit<ChildrenVideoTreatment, "fingerprint"> = {
    version: CHILDREN_VIDEO_TREATMENT_VERSION,
    episodeGraphFingerprint: episodeGraphFingerprint(graph),
    lessonContractFingerprint: lesson.fingerprint,
    childrenShowBibleFingerprint: show.contentFingerprint,
    format: {
      primarySurface,
      aspect: primarySurface === "shorts" ? "9:16" : "16:9",
      durationSec: graph.durationSec,
    },
    ernieImage: {
      subjectLock: `${guide.displayName}: ${guide.continuityLock}`,
      worldLock: `${show.identity.world.displayName}: ${show.identity.world.continuityLock}`,
      visualRules: [
        "Use the approved guide and world exactly; do not substitute known characters, brands, or borrowed visual IP.",
        "One clear learning action per frame, with large readable props and uncluttered negative space.",
        "Warm, calm, age-appropriate 2D illustration; no fear, peril, sensory overload, or deceptive spectacle.",
      ],
    },
    minimaxH3: {
      motionRules: [
        "Preserve the approved guide, wardrobe, props, and world lock across every shot.",
        "Animate one understandable action at a time; motion must reveal the learning step rather than decorate it.",
        "Use gentle camera movement and a settled final beat for participation or recall; avoid rapid cuts and impact motion.",
      ],
      maxShotSeconds: Math.min(8, Math.max(4, Math.round(graph.durationSec / Math.max(1, graph.beats.length)))),
    },
    thumbnailHandoff: {
      heroSubject: `${guide.displayName} clearly performing the episode's learning action: ${lesson.learningObjective}`,
      composition: `One large, readable guide and learning prop in ${show.identity.world.displayName}; leave clean contrast space and preserve the approved world identity.`,
      visualRules: [
        "The image must truthfully depict the lesson, guide, and action in this episode.",
        "Use one calm, high-clarity focal moment; do not use shock, fear, misleading expressions, or unrelated mash-ups.",
        "Keep any text minimal and only when it supports the approved learning objective; the thumbnail module owns typography.",
      ],
    },
  };
  return ChildrenVideoTreatmentSchema.parse({
    ...unsigned,
    fingerprint: childrenVideoTreatmentFingerprint(unsigned),
  });
}

export function assertChildrenVideoTreatment(value: unknown): ChildrenVideoTreatment {
  const treatment = ChildrenVideoTreatmentSchema.parse(value);
  const { fingerprint, ...unsigned } = treatment;
  if (fingerprint !== childrenVideoTreatmentFingerprint(unsigned)) {
    throw new Error("children_video_treatment: fingerprint does not match treatment contents");
  }
  return treatment;
}

/** The exact text handoff consumed by thumbnail_gen; generation stays there. */
export function childrenThumbnailDirection(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const treatment = assertChildrenVideoTreatment(value);
  return [
    "CHILDREN VIDEO TREATMENT — obey this episode-specific handoff:",
    `Hero: ${treatment.thumbnailHandoff.heroSubject}`,
    `Composition: ${treatment.thumbnailHandoff.composition}`,
    ...treatment.thumbnailHandoff.visualRules.map((rule) => `Rule: ${rule}`),
  ].join("\n");
}

/** Renderer adapters validate this handoff but retain ownership of pixels. */
export function assertChildrenVideoTreatmentForRender(args: {
  treatment: unknown;
  audience: unknown;
  durationSec: unknown;
  aspect: unknown;
}): void {
  if (args.audience !== "children") return;
  // A generic children graph remains valid for a future non-treatment lane.
  // The supervised lane itself requires children_video_treatment in its
  // composition contract; when that module is present, its handoff is strict.
  if (args.treatment === undefined) return;
  const treatment = assertChildrenVideoTreatment(args.treatment);
  const durationSec = typeof args.durationSec === "number" && Number.isFinite(args.durationSec)
    ? args.durationSec
    : undefined;
  if (
    durationSec === undefined ||
    Math.abs(treatment.format.durationSec - durationSec) > 0.05 ||
    treatment.format.aspect !== args.aspect
  ) {
    throw new Error("children_video_treatment: renderer geometry or duration does not match the sealed handoff");
  }
}
