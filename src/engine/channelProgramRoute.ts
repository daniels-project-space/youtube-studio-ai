import { z } from "zod";

import {
  assertCanonicalChannelProgramBrief,
  channelProgramBriefFingerprint,
  ChannelProgramIntentSchema,
  SerializedProgramSchema,
  type ChannelProgramBrief,
  type ChannelProgramIntent,
  type SerializedProgram,
} from "@/engine/channelProgramBrief";
import { resolveChannelFamilyManifest } from "@/engine/channelFamilyManifest";
import {
  CERTIFIED_QUIZ_PROFILE_KEYS,
  resolveCertifiedQuizProfile,
  type CertifiedQuizProfileKey,
} from "@/engine/certifiedQuizProfile";
import { familyProductionReadiness, type FamilyKey } from "@/engine/families";
import {
  SYNTHETIC_SCENARIO_PROFILES,
  type SyntheticScenarioProfile,
} from "@/engine/syntheticScenario";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A server-derived editorial route. It is intentionally not a user-selected
 * renderer switch: it seals the admitted Program Brief into the exact episode
 * grammar that reaches planning, scripting, criticism, and retries.
 */
export const CHANNEL_PROGRAM_ROUTE_VERSION = "channel-program-route/v1" as const;
export const CHANNEL_PROGRAM_ROUTE_RUN_SEED_VERSION = "channel-program-route-seed/v1" as const;
/**
 * A route receipt describes the complete quality-controlled production chain, not just its
 * creative core. Keep this bounded for storage/validation while allowing the cinematic route's
 * explicit pre-production, render, QA, packaging, and release stages.
 */
const CHANNEL_PROGRAM_ROUTE_MAX_REQUIRED_BLOCKS = 32;
const CHANNEL_PROGRAM_ROUTE_MAX_REQUIRED_BLOCK_ORDER = 40;

const CHANNEL_PROGRAM_ROUTE_KEYS = [
  "narrated-stock/foundation/v1",
  "sleep/foundation/v1",
  "shorts/foundation/v1",
  "cinematic/foundation/v1",
  "quizyear/certified-profile/v1",
  "quizyear/sports-championship-timeline/v1",
  "quizyear/portrait-supervised/v1",
  "music-loop/foundation/v1",
  "whiteboard/foundation/v1",
  "comic/foundation/v1",
  "loreshort/foundation/v1",
  "illustrated-explainer/foundation/v1",
  "illustrated-explainer/fictional-decision-lab/v1",
  "illustrated-explainer/fictional-ai-town/v1",
  "illustrated-explainer/fictional-ai-pov/v1",
] as const;

export type ChannelProgramRouteKey = (typeof CHANNEL_PROGRAM_ROUTE_KEYS)[number];
export type ChannelProgramRouteAdmission = "automatic" | "supervised_private";

export interface ChannelProgramRouteDirectives {
  readonly viewerJob: string;
  readonly claimMode:
    | "editorial_lane_policy"
    | "certified_quiz_facts"
    | "fictional_scenario_no_external_claims";
  readonly topicRules: readonly string[];
  readonly scriptRules: readonly string[];
  readonly criticFocus: readonly string[];
}

export interface ChannelProgramRoute {
  readonly version: typeof CHANNEL_PROGRAM_ROUTE_VERSION;
  readonly routeKey: ChannelProgramRouteKey;
  readonly definitionVersion: 1;
  readonly definitionFingerprint: string;
  readonly catalogFingerprint: string;
  readonly family: FamilyKey;
  readonly contentLaneKey: string;
  /** Present only for a route that must never enter automatic channel creation. */
  readonly admission?: ChannelProgramRouteAdmission;
  readonly programBriefFingerprint: string;
  readonly programIntent?: ChannelProgramIntent;
  readonly serializedProgram?: SerializedProgram;
  readonly directives: ChannelProgramRouteDirectives;
  readonly requiredBlocks: readonly string[];
  readonly requiredBlockOrder: readonly (readonly [string, string])[];
  readonly quizProfile?: CertifiedQuizProfileKey;
  readonly syntheticScenarioProfile?: SyntheticScenarioProfile;
  readonly fingerprint: string;
}

export interface ChannelProgramRouteRunSeed {
  readonly version: typeof CHANNEL_PROGRAM_ROUTE_RUN_SEED_VERSION;
  readonly routeKey: ChannelProgramRouteKey;
  readonly routeFingerprint: string;
  readonly family: FamilyKey;
  readonly contentLaneKey: string;
  /** Preserved in the seed when the run is an explicitly supervised route. */
  readonly admission?: ChannelProgramRouteAdmission;
  readonly programBriefFingerprint: string;
  readonly directives: ChannelProgramRouteDirectives;
  readonly requiredBlocks: readonly string[];
  readonly quizProfile?: CertifiedQuizProfileKey;
  readonly syntheticScenarioProfile?: SyntheticScenarioProfile;
  readonly serializedProgram?: SerializedProgram;
  /** Canonical creator context, bounded by the selected route and never route-selecting. */
  readonly context: {
    readonly locale: string;
    readonly nicheKey: string;
    readonly subcategory?: string;
    readonly audience?: string;
    readonly sampleTopics?: readonly string[];
  };
}

