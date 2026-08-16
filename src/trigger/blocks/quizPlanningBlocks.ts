/**
 * Deterministic quiz planning spine.
 *
 * This is intentionally separate from `quiz_year`: planning a channel episode,
 * validating its safe topic and packaging it for discovery are reusable
 * concerns. Its universal publisher-safe Nano Banana thumbnail is produced by
 * the shared `thumbnail_gen` block. The first consumer is the
 * mixed trivia family, but the provenance contract is designed so other
 * curated-source families can add a planner without depending on Topicraft.
 *
 * No text, image, audio or video model is called here. Topic selection is a
 * transparent rotation over a source-reviewed allowlist; facts are then fetched
 * by `quiz_year` from CC0 Wikidata and re-validated before pixels render.
 */
import { createHash } from "node:crypto";
import { type Block, type StageContext } from "@/engine/types";
import { QUIZ_YEAR_TOPIC_KEYS, type QuizYearTopicKey } from "@/lib/quizYearFacts";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const QUIZ_PLANNER_VERSION = "quiz-curated-wikidata-planner/v1" as const;
const QUIZ_TOPIC_MEMORY_PREFIX = "quiz-topic/v1";
const QUIZ_TOPIC_SAFETY_RECEIPT_VERSION = "quiz-topic-safety/v1" as const;

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

interface QuizTopicPresentation {
  label: string;
  titleStem: string;
  keywords: readonly string[];
  audiencePromise: string;
}

/**
 * The only autonomous topic registry this planner can select from. The
 * underlying fact filters add an independent per-item safety screen, but the
 * registry itself is deliberately upbeat and evergreen so the planner cannot
 * drift into politics, health, crimes, disasters or live news.
 */
const QUIZ_TOPIC_PRESENTATIONS: Readonly<Record<QuizYearTopicKey, QuizTopicPresentation>> = {
  space_exploration: {
    label: "Space Exploration",
    titleStem: "Space Exploration Trivia",
    keywords: ["space trivia", "space quiz", "NASA quiz", "astronomy trivia"],
    audiencePromise: "missions, launches and discoveries from the history of space exploration",
  },
  science_discovery: {
    label: "Science Discoveries",
    titleStem: "Science Discovery Trivia",
    keywords: ["science trivia", "science quiz", "discovery quiz", "STEM trivia"],
    audiencePromise: "major discoveries and breakthroughs from science history",
  },
  invention_technology: {
    label: "Inventions & Technology",
    titleStem: "Invention & Tech Trivia",
    keywords: ["invention trivia", "technology quiz", "history of technology", "STEM quiz"],
    audiencePromise: "inventions and technology milestones that changed everyday life",
  },
  video_games: {
    label: "Video Game History",
    titleStem: "Video Game History Trivia",
    keywords: ["video game trivia", "gaming quiz", "game history", "retro gaming trivia"],
    audiencePromise: "landmark video-game releases and gaming history",
  },
  film_release: {
    label: "Film History",
    titleStem: "Film History Trivia",
    keywords: ["movie trivia", "film quiz", "cinema history", "movie history trivia"],
    audiencePromise: "well-known film releases and cinema history",
  },
  sports_championship: {
    label: "Sports Championships",
    titleStem: "Sports Championship Trivia",
    keywords: ["sports trivia", "sports quiz", "championship quiz", "sports history"],
    audiencePromise: "major sporting championships and historic events",
  },
  landmark_architecture: {
    label: "Landmarks & Architecture",
    titleStem: "Landmark Trivia",
    keywords: ["landmark trivia", "architecture quiz", "world landmarks", "history quiz"],
    audiencePromise: "famous landmarks and the stories behind their construction",
  },
};

export interface QuizTopicPlan {
  version: typeof QUIZ_PLANNER_VERSION;
  topicKey: QuizYearTopicKey;
  topic: string;
  episodeOrdinal: number;
  memoryKey: string;
  provenance: {
    registry: "quiz-year-topics/v1";
    sourceLicense: "Wikidata CC0-1.0";
    selection: "least-used curated topic with deterministic tie-break" | "operator-pinned curated topic";
    previousEpisodesForTopic: number;
  };
}

/** A receipt that binds the safety decision to exactly one planner result. */
export interface QuizTopicSafetyReceipt {
  readonly version: typeof QUIZ_TOPIC_SAFETY_RECEIPT_VERSION;
  readonly planFingerprint: string;
  readonly topicKey: QuizYearTopicKey;
  readonly topic: string;
  readonly sensitiveTopic: false;
  readonly disclosureRequired: false;
}

