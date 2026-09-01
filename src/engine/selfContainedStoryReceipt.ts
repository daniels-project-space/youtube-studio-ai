import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { parseChannelProgramRouteRunSeed } from "./channelProgramRoute";

/**
 * A provider-free, run-scoped handoff for visual engines which normally own
 * both their story planning and their paid rendering.  It does not authorize a
 * route, a provider, a render, or publication; it only proves that the exact
 * approved native plan belongs to the exact route/lane/topic reaching a
 * renderer.
 */
export const SELF_CONTAINED_STORY_RECEIPT_VERSION = "self-contained-story-receipt/v1" as const;
/**
 * The provider-free planner handoff accepted by the shared sealing block.
 * It is deliberately distinct from the receipt: a planner may write a native
 * story, but only a frozen route/topic binding may turn it into renderer input.
 */
export const SELF_CONTAINED_STORY_PLAN_VERSION = "self-contained-story-plan/v1" as const;

/**
 * The sealed whiteboard handoff must not widen the renderer's established
 * image-call ceiling. Keep this authority here so receipt validation happens
 * before any renderer/provider work.
 */
export const SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL = 5;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const SelfContainedStoryFamilySchema = z.enum(["whiteboard", "comic", "loreshort"]);
export type SelfContainedStoryFamily = z.infer<typeof SelfContainedStoryFamilySchema>;

export const SelfContainedStoryKindSchema = z.enum([
  "whiteboard-storyboard/v1",
  "motion-comic-storyboard/v1",
  "lore-plan/v1",
]);
export type SelfContainedStoryKind = z.infer<typeof SelfContainedStoryKindSchema>;

export const SELF_CONTAINED_STORY_FAMILY_CONTRACTS = {
  whiteboard: {
    contentLaneKey: "whiteboard_explainer",
    storyKind: "whiteboard-storyboard/v1",
    rendererBlockId: "whiteboard_scribe",
  },
  comic: {
    contentLaneKey: "motion_comic",
    storyKind: "motion-comic-storyboard/v1",
    rendererBlockId: "motion_comic",
  },
  loreshort: {
    contentLaneKey: "lore_micro_doc",
    storyKind: "lore-plan/v1",
    rendererBlockId: "lore_short",
  },
} as const satisfies Record<SelfContainedStoryFamily, {
  readonly contentLaneKey: string;
  readonly storyKind: SelfContainedStoryKind;
  readonly rendererBlockId: string;
}>;

function selfContainedStoryFamilyContract(family: SelfContainedStoryFamily) {
  return SELF_CONTAINED_STORY_FAMILY_CONTRACTS[family];
}

const WhiteboardLayerSchema = z.object({
  kind: z.enum(["art", "label"]),
  /** Semantic board role survives the plan→receipt→renderer→review chain. */
  role: z.enum(["hero", "evidence", "reaction"]).optional(),
  draw: nonEmptyText(1_200).optional(),
  text: nonEmptyText(280).optional(),
  color: z.enum(["black", "red"]),
  cue: nonEmptyText(1_200),
  box: z.array(z.number().finite().min(0).max(1)).length(4),
}).strict().superRefine((layer, ctx) => {
  if (layer.kind === "art" && !layer.draw) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whiteboard art layer requires draw" });
  }
  if (layer.kind === "label" && !layer.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whiteboard label layer requires text" });
  }
  if (layer.kind === "art" && layer.text !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whiteboard art layer cannot carry text" });
  }
  if (layer.kind === "label" && layer.draw !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whiteboard label layer cannot carry draw" });
  }
});

export const WhiteboardStoryboardReceiptPayloadSchema = z.object({
  title: nonEmptyText(160),
  panels: z.array(z.object({
    idx: z.number().int().min(0).max(15),
    narration: nonEmptyText(4_000),
    layers: z.array(WhiteboardLayerSchema).min(1).max(24),
  }).strict()).min(1).max(16),
  fullText: nonEmptyText(32_000),
}).strict();