interface ChannelProgramRouteDefinition {
  readonly key: ChannelProgramRouteKey;
  readonly family: FamilyKey;
  readonly intentKind: ChannelProgramIntent["kind"] | "absent";
  readonly quizProfile?: CertifiedQuizProfileKey;
  readonly syntheticScenarioProfile?: SyntheticScenarioProfile;
  readonly directives: ChannelProgramRouteDirectives;
  readonly requiredBlocks: readonly string[];
  readonly requiredBlockOrder: readonly (readonly [string, string])[];
  /** Omitted only for historical automatic definitions. */
  readonly admission?: ChannelProgramRouteAdmission;
}

function routeAdmission(definition: ChannelProgramRouteDefinition): ChannelProgramRouteAdmission {
  return definition.admission ?? "automatic";
}

const editorialFoundation = (viewerJob: string): ChannelProgramRouteDirectives => ({
  viewerJob,
  claimMode: "editorial_lane_policy",
  topicRules: ["Stay within the canonical niche and audience promise."],
  scriptRules: ["Use the selected family’s approved episode grammar."],
  criticFocus: ["Check topic and script fit against the frozen channel program."],
});

const fictionalScenarioDirectives = (viewerJob: string): ChannelProgramRouteDirectives => ({
  viewerJob,
  claimMode: "fictional_scenario_no_external_claims",
  topicRules: [
    "Create only a disclosed fictional thought experiment.",
    "Do not present a scenario, simulation, or outcome as a real-world result.",
  ],
  scriptRules: [
    "State the Fictional AI Scenario disclosure and assumptions in the opening.",
    "Keep all claimed outcomes inside the sealed fictional scenario contract.",
  ],
  criticFocus: [
    "Reject omitted fictional disclosure or assumptions.",
    "Reject factual, evidentiary, or real-simulation claims.",
  ],
});

const quizDirectives = (viewerJob: string): ChannelProgramRouteDirectives => ({
  viewerJob,
  claimMode: "certified_quiz_facts",
  topicRules: [
    "Use only the certified profile’s fixed source-topic keys and question categories.",
    "Never create forecasts, current-news questions, or free-form category mixes.",
  ],
  scriptRules: ["Use one sourced, answerable fact per round."],
  criticFocus: ["Verify the route’s exact certified profile and fact provenance."],
});

