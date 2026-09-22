import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import {
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "./channelProgramRoute";

/**
 * A sealed, provider-selection music-loop episode handoff. It deliberately
 * plans the identity of the visual loop, instrumental program, and the chosen
 * audio route before either Novita or a music provider is allowed to make an
 * asset. It is not a music-generation receipt, cost reservation, or
 * publication authority.
 */
export const ORIGINAL_MUSIC_PROGRAM_PLAN_VERSION = "original-music-program-plan/v1" as const;
export const ORIGINAL_MUSIC_PROGRAM_ROUTE_KEY = "music-loop/foundation/v1" as const;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/iu);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

const PlanBodySchema = z.object({
  version: z.enum([ORIGINAL_MUSIC_PROGRAM_PLAN_VERSION, "original-music-program-plan/v2-yue2"]),
  family: z.literal("music_loop"),
  contentLaneKey: z.literal("music_loop"),
  routeKey: z.literal(ORIGINAL_MUSIC_PROGRAM_ROUTE_KEY),
  routeFingerprint: FingerprintSchema,
  programBriefFingerprint: FingerprintSchema,
  topic: boundedText(240),
  topicFingerprint: FingerprintSchema,
  visual: z.object({
    setting: boundedText(320),
    visualStyle: boundedText(120),
    motionIntent: boundedText(240),
  }).strict(),
  audio: z.object({
    direction: boundedText(900),
    providerPreference: z.enum(["minimax_music3", "suno", "mureka", "yue2"]),
    instrumentalOnly: z.literal(true),
    noVocals: z.literal(true),
    loopable: z.literal(true),
  }).strict(),
}).strict();

export const OriginalMusicProgramPlanSchema = PlanBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((plan, refinement) => {
  if ((plan.version === "original-music-program-plan/v2-yue2") !== (plan.audio.providerPreference === "yue2")) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, message: "music program version does not bind its provider" });
  }
  const expected = originalMusicProgramPlanFingerprint(plan);
  if (plan.fingerprint !== expected) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      message: "original music program plan fingerprint does not bind its content",
      path: ["fingerprint"],
    });
  }
});

export type OriginalMusicProgramPlan = z.infer<typeof OriginalMusicProgramPlanSchema>;

export interface CreateOriginalMusicProgramPlanInput {
  readonly route: ChannelProgramRouteRunSeed | unknown;
  readonly topic: string;
  readonly setting?: string;
  readonly visualStyle?: string;
  readonly motionIntent?: string;
  readonly audioDirection?: string;
  /**
   * The exact paid route expected by the later music block. MiniMax remains
   * explicit rather than a fallback: its worker independently fails closed
   * until its current quality qualification is present.
   */
  readonly providerPreference?: "minimax_music3" | "suno" | "mureka" | "yue2";
}

export type OriginalMusicProvider = "minimax_music3" | "suno" | "mureka";

/**
 * Select a route before spending on either branch. A requested provider is
 * immutable; automatic programs may prefer MiniMax only after its independent
 * quality/runtime qualification succeeds. This prevents a missing worker from
 * turning a normally automatic music program into a late paid-stage failure.
 */
export function selectOriginalMusicProvider(input: {
  readonly requestedProvider?: OriginalMusicProvider;
  readonly minimaxQualified: boolean;
}): OriginalMusicProvider {
  if (input.requestedProvider) return input.requestedProvider;
  return input.minimaxQualified ? "minimax_music3" : "suno";
}

function normalizedText(value: string | undefined, fallback: string, maximum: number): string {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  return (normalized || fallback).slice(0, maximum).trim();
}

export function originalMusicProgramTopicFingerprint(topic: string): string {
  return sha256Hex(topic.replace(/\s+/gu, " ").trim());
}

/** Returns a canonical fingerprint without trusting a caller-provided digest. */
export function originalMusicProgramPlanFingerprint(
  value: Omit<OriginalMusicProgramPlan, "fingerprint"> | OriginalMusicProgramPlan,
): string {
  const { fingerprint: _fingerprint, ...body } = value as OriginalMusicProgramPlan;
  void _fingerprint;
  return sha256Hex(canonicalJson(body));
}