const MotionComicVisualCharacterSchema = z.object({
  age: z.enum(["young", "adult", "older"]),
  build: z.enum(["slender", "average", "sturdy", "athletic"]),
  face: z.enum(["distinctive", "weathered", "angular", "soft"]),
  hair: z.enum(["dark_short", "dark_long", "light_short", "light_long", "grey", "covered"]),
  wardrobe: z.enum(["plain_shirt", "coat", "jacket", "dress", "uniform", "suit", "workwear", "robes", "layered_clothing"]),
  palette: z.enum(["neutral", "red_accent", "blue_accent", "green_accent", "gold_accent", "monochrome"]),
  accessory: z.enum(["none", "plain_scarf", "plain_hat", "glasses", "lantern"]),
}).strict();

const MotionComicVisualSceneSchema = z.object({
  environment: z.enum([
    "atmospheric_exterior", "urban_exterior", "interior", "forest", "waterfront", "mountain", "industrial",
    "ruined_landscape", "laboratory", "vehicle_interior", "spacecraft_interior", "lunar_module", "lunar_surface",
    "financial_district", "bank_vault", "temple", "ancient_ruins", "concert_stage", "homestead", "wilderness",
  ]),
  era: z.enum(["ancient", "medieval", "industrial_era", "modern", "near_future", "space_age", "timeless"]),
  subjects: z.array(z.enum([
    "reference_characters", "astronaut", "scientist", "traveler", "worker", "soldier", "detective", "medic",
    "pilot", "sailor", "civilian", "child", "elder", "crowd", "animal", "robot", "investor", "executive",
    "philosopher", "family", "musician", "naturalist", "historical_figure",
  ])).max(24),
  objects: z.array(z.enum([
    "oxygen_tank", "tool_kit", "lantern", "rope", "vehicle", "machinery", "medical_kit", "weapon", "package",
    "furniture", "vessel", "spacecraft", "coins", "vault", "hourglass", "shield", "artifact", "instrument",
    "bridge", "building", "statue", "tree",
  ])).max(24),
  action: z.enum([
    "poised_action", "urgent_movement", "tense_confrontation", "expressive_gesture", "carrying_gear", "reaching",
    "repairing", "operating_equipment", "protecting", "examining", "discovering", "building", "exchanging",
    "performing_music", "contemplating", "deliberate_work", "watchful_pause", "purposeful_travel",
  ]),
  relations: z.array(z.enum([
    "subject_repairs_object", "subject_operates_object", "subject_carries_object", "subject_reaches_for_object",
    "subject_observes_object", "subjects_face_each_other", "subjects_travel_through_environment", "subject_protects_object",
    "subject_examines_object", "subject_discovers_object", "subject_builds_object", "subjects_exchange_objects",
    "subject_plays_instrument", "subject_contemplates_object",
  ])).max(16),
  mood: z.enum(["tense", "urgent", "somber", "hopeful", "mysterious", "calm"]),
  lighting: z.enum(["daylight", "golden_hour", "moonlight", "firelight", "interior_light"]),
}).strict();

const MotionComicCharacterSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "expected a stable character id"),
  name: nonEmptyText(120),
  visual: MotionComicVisualCharacterSchema,
  voiceId: nonEmptyText(160),
}).strict();