function topicKeyFromUnknown(value: unknown): QuizYearTopicKey | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  return (QUIZ_YEAR_TOPIC_KEYS as readonly string[]).includes(candidate)
    ? candidate as QuizYearTopicKey
    : undefined;
}

function deterministicIndex(seed: string, modulo: number): number {
  if (modulo <= 1) return 0;
  const bytes = createHash("sha256").update(seed).digest();
  return bytes.readUInt32BE(0) % modulo;
}

function memoryParts(key: string): { runId: string; topicKey: QuizYearTopicKey; ordinal: number } | undefined {
  const parts = key.split("/");
  if (parts.length !== 5 || `${parts[0]}/${parts[1]}` !== QUIZ_TOPIC_MEMORY_PREFIX) return undefined;
  const topicKey = topicKeyFromUnknown(parts[3]);
  const ordinal = Number(parts[4]);
  if (!topicKey || !Number.isInteger(ordinal) || ordinal < 1) return undefined;
  return { runId: parts[2], topicKey, ordinal };
}

function planFor(args: {
  topicKey: QuizYearTopicKey;
  ordinal: number;
  runId: string;
  selection: QuizTopicPlan["provenance"]["selection"];
  previousEpisodesForTopic: number;
}): QuizTopicPlan {
  const presentation = QUIZ_TOPIC_PRESENTATIONS[args.topicKey];
  const memoryKey = `${QUIZ_TOPIC_MEMORY_PREFIX}/${args.runId}/${args.topicKey}/${args.ordinal}`;
  return {
    version: QUIZ_PLANNER_VERSION,
    topicKey: args.topicKey,
    topic: `${presentation.label} Trivia Challenge #${args.ordinal}`,
    episodeOrdinal: args.ordinal,
    memoryKey,
    provenance: {
      registry: "quiz-year-topics/v1",
      sourceLicense: "Wikidata CC0-1.0",
      selection: args.selection,
      previousEpisodesForTopic: args.previousEpisodesForTopic,
    },
  };
}

export function assertCertifiedQuizTopicPlan(value: unknown): QuizTopicPlan {
  if (!value || typeof value !== "object") throw new Error("quiz plan is missing");
  const candidate = value as Partial<QuizTopicPlan>;
  const topicKey = topicKeyFromUnknown(candidate.topicKey);
  const ordinal = Number(candidate.episodeOrdinal);
  const parsedMemory = typeof candidate.memoryKey === "string"
    ? memoryParts(candidate.memoryKey)
    : undefined;
  const presentation = topicKey ? QUIZ_TOPIC_PRESENTATIONS[topicKey] : undefined;
  if (
    candidate.version !== QUIZ_PLANNER_VERSION ||
    !topicKey ||
    typeof candidate.topic !== "string" ||
    !candidate.topic.trim() ||
    !Number.isInteger(ordinal) ||
    ordinal < 1 ||
    typeof candidate.memoryKey !== "string" ||
    !parsedMemory ||
    parsedMemory.topicKey !== topicKey ||
    parsedMemory.ordinal !== ordinal ||
    candidate.topic !== `${presentation?.label} Trivia Challenge #${ordinal}`
  ) {
    throw new Error("quiz plan is malformed or is not from the certified curated planner");
  }
  return candidate as QuizTopicPlan;
}

/** Fingerprint only the stable planner fields consumed by the safety gate. */
export function quizTopicPlanFingerprint(value: QuizTopicPlan): string {
  const plan = assertCertifiedQuizTopicPlan(value);
  return createHash("sha256").update(JSON.stringify({
    version: plan.version,
    topicKey: plan.topicKey,
    topic: plan.topic,
    episodeOrdinal: plan.episodeOrdinal,
    memoryKey: plan.memoryKey,
    provenance: plan.provenance,
  })).digest("hex");
}

function safetyReceiptFor(plan: QuizTopicPlan): QuizTopicSafetyReceipt {
  return Object.freeze({
    version: QUIZ_TOPIC_SAFETY_RECEIPT_VERSION,
    planFingerprint: quizTopicPlanFingerprint(plan),
    topicKey: plan.topicKey,
    topic: plan.topic,
    sensitiveTopic: false,
    disclosureRequired: false,
  });
}

/** Reject a stale, forged, or cross-topic safety result at the renderer boundary. */
export function assertCertifiedQuizTopicSafety(
  value: unknown,
  planValue: QuizTopicPlan,
): QuizTopicSafetyReceipt {
  const plan = assertCertifiedQuizTopicPlan(planValue);
  if (!value || typeof value !== "object") throw new Error("quiz safety receipt is missing");
  const receipt = value as Partial<QuizTopicSafetyReceipt>;
  if (
    receipt.version !== QUIZ_TOPIC_SAFETY_RECEIPT_VERSION ||
    receipt.planFingerprint !== quizTopicPlanFingerprint(plan) ||
    receipt.topicKey !== plan.topicKey ||
    receipt.topic !== plan.topic ||
    receipt.sensitiveTopic !== false ||
    receipt.disclosureRequired !== false
  ) {
    throw new Error("quiz safety receipt is stale, malformed, or does not bind the certified planner result");
  }
  return receipt as QuizTopicSafetyReceipt;
}