export function assertOriginalMusicProgramRoute(
  routeInput: ChannelProgramRouteRunSeed | unknown,
): ChannelProgramRouteRunSeed {
  const route = parseChannelProgramRouteRunSeed(routeInput);
  if (route.family !== "music_loop" || route.contentLaneKey !== "music_loop") {
    throw new Error("original music program requires the music_loop route and content lane");
  }
  if (route.routeKey !== ORIGINAL_MUSIC_PROGRAM_ROUTE_KEY) {
    throw new Error(`original music program route must be ${ORIGINAL_MUSIC_PROGRAM_ROUTE_KEY}`);
  }
  const required = ["topic_select", "music_program_plan", "scene_planner", "music", "loop_clips"];
  const missing = required.filter((block) => !route.requiredBlocks.includes(block));
  if (missing.length) {
    throw new Error(`original music program route is missing required block(s): ${missing.join(", ")}`);
  }
  return route;
}

export function createOriginalMusicProgramPlan(
  input: CreateOriginalMusicProgramPlanInput,
): OriginalMusicProgramPlan {
  const route = assertOriginalMusicProgramRoute(input.route);
  const topic = normalizedText(input.topic, "Untitled music program", 240);
  if (!topic || topic === "Untitled music program") {
    throw new Error("original music program requires a non-empty topic");
  }
  const visualStyle = normalizedText(input.visualStyle, "lofi ambient", 120);
  const setting = normalizedText(input.setting, topic, 320);
  const motionIntent = normalizedText(
    input.motionIntent,
    "one calm, seamless camera movement with no abrupt cuts, flashes, or subject drift",
    240,
  );
  const audioDirection = normalizedText(
    input.audioDirection,
    `Original instrumental music for ${topic}; preserve the channel sound, no vocals or lyrics, and resolve naturally for seamless looping.`,
    900,
  );
  const body = {
    version: input.providerPreference === "yue2" ? "original-music-program-plan/v2-yue2" as const : ORIGINAL_MUSIC_PROGRAM_PLAN_VERSION,
    family: "music_loop" as const,
    contentLaneKey: "music_loop" as const,
    routeKey: ORIGINAL_MUSIC_PROGRAM_ROUTE_KEY,
    routeFingerprint: route.routeFingerprint,
    programBriefFingerprint: route.programBriefFingerprint,
    topic,
    topicFingerprint: originalMusicProgramTopicFingerprint(topic),
    visual: { setting, visualStyle, motionIntent },
    audio: {
      direction: audioDirection,
      providerPreference: input.providerPreference === "yue2" ? "yue2" as const : selectOriginalMusicProvider({
        requestedProvider: input.providerPreference,
        minimaxQualified: false,
      }),
      instrumentalOnly: true as const,
      noVocals: true as const,
      loopable: true as const,
    },
  };
  return OriginalMusicProgramPlanSchema.parse({
    ...body,
    fingerprint: originalMusicProgramPlanFingerprint(body),
  });
}

/**
 * Rechecks the plan at each paid consumer.  This avoids treating an old
 * channel's scene or music prompt as though it were approved for a later
 * route/program brief.
 */
export function assertOriginalMusicProgramPlanBinding(input: {
  readonly plan: OriginalMusicProgramPlan | unknown;
  readonly route: ChannelProgramRouteRunSeed | unknown;
  readonly topic: string;
}): OriginalMusicProgramPlan {
  const plan = OriginalMusicProgramPlanSchema.parse(input.plan);
  const route = assertOriginalMusicProgramRoute(input.route);
  const topic = input.topic.replace(/\s+/gu, " ").trim();
  if (!topic || plan.topic !== topic || plan.topicFingerprint !== originalMusicProgramTopicFingerprint(topic)) {
    throw new Error("original music program plan does not bind the current topic");
  }
  if (plan.routeFingerprint !== route.routeFingerprint
    || plan.programBriefFingerprint !== route.programBriefFingerprint) {
    throw new Error("original music program plan does not bind the current route/program brief");
  }
  return plan;
}