const AUTOMATIC_CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS: readonly ChannelProgramRouteDefinition[] = [
  {
    key: "narrated-stock/foundation/v1",
    family: "narrated_stock",
    intentKind: "absent",
    directives: editorialFoundation("A clear, repeatable narrated editorial episode."),
    requiredBlocks: ["topic_select", "script_gen", "qa_script"],
    requiredBlockOrder: [["topic_select", "script_gen"], ["script_gen", "qa_script"]],
  },
  {
    key: "sleep/foundation/v1",
    family: "sleep",
    intentKind: "absent",
    directives: editorialFoundation("A calm, repeatable guided or ambient listening episode."),
    requiredBlocks: ["topic_select", "script_gen", "qa_script"],
    requiredBlockOrder: [["topic_select", "script_gen"], ["script_gen", "qa_script"]],
  },
  {
    key: "shorts/foundation/v1",
    family: "shorts",
    intentKind: "absent",
    directives: editorialFoundation("A concise, original short-form episode with a clear viewer payoff."),
    requiredBlocks: ["topic_select", "script_gen", "qa_script"],
    requiredBlockOrder: [["topic_select", "script_gen"], ["script_gen", "qa_script"]],
  },
  {
    key: "cinematic/foundation/v1",
    family: "cinematic",
    intentKind: "absent",
    directives: editorialFoundation(
      "An original, causally coherent cinematic episode with route-sealed visual controls and final-master proof.",
    ),
    requiredBlocks: [
      "topic_select",
      "director_brief",
      "dp_brief",
      "editor_brief",
      "composer_brief",
      "critic_spec",
      "script_gen",
      "qa_script",
      "hook_craft",
      "narration_tts",
      "story_spine",
      "studio_asset_resolve",
      "visual_matter",
      "novita_render_images",
      "qa_assets",
      "studio_ltx_adapter_resolve",
      "novita_render_video",
      "qa_shots",
      "studio_postproduction_asset_resolve",
      "music",
      "timeline_assemble",
      "package_to_opening_plan",
      "thumbnail_gen",
      "qa_visual",
      "upload_draft",
    ],
    requiredBlockOrder: [
      ["topic_select", "director_brief"],
      ["director_brief", "script_gen"],
      ["dp_brief", "script_gen"],
      ["editor_brief", "script_gen"],
      ["composer_brief", "script_gen"],
      ["critic_spec", "script_gen"],
      ["script_gen", "qa_script"],
      ["qa_script", "hook_craft"],
      ["hook_craft", "narration_tts"],
      ["narration_tts", "story_spine"],
      ["story_spine", "studio_asset_resolve"],
      ["studio_asset_resolve", "visual_matter"],
      ["visual_matter", "novita_render_images"],
      ["novita_render_images", "qa_assets"],
      ["qa_assets", "studio_ltx_adapter_resolve"],
      ["studio_ltx_adapter_resolve", "novita_render_video"],
      ["novita_render_video", "qa_shots"],
      ["qa_shots", "studio_postproduction_asset_resolve"],
      ["studio_postproduction_asset_resolve", "timeline_assemble"],
      ["music", "timeline_assemble"],
      ["timeline_assemble", "package_to_opening_plan"],
      ["package_to_opening_plan", "thumbnail_gen"],
      ["timeline_assemble", "qa_visual"],
      ["qa_visual", "upload_draft"],
    ],
  },
  {
    key: "quizyear/certified-profile/v1",
    family: "quizyear",
    intentKind: "certified_quiz",
    directives: quizDirectives("A sourced, repeatable Guess-the-Year or certified fact challenge."),
    requiredBlocks: ["quiz_topic_plan", "quiz_topic_safety", "quiz_year", "quiz_critic_spec"],
    requiredBlockOrder: [
      ["quiz_topic_plan", "quiz_topic_safety"],
      ["quiz_topic_safety", "quiz_year"],
      ["quiz_year", "quiz_critic_spec"],
    ],
  },
  {
    key: "quizyear/sports-championship-timeline/v1",
    family: "quizyear",
    intentKind: "sports_championship_timeline",
    quizProfile: "sports_championship_timeline",
    directives: quizDirectives("A sourced sports-championship timeline challenge."),
    requiredBlocks: ["quiz_topic_plan", "quiz_topic_safety", "quiz_year", "quiz_critic_spec"],
    requiredBlockOrder: [
      ["quiz_topic_plan", "quiz_topic_safety"],
      ["quiz_topic_safety", "quiz_year"],
      ["quiz_year", "quiz_critic_spec"],
    ],
  },
  {
    key: "music-loop/foundation/v1",
    family: "music_loop",
    intentKind: "absent",
    directives: editorialFoundation("An original, instrumental music-loop episode with a route-sealed audio and visual program."),
    requiredBlocks: ["topic_select", "music_program_plan", "scene_planner", "music", "keyframes", "loop_clips", "assemble", "thumbnail_gen", "qa_visual", "upload_draft"],
    requiredBlockOrder: [
      ["topic_select", "music_program_plan"],
      ["music_program_plan", "scene_planner"],
      ["music_program_plan", "music"],
      ["scene_planner", "keyframes"],
      ["music", "loop_clips"],
      ["keyframes", "loop_clips"],
      ["loop_clips", "assemble"],
      ["music", "assemble"],
      ["assemble", "qa_visual"],
      ["qa_visual", "upload_draft"],
    ],
  },
  {
    key: "whiteboard/foundation/v1",
    family: "whiteboard",
    intentKind: "absent",
    directives: editorialFoundation("A clear, original drawn whiteboard explainer with one critic-approved native storyboard."),
    requiredBlocks: ["topic_select", "critic_spec", "compliance_check", "self_contained_story_plan", "self_contained_story", "whiteboard_scribe", "originality_gate", "thumbnail_gen", "qa_visual", "upload_draft"],
    requiredBlockOrder: [
      ["topic_select", "critic_spec"],
      ["critic_spec", "compliance_check"],
      ["compliance_check", "self_contained_story_plan"],
      ["self_contained_story_plan", "self_contained_story"],
      ["self_contained_story", "whiteboard_scribe"],
      ["whiteboard_scribe", "originality_gate"],
      ["whiteboard_scribe", "qa_visual"],
      ["qa_visual", "upload_draft"],
    ],
  },
  {
    key: "comic/foundation/v1",
    family: "comic",
    intentKind: "absent",
    directives: editorialFoundation("An original motion-comic episode with one critic-approved native storyboard."),
    requiredBlocks: ["topic_select", "critic_spec", "compliance_check", "self_contained_story_plan", "self_contained_story", "motion_comic", "originality_gate", "thumbnail_gen", "qa_visual", "upload_draft"],
    requiredBlockOrder: [
      ["topic_select", "critic_spec"],
      ["critic_spec", "compliance_check"],
      ["compliance_check", "self_contained_story_plan"],
      ["self_contained_story_plan", "self_contained_story"],
      ["self_contained_story", "motion_comic"],
      ["motion_comic", "originality_gate"],
      ["motion_comic", "qa_visual"],
      ["qa_visual", "upload_draft"],
    ],
  },
  {
    key: "loreshort/foundation/v1",
    family: "loreshort",
    intentKind: "absent",
    directives: editorialFoundation("An original first-person lore micro-documentary with one critic-approved native beat sheet."),
    requiredBlocks: ["topic_select", "critic_spec", "compliance_check", "self_contained_story_plan", "self_contained_story", "lore_short", "originality_gate", "thumbnail_gen", "qa_visual", "upload_draft"],
    requiredBlockOrder: [
      ["topic_select", "critic_spec"],
      ["critic_spec", "compliance_check"],
      ["compliance_check", "self_contained_story_plan"],
      ["self_contained_story_plan", "self_contained_story"],
      ["self_contained_story", "lore_short"],
      ["lore_short", "originality_gate"],
      ["lore_short", "qa_visual"],
      ["qa_visual", "upload_draft"],
    ],
  },
  {
    key: "illustrated-explainer/foundation/v1",
    family: "illustrated_explainer",
    intentKind: "absent",
    directives: editorialFoundation("A comprehensible, original illustrated explainer."),
    requiredBlocks: ["topic_select", "script_gen", "qa_script"],
    requiredBlockOrder: [["topic_select", "script_gen"], ["script_gen", "qa_script"]],
  },
  {
    key: "illustrated-explainer/fictional-decision-lab/v1",
    family: "illustrated_explainer",
    intentKind: "fictional_scenario",
    syntheticScenarioProfile: "ai_decision",
    directives: fictionalScenarioDirectives("A disclosed fictional AI decision laboratory."),
    requiredBlocks: ["topic_select", "synthetic_scenario", "scenario_visual_treatment", "script_gen", "scenario_disclosure_gate", "qa_script"],
    requiredBlockOrder: [
      ["topic_select", "synthetic_scenario"],
      ["synthetic_scenario", "scenario_visual_treatment"],
      ["scenario_visual_treatment", "script_gen"],
      ["script_gen", "scenario_disclosure_gate"],
      ["scenario_disclosure_gate", "qa_script"],
    ],
  },
  {
    key: "illustrated-explainer/fictional-ai-town/v1",
    family: "illustrated_explainer",
    intentKind: "fictional_scenario",
    syntheticScenarioProfile: "ai_town",
    directives: fictionalScenarioDirectives("A disclosed fictional AI town thought experiment."),
    requiredBlocks: ["topic_select", "synthetic_scenario", "scenario_visual_treatment", "script_gen", "scenario_disclosure_gate", "qa_script"],
    requiredBlockOrder: [
      ["topic_select", "synthetic_scenario"],
      ["synthetic_scenario", "scenario_visual_treatment"],
      ["scenario_visual_treatment", "script_gen"],
      ["script_gen", "scenario_disclosure_gate"],
      ["scenario_disclosure_gate", "qa_script"],
    ],
  },
  {
    key: "illustrated-explainer/fictional-ai-pov/v1",
    family: "illustrated_explainer",
    intentKind: "fictional_scenario",
    syntheticScenarioProfile: "ai_pov",
    directives: fictionalScenarioDirectives("A disclosed fictional AI point-of-view story."),
    requiredBlocks: ["topic_select", "synthetic_scenario", "scenario_visual_treatment", "script_gen", "scenario_disclosure_gate", "qa_script"],
    requiredBlockOrder: [
      ["topic_select", "synthetic_scenario"],
      ["synthetic_scenario", "scenario_visual_treatment"],
      ["scenario_visual_treatment", "script_gen"],
      ["script_gen", "scenario_disclosure_gate"],
      ["scenario_disclosure_gate", "qa_script"],
    ],
  },
] as const;