function musicBriefFor(plan: QuizTopicPlan): Record<string, unknown> {
  const presentation = QUIZ_TOPIC_PRESENTATIONS[plan.topicKey];
  return {
    musicPrompt: [
      "bright modern game-show instrumental",
      "warm marimba, light percussion and an upbeat bass pulse",
      `evoking ${presentation.label.toLowerCase()} without vocals or lyrics`,
      "clean loopable 100 BPM, playful and confident, never childish or frantic",
    ].join(", "),
    source: `${QUIZ_PLANNER_VERSION}: deterministic cue sheet`,
    topicKey: plan.topicKey,
  };
}

/**
 * Curated autonomous topic selection with durable, retry-stable provenance.
 * The run-specific memory key makes a recovered/retried stage reuse its exact
 * choice; across fresh runs, least-used topic rotation avoids a model choosing
 * the same subject repeatedly.
 */
const quizTopicPlan: Block = {
  id: "quiz_topic_plan",
  consumes: [],
  produces: ["topic", "quizTopic", "quizPlan", "musicBrief"],
  run: async (ctx) => {
    const client = convex();
    const rows = await client.query(
      api.topicMemory.listForChannel,
      { channelId: ctx.channelId as Id<"channels"> },
    ) as Array<{ key: string }>;

    const existing = rows
      .map((row) => memoryParts(String(row.key)))
      .find((item) => item?.runId === ctx.runId);
    if (existing) {
      const prior = rows
        .map((row) => memoryParts(String(row.key)))
        .filter((item): item is NonNullable<typeof item> => Boolean(item && item.topicKey === existing.topicKey && item.runId !== ctx.runId))
        .length;
      const reused = planFor({
        topicKey: existing.topicKey,
        ordinal: existing.ordinal,
        runId: ctx.runId,
        selection: "least-used curated topic with deterministic tie-break",
        previousEpisodesForTopic: prior,
      });
      ctx.log(`quiz_topic_plan: reused ${reused.topic} from ${reused.memoryKey}`);
      return {
        topic: reused.topic,
        quizTopic: reused.topicKey,
        quizPlan: reused,
        musicBrief: musicBriefFor(reused),
      };
    }

    const pinnedTopic = topicKeyFromUnknown(ctx.params["pinnedTopic"]);
    if (ctx.params["pinnedTopic"] !== undefined && !pinnedTopic) {
      throw new Error("quiz_topic_plan: pinnedTopic must be a key from the curated QuizYear topic registry");
    }
    const history = rows.map((row) => memoryParts(String(row.key))).filter(Boolean) as Array<{
      runId: string;
      topicKey: QuizYearTopicKey;
      ordinal: number;
    }>;
    const counts = new Map<QuizYearTopicKey, number>(QUIZ_YEAR_TOPIC_KEYS.map((key) => [key, 0]));
    for (const item of history) counts.set(item.topicKey, (counts.get(item.topicKey) ?? 0) + 1);
    const minCount = Math.min(...QUIZ_YEAR_TOPIC_KEYS.map((key) => counts.get(key) ?? 0));
    const candidates = QUIZ_YEAR_TOPIC_KEYS.filter((key) => (counts.get(key) ?? 0) === minCount);
    const topicKey = pinnedTopic ?? candidates[deterministicIndex(`${ctx.channelId}:${history.length}`, candidates.length)];
    const previousEpisodesForTopic = counts.get(topicKey) ?? 0;
    const plan = planFor({
      topicKey,
      ordinal: previousEpisodesForTopic + 1,
      runId: ctx.runId,
      selection: pinnedTopic ? "operator-pinned curated topic" : "least-used curated topic with deterministic tie-break",
      previousEpisodesForTopic,
    });

    await client.mutation(api.topicMemory.recordTopic, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      key: plan.memoryKey,
    });
    ctx.log(
      `quiz_topic_plan: ${plan.topic} (${plan.provenance.selection}; ` +
        `${plan.provenance.previousEpisodesForTopic} prior in this topic; CC0 Wikidata source route)`,
    );
    return {
      topic: plan.topic,
      quizTopic: plan.topicKey,
      quizPlan: plan,
      musicBrief: musicBriefFor(plan),
    };
  },
};