const MotionComicPanelSchema = z.object({
  visual: MotionComicVisualSceneSchema,
  characters: z.array(z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(4),
  shot: z.enum(["wide", "medium", "close"]),
  lines: z.array(z.object({
    speaker: z.string().trim().regex(/^(?:narrator|[A-Za-z0-9_-]{1,64})$/, "expected narrator or a stable character id"),
    text: nonEmptyText(1_000),
  }).strict()).min(1).max(3),
}).strict();

export const MotionComicStoryboardReceiptPayloadSchema = z.object({
  title: nonEmptyText(160),
  logline: z.string().trim().max(500),
  narratorVoiceId: nonEmptyText(160),
  characters: z.array(MotionComicCharacterSchema).max(4),
  panels: z.array(MotionComicPanelSchema).min(1).max(12),
}).strict();

export const LorePlanReceiptPayloadSchema = z.object({
  scenes: z.array(z.object({
    line: nonEmptyText(1_000),
    shot: nonEmptyText(160).optional(),
    visual: nonEmptyText(4_000),
    camera: nonEmptyText(1_000),
  }).strict()).min(1).max(16),
}).strict();

export type WhiteboardStoryboardReceiptPayload = z.infer<typeof WhiteboardStoryboardReceiptPayloadSchema>;
export type MotionComicStoryboardReceiptPayload = z.infer<typeof MotionComicStoryboardReceiptPayloadSchema>;
export type LorePlanReceiptPayload = z.infer<typeof LorePlanReceiptPayloadSchema>;
export type SelfContainedStoryPayload =
  | WhiteboardStoryboardReceiptPayload
  | MotionComicStoryboardReceiptPayload
  | LorePlanReceiptPayload;

const PlannerSchema = z.object({
  id: nonEmptyText(160),
  provenance: nonEmptyText(500),
}).strict();

const CritiqueSchema = z.object({
  accepted: z.literal(true),
  score: z.number().finite().min(0).max(1),
  iterations: z.number().int().min(1).max(10),
  issues: z.array(z.string().trim().min(1).max(600)).max(12),
}).strict();

/**
 * An accepted native plan from a future planner/critic pair. This contains no
 * provider selection, render budget, route admission, or publication signal;
 * the shared Trigger block below only seals it to an already-frozen route.
 */
export const SelfContainedStoryPlanSchema = z.discriminatedUnion("storyKind", [
  z.object({
    version: z.literal(SELF_CONTAINED_STORY_PLAN_VERSION),
    family: z.literal("whiteboard"),
    planner: PlannerSchema,
    critique: CritiqueSchema,
    storyKind: z.literal("whiteboard-storyboard/v1"),
    story: WhiteboardStoryboardReceiptPayloadSchema,
  }).strict(),
  z.object({
    version: z.literal(SELF_CONTAINED_STORY_PLAN_VERSION),
    family: z.literal("comic"),
    planner: PlannerSchema,
    critique: CritiqueSchema,
    storyKind: z.literal("motion-comic-storyboard/v1"),
    story: MotionComicStoryboardReceiptPayloadSchema,
  }).strict(),
  z.object({
    version: z.literal(SELF_CONTAINED_STORY_PLAN_VERSION),
    family: z.literal("loreshort"),
    planner: PlannerSchema,
    critique: CritiqueSchema,
    storyKind: z.literal("lore-plan/v1"),
    story: LorePlanReceiptPayloadSchema,
  }).strict(),
]);

/**
 * The single construction boundary for a route-owned native story plan.
 * Renderers still validate the sealed receipt themselves; this only prevents
 * each future planner adapter from hand-assembling a subtly different plan
 * shape before that sealing step.
 */
export function createSelfContainedStoryPlan(input: {
  readonly family: SelfContainedStoryFamily;
  readonly planner: { readonly id: string; readonly provenance: string };
  readonly critique: {
    readonly accepted: true;
    readonly score: number;
    readonly iterations: number;
    readonly issues: readonly string[];
  };
  readonly story: unknown;
}): SelfContainedStoryPlan {
  const contract = selfContainedStoryFamilyContract(input.family);
  return SelfContainedStoryPlanSchema.parse({
    version: SELF_CONTAINED_STORY_PLAN_VERSION,
    family: input.family,
    planner: input.planner,
    critique: {
      accepted: input.critique.accepted,
      score: input.critique.score,
      iterations: input.critique.iterations,
      issues: [...input.critique.issues],
    },
    storyKind: contract.storyKind,
    story: input.story,
  });
}
export type SelfContainedStoryPlan = z.infer<typeof SelfContainedStoryPlanSchema>;

const receiptCommon = {
  version: z.literal(SELF_CONTAINED_STORY_RECEIPT_VERSION),
  routeFingerprint: sha256,
  programBriefFingerprint: sha256,
  topicFingerprint: sha256,
  planner: PlannerSchema,
  critique: CritiqueSchema,
  storyFingerprint: sha256,
  fingerprint: sha256,
};

const WhiteboardStoryReceiptSchema = z.object({
  ...receiptCommon,
  family: z.literal("whiteboard"),
  contentLaneKey: z.literal("whiteboard_explainer"),
  storyKind: z.literal("whiteboard-storyboard/v1"),
  story: WhiteboardStoryboardReceiptPayloadSchema,
}).strict();

const MotionComicStoryReceiptSchema = z.object({
  ...receiptCommon,
  family: z.literal("comic"),
  contentLaneKey: z.literal("motion_comic"),
  storyKind: z.literal("motion-comic-storyboard/v1"),
  story: MotionComicStoryboardReceiptPayloadSchema,
}).strict();

const LoreStoryReceiptSchema = z.object({
  ...receiptCommon,
  family: z.literal("loreshort"),
  contentLaneKey: z.literal("lore_micro_doc"),
  storyKind: z.literal("lore-plan/v1"),
  story: LorePlanReceiptPayloadSchema,
}).strict();

export const SelfContainedStoryReceiptSchema = z.discriminatedUnion("storyKind", [
  WhiteboardStoryReceiptSchema,
  MotionComicStoryReceiptSchema,
  LoreStoryReceiptSchema,
]).superRefine((receipt, ctx) => {
  try {
    validateStoryInternals(receipt);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "self-contained story receipt payload is invalid",
    });
  }
  if (receipt.storyFingerprint !== selfContainedStoryPayloadFingerprint(receipt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "self-contained story receipt story fingerprint is invalid" });
  }
  if (receipt.fingerprint !== selfContainedStoryReceiptFingerprint(receipt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "self-contained story receipt fingerprint is invalid" });
  }
});