/**
 * This is intentionally separate from the certified automatic catalog.  The
 * route can make a fully evidenced private draft, but `resolveChannelProgramRoute`
 * rejects it unless a caller has deliberately entered the supervised path.
 */
const SUPERVISED_CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS: readonly ChannelProgramRouteDefinition[] = [
  {
    key: "quizyear/portrait-supervised/v1",
    family: "quizyear",
    intentKind: "quiz_short",
    admission: "supervised_private",
    directives: quizDirectives(
      "A private 9:16 certified trivia Short with a measured opening hook and human release review.",
    ),
    requiredBlocks: [
      "quiz_topic_plan",
      "quiz_topic_safety",
      "quiz_year",
      "quiz_critic_spec",
      "qa_visual",
      "quiz_short_release",
      "upload_draft",
    ],
    requiredBlockOrder: [
      ["quiz_topic_plan", "quiz_topic_safety"],
      ["quiz_topic_safety", "quiz_year"],
      ["quiz_year", "quiz_critic_spec"],
      ["quiz_year", "qa_visual"],
      ["qa_visual", "quiz_short_release"],
      ["quiz_short_release", "upload_draft"],
    ],
  },
] as const;

const CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS: readonly ChannelProgramRouteDefinition[] = [
  ...AUTOMATIC_CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS,
  ...SUPERVISED_CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS,
];

function definitionIdentity(definition: ChannelProgramRouteDefinition) {
  return {
    key: definition.key,
    version: 1,
    family: definition.family,
    intentKind: definition.intentKind,
    ...(routeAdmission(definition) === "automatic" ? {} : { admission: routeAdmission(definition) }),
    ...(definition.quizProfile ? { quizProfile: definition.quizProfile } : {}),
    ...(definition.syntheticScenarioProfile ? { syntheticScenarioProfile: definition.syntheticScenarioProfile } : {}),
    directives: definition.directives,
    requiredBlocks: definition.requiredBlocks,
    requiredBlockOrder: definition.requiredBlockOrder,
  };
}

function definitionFingerprint(definition: ChannelProgramRouteDefinition): string {
  return sha256Hex(canonicalJson(definitionIdentity(definition)));
}

export const CHANNEL_PROGRAM_ROUTE_CATALOG_FINGERPRINT = sha256Hex(canonicalJson(
  CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS.map(definitionIdentity),
));