/** Deterministic safety receipt for the planner's fixed, upbeat allowlist. */
const quizTopicSafety: Block = {
  id: "quiz_topic_safety",
  consumes: ["topic", "quizPlan"],
  produces: ["disclosureRequired", "sensitiveTopic", "complianceNote", "quizSafety"],
  run: async (ctx) => {
    const plan = assertCertifiedQuizTopicPlan(ctx.store["quizPlan"]);
    const topic = String(ctx.store["topic"] ?? "").trim();
    if (topic !== plan.topic) throw new Error("quiz_topic_safety: topic does not match its curated planner receipt");
    if (!QUIZ_TOPIC_PRESENTATIONS[plan.topicKey]) {
      throw new Error("quiz_topic_safety: planner selected a topic outside the safety allowlist");
    }
    return {
      disclosureRequired: false,
      sensitiveTopic: false,
      complianceNote:
        "Curated evergreen quiz topic; all displayed answers require CC0 Wikidata provenance and deterministic integrity checks.",
      quizSafety: safetyReceiptFor(plan),
    };
  },
};

/** Deterministic SEO package grounded in the selected, source-backed topic. */
const quizMetadata: Block = {
  id: "quiz_metadata",
  consumes: ["topic", "quizPlan"],
  produces: [
    "title",
    "description",
    "thumbnailDescription",
    "tags",
    "estimatedViews",
    "estimatedViewsSource",
    "pinnedComment",
    "titleAlternate",
  ],
  run: async (ctx) => {
    const plan = assertCertifiedQuizTopicPlan(ctx.store["quizPlan"]);
    const presentation = QUIZ_TOPIC_PRESENTATIONS[plan.topicKey];
    const title = `${presentation.titleStem} #${plan.episodeOrdinal} | Can You Get 8/8?`;
    if (title.length > 100) throw new Error("quiz_metadata: deterministic title unexpectedly exceeds YouTube's 100-character limit");
    const description = [
      `Can you get 8/8 in this ${presentation.label.toLowerCase()} challenge?`,
      `Every answer is selected from ${presentation.audiencePromise}, with the correct option verified against a CC0 Wikidata statement before rendering.`,
      "Pause, lock in your choice, then see the sourced answer on the reveal.",
      "Subscribe for another original trivia challenge.",
    ].join("\n\n");
    const tags = [...new Set([
      ...presentation.keywords,
      "trivia quiz",
      "multiple choice quiz",
      "quiz challenge",
      "general knowledge",
      "guess the answer",
    ].map((tag) => tag.toLowerCase()))];
    const thumbnailDescription = [
      `A high-energy ${presentation.label.toLowerCase()} trivia challenge for the promise "${title}".`,
      "Show one oversized, instantly recognisable subject from this category in a dramatic game-show moment, with a single clear choice or reveal consequence.",
      "Leave clean negative space for the local headline overlay; do not place words, letters, UI, answer labels, or watermarks inside the generated scene.",
    ].join(" ");
    return {
      title,
      description,
      thumbnailDescription,
      tags,
      estimatedViews: 0,
      estimatedViewsSource: "deterministic-curated-quiz-metadata",
      pinnedComment: "How many did you get before the reveal?",
      titleAlternate: `${presentation.label}: 8 Question Trivia Challenge`,
    };
  },
};

/**
 * A deliberately narrow critic receipt for this non-narrated game format. The
 * visual/audio/temporal gates remain in qa_visual; these measured duration
 * assertions establish that the game loop itself is long enough to be an
 * episode and not a one-question accidental render.
 */
const quizCriticSpec: Block = {
  id: "quiz_critic_spec",
  consumes: ["quizPlan"],
  produces: ["validationSpec"],
  run: async (ctx) => {
    const plan = assertCertifiedQuizTopicPlan(ctx.store["quizPlan"]);
    return {
      validationSpec: {
        assertions: [
          {
            id: "quiz_episode_minimum_duration",
            description: `The ${plan.topicKey} quiz has enough timed rounds to be a complete episode.`,
            check: "deterministic",
            metric: "durationSec",
            op: ">=",
            threshold: 25,
            severity: "block",
          },
          {
            id: "quiz_episode_maximum_duration",
            description: "The quiz remains inside the format's authored watch-time ceiling.",
            check: "deterministic",
            metric: "durationSec",
            op: "<=",
            threshold: 400,
            severity: "block",
          },
        ],
      },
    };
  },
};

export const quizPlanningBlocks: Block[] = [
  quizTopicPlan,
  quizTopicSafety,
  quizCriticSpec,
  quizMetadata,
];