export type SelfContainedStoryReceipt = z.infer<typeof SelfContainedStoryReceiptSchema>;

export interface SelfContainedStoryReceiptBinding {
  readonly family: SelfContainedStoryFamily;
  readonly contentLaneKey: string;
  readonly routeFingerprint: string;
  readonly programBriefFingerprint: string;
  readonly topic: string;
}

export interface CreateSelfContainedStoryReceiptInput {
  readonly family: SelfContainedStoryFamily;
  readonly routeFingerprint: string;
  readonly programBriefFingerprint: string;
  readonly topic: string;
  readonly planner: z.input<typeof PlannerSchema>;
  readonly critique: z.input<typeof CritiqueSchema>;
  readonly storyKind: SelfContainedStoryKind;
  readonly story: unknown;
}

function receiptIdentity(value: Omit<SelfContainedStoryReceipt, "fingerprint"> | SelfContainedStoryReceipt): unknown {
  const { fingerprint: _fingerprint, ...identity } = value as SelfContainedStoryReceipt;
  void _fingerprint;
  return identity;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateStoryInternals(receipt: SelfContainedStoryReceipt): void {
  if (receipt.storyKind === "whiteboard-storyboard/v1") {
    const expectedFullText = receipt.story.panels.map((panel) => panel.narration).join(" ");
    if (receipt.story.fullText !== expectedFullText) {
      throw new Error("self-contained story receipt whiteboard fullText does not match its panel narration");
    }
    if (receipt.story.panels.some((panel, index) => panel.idx !== index)) {
      throw new Error("self-contained story receipt whiteboard panel indices are not canonical");
    }
    if (receipt.story.panels.some(
      (panel) => panel.layers.filter((layer) => layer.kind === "art").length >
        SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL,
    )) {
      throw new Error(
        "self-contained story receipt whiteboard panel exceeds the approved art-layer ceiling",
      );
    }
    return;
  }
  if (receipt.storyKind === "motion-comic-storyboard/v1") {
    const characterIds = receipt.story.characters.map((character) => character.id);
    if (!unique(characterIds)) {
      throw new Error("self-contained story receipt motion-comic character ids must be unique");
    }
    const known = new Set(characterIds);
    for (const panel of receipt.story.panels) {
      if (panel.characters.some((id) => !known.has(id))) {
        throw new Error("self-contained story receipt motion-comic panel references an unknown character");
      }
      if (panel.lines.some((line) => line.speaker !== "narrator" && !known.has(line.speaker))) {
        throw new Error("self-contained story receipt motion-comic line references an unknown speaker");
      }
    }
  }
}

/** Fingerprint the native payload together with its discriminant. */
export function selfContainedStoryPayloadFingerprint(input: {
  readonly storyKind: SelfContainedStoryKind;
  readonly story: unknown;
}): string {
  return sha256Hex(canonicalJson({ storyKind: input.storyKind, story: input.story }));
}

/** Stable topic binding; the original topic text never needs to be duplicated in the receipt. */
export function selfContainedStoryTopicFingerprint(topic: unknown): string {
  return sha256Hex(canonicalJson(nonEmptyText(500).parse(topic)));
}

export function selfContainedStoryReceiptFingerprint(
  receipt: Omit<SelfContainedStoryReceipt, "fingerprint"> | SelfContainedStoryReceipt,
): string {
  return sha256Hex(canonicalJson(receiptIdentity(receipt)));
}

/** Validate both the strict schema and every derived content identity. */
export function validateSelfContainedStoryReceipt(value: unknown): SelfContainedStoryReceipt {
  const receipt = SelfContainedStoryReceiptSchema.parse(value);
  validateStoryInternals(receipt);
  if (receipt.storyFingerprint !== selfContainedStoryPayloadFingerprint(receipt)) {
    throw new Error("self-contained story receipt story fingerprint is invalid");
  }
  if (receipt.fingerprint !== selfContainedStoryReceiptFingerprint(receipt)) {
    throw new Error("self-contained story receipt fingerprint is invalid");
  }
  return receipt;
}

/** Construct a receipt without any provider work. Future planner blocks call this after their own critique. */
export function createSelfContainedStoryReceipt(input: CreateSelfContainedStoryReceiptInput): SelfContainedStoryReceipt {
  const contract = selfContainedStoryFamilyContract(input.family);
  if (input.storyKind !== contract.storyKind) {
    throw new Error(`self-contained story receipt ${input.family} requires ${contract.storyKind}`);
  }
  const candidate = {
    version: SELF_CONTAINED_STORY_RECEIPT_VERSION,
    family: input.family,
    contentLaneKey: contract.contentLaneKey,
    routeFingerprint: sha256.parse(input.routeFingerprint),
    programBriefFingerprint: sha256.parse(input.programBriefFingerprint),
    topicFingerprint: selfContainedStoryTopicFingerprint(input.topic),
    planner: PlannerSchema.parse(input.planner),
    critique: CritiqueSchema.parse(input.critique),
    storyKind: input.storyKind,
    story: input.story,
    storyFingerprint: selfContainedStoryPayloadFingerprint({ storyKind: input.storyKind, story: input.story }),
  } as Omit<SelfContainedStoryReceipt, "fingerprint">;
  const receipt = { ...candidate, fingerprint: selfContainedStoryReceiptFingerprint(candidate) };
  return validateSelfContainedStoryReceipt(receipt);
}

/**
 * Build the renderer-side binding from an already admitted route run seed.
 * This function never creates a route and rejects any attempt to use a
 * self-contained story with a different family, lane, or renderer contract.
 */
export function selfContainedStoryReceiptBindingFromRoute(input: {
  readonly family: SelfContainedStoryFamily;
  readonly route: unknown;
  readonly topic: unknown;
}): SelfContainedStoryReceiptBinding {
  const route = parseChannelProgramRouteRunSeed(input.route);
  const contract = selfContainedStoryFamilyContract(input.family);
  if (route.family !== input.family) {
    throw new Error("self-contained story route family does not match the planner family");
  }
  if (route.contentLaneKey !== contract.contentLaneKey) {
    throw new Error("self-contained story route content lane does not match the planner family");
  }
  if (!route.requiredBlocks.includes(contract.rendererBlockId)) {
    throw new Error("self-contained story route does not admit the requested renderer");
  }
  return {
    family: input.family,
    contentLaneKey: contract.contentLaneKey,
    routeFingerprint: route.routeFingerprint,
    programBriefFingerprint: route.programBriefFingerprint,
    topic: nonEmptyText(500).parse(input.topic),
  };
}

/**
 * A renderer may retain a legacy self-planning mode for historical, receiptless
 * runs. An admitted route that explicitly places `self_contained_story` is
 * different: it has already paid for and sealed its native plan, so silently
 * falling back to a second planner would break continuity and spend control.
 */
export function selfContainedStoryReceiptRequiredForRoute(input: {
  readonly family: SelfContainedStoryFamily;
  readonly route: unknown;
  readonly topic: unknown;
}): boolean {
  const route = parseChannelProgramRouteRunSeed(input.route);
  // Reuse the full family/lane/renderer validation before inspecting the
  // route's structural requirement. This remains a provider-free check.
  selfContainedStoryReceiptBindingFromRoute(input);
  return route.requiredBlocks.includes("self_contained_story");
}

/**
 * Seal an already accepted native plan to an already admitted run route. The
 * caller supplies every input explicitly; there is intentionally no planner,
 * cache, model, or legacy-plan fallback in this shared boundary.
 */
export function createSelfContainedStoryReceiptFromRoute(input: {
  readonly route: unknown;
  readonly topic: unknown;
  readonly plan: unknown;
}): SelfContainedStoryReceipt {
  const plan = SelfContainedStoryPlanSchema.parse(input.plan);
  const binding = selfContainedStoryReceiptBindingFromRoute({
    family: plan.family,
    route: input.route,
    topic: input.topic,
  });
  return createSelfContainedStoryReceipt({
    family: plan.family,
    routeFingerprint: binding.routeFingerprint,
    programBriefFingerprint: binding.programBriefFingerprint,
    topic: binding.topic,
    planner: plan.planner,
    critique: plan.critique,
    storyKind: plan.storyKind,
    story: plan.story,
  });
}

/**
 * Bind a receipt to the exact route/lane/topic observed by a renderer. This
 * must run before a renderer can choose a legacy self-planning fallback.
 */
export function assertSelfContainedStoryReceiptBinding(input: {
  readonly receipt: unknown;
  readonly expected: SelfContainedStoryReceiptBinding;
}): SelfContainedStoryReceipt {
  const receipt = validateSelfContainedStoryReceipt(input.receipt);
  if (receipt.family !== input.expected.family) {
    throw new Error("self-contained story receipt family does not match the renderer family");
  }
  if (receipt.contentLaneKey !== input.expected.contentLaneKey) {
    throw new Error("self-contained story receipt content lane does not match the renderer lane");
  }
  if (receipt.routeFingerprint !== input.expected.routeFingerprint) {
    throw new Error("self-contained story receipt route fingerprint does not match the frozen route");
  }
  if (receipt.programBriefFingerprint !== input.expected.programBriefFingerprint) {
    throw new Error("self-contained story receipt program brief fingerprint does not match the frozen route");
  }
  if (receipt.topicFingerprint !== selfContainedStoryTopicFingerprint(input.expected.topic)) {
    throw new Error("self-contained story receipt topic fingerprint does not match the renderer topic");
  }
  return receipt;
}

/**
 * Resolve the receipt before considering a caller-provided legacy plan. An
 * invalid supplied receipt intentionally throws instead of falling back to a
 * self-planning or legacy-plan path.
 */
export function resolveSelfContainedStoryPlan(input: {
  readonly family: SelfContainedStoryFamily;
  readonly receipt?: unknown;
  readonly binding?: SelfContainedStoryReceiptBinding;
  readonly legacyPlan?: unknown;
}): {
  readonly receiptSupplied: boolean;
  readonly receipt?: SelfContainedStoryReceipt;
  readonly plan?: SelfContainedStoryPayload;
} {
  if (input.receipt === undefined) {
    return { receiptSupplied: false, ...(input.legacyPlan === undefined ? {} : { plan: input.legacyPlan as SelfContainedStoryPayload }) };
  }
  if (!input.binding) {
    throw new Error("self-contained story receipt requires an exact renderer binding");
  }
  const receipt = assertSelfContainedStoryReceiptBinding({ receipt: input.receipt, expected: input.binding });
  if (receipt.family !== input.family) {
    throw new Error("self-contained story receipt family does not match the requested renderer");
  }
  if (input.legacyPlan !== undefined && canonicalJson(input.legacyPlan) !== canonicalJson(receipt.story)) {
    throw new Error("self-contained story receipt conflicts with the supplied legacy plan");
  }
  return { receiptSupplied: true, receipt, plan: receipt.story };
}