export const CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS = Object.freeze(
  AUTOMATIC_CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS.map((definition) => Object.freeze({
    ...definition,
    directives: Object.freeze({
      ...definition.directives,
      topicRules: Object.freeze([...definition.directives.topicRules]),
      scriptRules: Object.freeze([...definition.directives.scriptRules]),
      criticFocus: Object.freeze([...definition.directives.criticFocus]),
    }),
    requiredBlocks: Object.freeze([...definition.requiredBlocks]),
    requiredBlockOrder: Object.freeze(definition.requiredBlockOrder.map((pair) => Object.freeze([...pair] as [string, string]))),
  })),
);

const RouteDirectivesSchema = z.object({
  viewerJob: z.string().min(1).max(300),
  claimMode: z.enum(["editorial_lane_policy", "certified_quiz_facts", "fictional_scenario_no_external_claims"]),
  topicRules: z.array(z.string().min(1).max(400)).min(1).max(8),
  scriptRules: z.array(z.string().min(1).max(400)).min(1).max(8),
  criticFocus: z.array(z.string().min(1).max(400)).min(1).max(8),
}).strict();

export const ChannelProgramRouteSchema = z.object({
  version: z.literal(CHANNEL_PROGRAM_ROUTE_VERSION),
  routeKey: z.enum(CHANNEL_PROGRAM_ROUTE_KEYS),
  definitionVersion: z.literal(1),
  definitionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  catalogFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  family: z.string().min(1).max(80),
  contentLaneKey: z.string().min(1).max(120),
  admission: z.enum(["automatic", "supervised_private"]).optional(),
  programBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  programIntent: ChannelProgramIntentSchema.optional(),
  serializedProgram: SerializedProgramSchema.optional(),
  directives: RouteDirectivesSchema,
  requiredBlocks: z.array(z.string().min(1).max(120)).min(1).max(CHANNEL_PROGRAM_ROUTE_MAX_REQUIRED_BLOCKS),
  requiredBlockOrder: z.array(z.tuple([z.string().min(1).max(120), z.string().min(1).max(120)])).max(CHANNEL_PROGRAM_ROUTE_MAX_REQUIRED_BLOCK_ORDER),
  quizProfile: z.enum(CERTIFIED_QUIZ_PROFILE_KEYS).optional(),
  syntheticScenarioProfile: z.enum(SYNTHETIC_SCENARIO_PROFILES).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const ChannelProgramRouteRunSeedSchema = z.object({
  version: z.literal(CHANNEL_PROGRAM_ROUTE_RUN_SEED_VERSION),
  routeKey: z.enum(CHANNEL_PROGRAM_ROUTE_KEYS),
  routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  family: z.string().min(1).max(80),
  contentLaneKey: z.string().min(1).max(120),
  admission: z.enum(["automatic", "supervised_private"]).optional(),
  programBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  directives: RouteDirectivesSchema,
  requiredBlocks: z.array(z.string().min(1).max(120)).min(1).max(CHANNEL_PROGRAM_ROUTE_MAX_REQUIRED_BLOCKS),
  quizProfile: z.enum(CERTIFIED_QUIZ_PROFILE_KEYS).optional(),
  syntheticScenarioProfile: z.enum(SYNTHETIC_SCENARIO_PROFILES).optional(),
  serializedProgram: SerializedProgramSchema.optional(),
  context: z.object({
    locale: z.string().min(2).max(20),
    nicheKey: z.string().min(1).max(160),
    subcategory: z.string().min(2).max(160).optional(),
    audience: z.string().min(2).max(160).optional(),
    sampleTopics: z.array(z.string().min(2).max(220)).min(1).max(12).optional(),
  }).strict(),
}).strict();

function routeIdentity(route: Omit<ChannelProgramRoute, "fingerprint">) {
  return {
    version: route.version,
    routeKey: route.routeKey,
    definitionVersion: route.definitionVersion,
    definitionFingerprint: route.definitionFingerprint,
    catalogFingerprint: route.catalogFingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    ...(route.admission ? { admission: route.admission } : {}),
    programBriefFingerprint: route.programBriefFingerprint,
    ...(route.programIntent ? { programIntent: route.programIntent } : {}),
    ...(route.serializedProgram ? { serializedProgram: route.serializedProgram } : {}),
    directives: route.directives,
    requiredBlocks: route.requiredBlocks,
    requiredBlockOrder: route.requiredBlockOrder,
    ...(route.quizProfile ? { quizProfile: route.quizProfile } : {}),
    ...(route.syntheticScenarioProfile ? { syntheticScenarioProfile: route.syntheticScenarioProfile } : {}),
  };
}

export function channelProgramRouteFingerprint(route: Omit<ChannelProgramRoute, "fingerprint"> | ChannelProgramRoute): string {
  const { fingerprint: _fingerprint, ...identity } = route as ChannelProgramRoute;
  void _fingerprint;
  return sha256Hex(canonicalJson(routeIdentity(identity)));
}

function sameIntent(left: ChannelProgramIntent | undefined, right: ChannelProgramIntent | undefined): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

function sameSerializedProgram(
  left: SerializedProgram | undefined,
  right: SerializedProgram | undefined,
): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

function admittedSerializedProgram(
  brief: ChannelProgramBrief,
  definition: ChannelProgramRouteDefinition,
): SerializedProgram | undefined {
  const serializedProgram = brief.serializedProgram;
  if (!serializedProgram) return undefined;
  const readiness = familyProductionReadiness(definition.family);
  if (!readiness.productionReady) {
    throw new Error(
      `serialized_program/v1 requires a production-ready family: ${readiness.blockers.join(" ")}`,
    );
  }
  if (!definition.requiredBlocks.includes("topic_select")) {
    throw new Error(
      "serialized_program/v1 requires a route whose admitted planner is topic_select",
    );
  }
  if (
    definition.directives.claimMode !== "editorial_lane_policy" &&
    definition.directives.claimMode !== "fictional_scenario_no_external_claims"
  ) {
    throw new Error(
      "serialized_program/v1 is admitted only for editorial-lane or disclosed-fiction routes",
    );
  }
  return Object.freeze({ ...serializedProgram });
}

function matchingDefinition(brief: ChannelProgramBrief): ChannelProgramRouteDefinition {
  const intent = brief.programIntent;
  // Sports championship is deliberately a named recurring program rather than
  // a generic QuizYear profile alias. The browser emits its dedicated intent;
  // refusing the alias here keeps direct API/Trigger callers from selecting a
  // weaker generic route for the same certified source set.
  if (
    intent?.kind === "certified_quiz" &&
    intent.profile === "sports_championship_timeline"
  ) {
    throw new Error(
      "sports_championship_timeline requires the dedicated sports_championship_timeline program intent",
    );
  }
  const candidates = CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS.filter((definition) => {
    if (definition.family !== brief.family) return false;
    if (definition.intentKind !== (intent?.kind ?? "absent")) return false;
    if (definition.intentKind === "certified_quiz") {
      return intent?.kind === "certified_quiz";
    }
    if (definition.intentKind === "sports_championship_timeline") return true;
    if (definition.intentKind === "fictional_scenario") {
      return intent?.kind === "fictional_scenario" && definition.syntheticScenarioProfile === intent.profile;
    }
    return true;
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`channel program route catalog is ambiguous for ${brief.family}`);
  }
  if (brief.family === "children_learning" || brief.family === "cinematic") {
    throw new Error(`${brief.family} channel programs require their existing private-review admission and do not have an automatic route`);
  }
  if (brief.family === "quizyear" && !intent) {
    throw new Error("QuizYear automatic channel programs require a canonical certified_quiz or sports_championship_timeline intent");
  }
  throw new Error(`no automatic channel program route is registered for ${brief.family} with this canonical program intent`);
}

function materializedQuizProfile(definition: ChannelProgramRouteDefinition, intent: ChannelProgramIntent | undefined): CertifiedQuizProfileKey | undefined {
  if (definition.intentKind === "certified_quiz") {
    if (intent?.kind !== "certified_quiz") {
      throw new Error("certified QuizYear route is missing its canonical program intent");
    }
    return intent.profile;
  }
  if (definition.intentKind === "quiz_short") {
    if (intent?.kind !== "quiz_short") {
      throw new Error("certified QuizYear route is missing its canonical program intent");
    }
    return intent.profile;
  }
  return definition.quizProfile;
}

function freezeRoute(route: ChannelProgramRoute): ChannelProgramRoute {
  return Object.freeze({
    ...route,
    ...(route.programIntent ? { programIntent: Object.freeze({ ...route.programIntent }) } : {}),
    ...(route.serializedProgram ? { serializedProgram: Object.freeze({ ...route.serializedProgram }) } : {}),
    directives: Object.freeze({
      ...route.directives,
      topicRules: Object.freeze([...route.directives.topicRules]),
      scriptRules: Object.freeze([...route.directives.scriptRules]),
      criticFocus: Object.freeze([...route.directives.criticFocus]),
    }),
    requiredBlocks: Object.freeze([...route.requiredBlocks]),
    requiredBlockOrder: Object.freeze(route.requiredBlockOrder.map((pair) => Object.freeze([...pair] as [string, string]))),
  });
}

export function resolveChannelProgramRoute(
  value: unknown,
  options: { readonly allowSupervised?: boolean } = {},
): ChannelProgramRoute {
  const brief = assertCanonicalChannelProgramBrief(value);
  const definition = matchingDefinition(brief);
  if (routeAdmission(definition) === "supervised_private" && options.allowSupervised !== true) {
    throw new Error(
      "quiz_short is a supervised private-draft route and cannot start automatic channel creation",
    );
  }
  const manifest = resolveChannelFamilyManifest(brief.family);
  const quizProfile = materializedQuizProfile(definition, brief.programIntent);
  const serializedProgram = admittedSerializedProgram(brief, definition);
  if (quizProfile) resolveCertifiedQuizProfile(quizProfile);
  const routeBody: Omit<ChannelProgramRoute, "fingerprint"> = {
    version: CHANNEL_PROGRAM_ROUTE_VERSION,
    routeKey: definition.key,
    definitionVersion: 1,
    definitionFingerprint: definitionFingerprint(definition),
    catalogFingerprint: CHANNEL_PROGRAM_ROUTE_CATALOG_FINGERPRINT,
    family: brief.family,
    contentLaneKey: manifest.contentLane.key,
    ...(routeAdmission(definition) === "automatic" ? {} : { admission: routeAdmission(definition) }),
    programBriefFingerprint: channelProgramBriefFingerprint(brief),
    ...(brief.programIntent ? { programIntent: brief.programIntent } : {}),
    ...(serializedProgram ? { serializedProgram } : {}),
    directives: definition.directives,
    requiredBlocks: definition.requiredBlocks,
    requiredBlockOrder: definition.requiredBlockOrder,
    ...(quizProfile ? { quizProfile } : {}),
    ...(definition.syntheticScenarioProfile ? { syntheticScenarioProfile: definition.syntheticScenarioProfile } : {}),
  };
  return freezeRoute({ ...routeBody, fingerprint: channelProgramRouteFingerprint(routeBody) });
}

/**
 * Explicit entry point for a human-supervised private-draft workflow.  It is
 * deliberately not used by the automatic channel-creation API.
 */
export function resolveSupervisedChannelProgramRoute(value: unknown): ChannelProgramRoute {
  const route = resolveChannelProgramRoute(value, { allowSupervised: true });
  if (route.admission !== "supervised_private") {
    throw new Error("requested channel program does not require supervised private-draft admission");
  }
  return route;
}

export function parseChannelProgramRoute(value: unknown): ChannelProgramRoute {
  const parsed = ChannelProgramRouteSchema.parse(value) as ChannelProgramRoute;
  if (parsed.fingerprint !== channelProgramRouteFingerprint(parsed)) {
    throw new Error("channel program route fingerprint is invalid");
  }
  if (parsed.catalogFingerprint !== CHANNEL_PROGRAM_ROUTE_CATALOG_FINGERPRINT) {
    throw new Error("channel program route catalog fingerprint is stale");
  }
  const definition = CHANNEL_PROGRAM_ROUTE_DEFINITION_ROWS.find((candidate) => candidate.key === parsed.routeKey);
  if (!definition) throw new Error("channel program route key is not registered");
  if (parsed.family !== definition.family || parsed.definitionFingerprint !== definitionFingerprint(definition)) {
    throw new Error("channel program route does not match its certified definition");
  }
  if ((parsed.admission ?? "automatic") !== routeAdmission(definition)) {
    throw new Error("channel program route admission does not match its certified definition");
  }
  const manifest = resolveChannelFamilyManifest(parsed.family);
  if (parsed.contentLaneKey !== manifest.contentLane.key) {
    throw new Error("channel program route content lane is stale");
  }
  const expectedQuizProfile = materializedQuizProfile(definition, parsed.programIntent);
  if (parsed.quizProfile !== expectedQuizProfile || parsed.syntheticScenarioProfile !== definition.syntheticScenarioProfile) {
    throw new Error("channel program route supplemental profile does not match its certified definition");
  }
  if (canonicalJson(parsed.directives) !== canonicalJson(definition.directives)
    || canonicalJson(parsed.requiredBlocks) !== canonicalJson(definition.requiredBlocks)
    || canonicalJson(parsed.requiredBlockOrder) !== canonicalJson(definition.requiredBlockOrder)) {
    throw new Error("channel program route directives do not match its certified definition");
  }
  return freezeRoute(parsed);
}

export function assertChannelProgramRouteBinding(input: {
  readonly route: unknown;
  readonly programBrief: unknown;
  /** Optional cross-record guard for Convex and persistence callers. */
  readonly expectedFamily?: FamilyKey;
}): ChannelProgramRoute {
  const route = parseChannelProgramRoute(input.route);
  const brief = assertCanonicalChannelProgramBrief(input.programBrief);
  if (route.family !== brief.family || route.programBriefFingerprint !== channelProgramBriefFingerprint(brief)) {
    throw new Error("channel program route does not match the canonical program brief");
  }
  if (input.expectedFamily !== undefined && route.family !== input.expectedFamily) {
    throw new Error("channel program route family does not match the persisted channel family");
  }
  if (!sameIntent(route.programIntent, brief.programIntent)) {
    throw new Error("channel program route program intent does not match the canonical program brief");
  }
  if (!sameSerializedProgram(route.serializedProgram, brief.serializedProgram)) {
    throw new Error("channel program route serialized program does not match the canonical program brief");
  }
  const expected = resolveChannelProgramRoute(brief, {
    allowSupervised: route.admission === "supervised_private",
  });
  if (canonicalJson(route) !== canonicalJson(expected)) {
    throw new Error("channel program route does not match the current admitted route");
  }
  return route;
}

export function assertChannelProgramRoutePipelineCompatibility(input: {
  readonly route: unknown;
  readonly programBrief: unknown;
  readonly pipeline: readonly PipelineEntry[];
}): ChannelProgramRoute {
  const route = assertChannelProgramRouteBinding(input);
  const positions = new Map<string, number>();
  input.pipeline.forEach((entry, index) => {
    if (!positions.has(entry.block)) positions.set(entry.block, index);
  });
  for (const block of route.requiredBlocks) {
    if (!positions.has(block)) {
      throw new Error(`channel program route ${route.routeKey} requires pipeline block ${block}`);
    }
  }
  for (const [before, after] of route.requiredBlockOrder) {
    if ((positions.get(before) ?? -1) >= (positions.get(after) ?? -1)) {
      throw new Error(`channel program route ${route.routeKey} requires ${before} before ${after}`);
    }
  }
  if (route.serializedProgram) {
    const topicSelect = input.pipeline.find((entry) => entry.block === "topic_select");
    const actualTitle = topicSelect?.params?.["seriesTitle"];
    const actualCount = topicSelect?.params?.["seriesCount"];
    if (actualTitle !== route.serializedProgram.seriesTitle) {
      throw new Error(
        `channel program route ${route.routeKey} requires topic_select.seriesTitle to match serialized_program/v1`,
      );
    }
    if (actualCount !== route.serializedProgram.seriesCount) {
      throw new Error(
        `channel program route ${route.routeKey} requires topic_select.seriesCount to match serialized_program/v1`,
      );
    }
    const contextPositions = input.pipeline
      .map((entry, index) => entry.block === "serialized_program_episode_context" ? index : -1)
      .filter((index) => index >= 0);
    if (contextPositions.length !== 1) {
      throw new Error(
        `channel program route ${route.routeKey} requires exactly one serialized_program_episode_context bridge`,
      );
    }
    const contextPosition = contextPositions[0]!;
    const topicPosition = input.pipeline.findIndex((entry) => entry.block === "topic_select");
    if (contextPosition <= topicPosition) {
      throw new Error(
        `channel program route ${route.routeKey} requires topic_select before serialized_program_episode_context`,
      );
    }
    const serialConsumers = new Set([
      "director_brief",
      "dp_brief",
      "editor_brief",
      "composer_brief",
      "critic_spec",
      "script_gen",
      "qa_script",
      "story_spine",
      "metadata",
      "thumbnail_gen",
      "qa_visual",
    ]);
    const earlyConsumer = input.pipeline.findIndex(
      (entry, index) => index < contextPosition && serialConsumers.has(entry.block),
    );
    if (earlyConsumer >= 0) {
      throw new Error(
        `channel program route ${route.routeKey} requires serialized_program_episode_context before ${input.pipeline[earlyConsumer]!.block}`,
      );
    }
  } else if (input.pipeline.some((entry) => entry.block === "serialized_program_episode_context")) {
    throw new Error(
      `channel program route ${route.routeKey} cannot include a serialized_program_episode_context bridge`,
    );
  }
  return route;
}

export function channelProgramRouteRunSeed(input: {
  readonly route: unknown;
  readonly programBrief: unknown;
}): ChannelProgramRouteRunSeed {
  const route = assertChannelProgramRouteBinding(input);
  const brief = assertCanonicalChannelProgramBrief(input.programBrief);
  return Object.freeze({
    version: CHANNEL_PROGRAM_ROUTE_RUN_SEED_VERSION,
    routeKey: route.routeKey,
    routeFingerprint: route.fingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    ...(route.admission ? { admission: route.admission } : {}),
    programBriefFingerprint: route.programBriefFingerprint,
    directives: route.directives,
    requiredBlocks: route.requiredBlocks,
    ...(route.quizProfile ? { quizProfile: route.quizProfile } : {}),
    ...(route.syntheticScenarioProfile ? { syntheticScenarioProfile: route.syntheticScenarioProfile } : {}),
    ...(route.serializedProgram ? { serializedProgram: route.serializedProgram } : {}),
    context: Object.freeze({
      locale: brief.locale,
      nicheKey: brief.nicheKey,
      ...(brief.subcategory ? { subcategory: brief.subcategory } : {}),
      ...(brief.audience ? { audience: brief.audience } : {}),
      ...(brief.sampleTopics ? { sampleTopics: Object.freeze([...brief.sampleTopics]) } : {}),
    }),
  });
}

export function parseChannelProgramRouteRunSeed(value: unknown): ChannelProgramRouteRunSeed {
  return ChannelProgramRouteRunSeedSchema.parse(value) as ChannelProgramRouteRunSeed;
}

/**
 * Immutable identity of the complete frozen run seed. Unlike a route's public
 * projection, this includes the admitted directives and synthetic profile so
 * sibling durable receipts can reject a mixed-route replay without consulting
 * the mutable route catalog.
 */
export function channelProgramRouteRunSeedFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(parseChannelProgramRouteRunSeed(value)));
}

export function assertChannelProgramRouteRunSeed(input: {
  readonly seed: unknown;
  readonly route: unknown;
  readonly programBrief: unknown;
}): ChannelProgramRouteRunSeed {
  const seed = parseChannelProgramRouteRunSeed(input.seed);
  const expected = channelProgramRouteRunSeed({ route: input.route, programBrief: input.programBrief });
  if (canonicalJson(seed) !== canonicalJson(expected)) {
    throw new Error("channel program route run seed does not match the frozen admitted route");
  }
  return seed;
}

/** Exposed for catalog tests and deliberate integrity audits. */
export function assertCertifiedChannelProgramRouteCatalog(): void {
  const seen = new Set<string>();
  for (const definition of CERTIFIED_CHANNEL_PROGRAM_ROUTE_DEFINITIONS) {
    const identity = `${definition.family}:${definition.intentKind}:${definition.quizProfile ?? definition.syntheticScenarioProfile ?? ""}`;
    if (seen.has(identity)) throw new Error(`channel program route catalog has duplicate selector ${identity}`);
    seen.add(identity);
    if (definition.requiredBlocks.length === 0) {
      throw new Error(`channel program route ${definition.key} has no required pipeline blocks`);
    }
  }
}
