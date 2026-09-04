/**
 * Visual Matter is the reusable visual-development contract for generated
 * stories. It turns the channel's visual identity plus the timed story spine
 * into a versioned set of mood, character, setting, and shot-specific locks.
 *
 * It deliberately lives above a renderer: cinematic Novita, motion comic, or
 * a future renderer can consume the same package without inventing a new
 * channel family for every creative format.
 */
import { z } from "zod";

import type { StudioAssetRecipeProjection } from "@/engine/studioAssetLibrary";
import {
  assertVisualTreatmentPlan,
  type VisualTreatmentPlan,
} from "@/engine/visualTreatmentCatalog";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import {
  ContinuityLedgerSchema,
  DPVisualSpecSchema,
  NarrativeBeatSchema,
  ShotPlanSchema,
} from "./storySpine";

const text = z.string().min(1);

/**
 * A single shot may bind no more than this many durable reference anchors.
 * Novita QA uses the same bound to reserve every required vision batch before
 * it can buy a render repair.
 */
export const VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT = 10;

export const VisualMatterAssetKindSchema = z.enum([
  "mood_board",
  "character_sheet",
  "setting_sheet",
  "storyboard_frame",
]);

export const VisualMatterReferenceAssetSchema = z.object({
  id: text,
  kind: VisualMatterAssetKindSchema,
  label: text,
  prompt: text,
  shotId: z.string().min(1).optional(),
  /**
   * `referenceAssets` are actual comparison pixels, not a plan to make
   * pixels. Keep the object byte-bound so an adapter cannot claim an anchor
   * that was never uploaded or swap it after the fact.
   */
  r2Key: z.string().min(1),
  contentType: z.string().regex(/^image\/(?:png|jpeg|webp)$/i),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  /** The exact Visual Matter plan from which this asset request was derived. */
  sourceManifestRevision: z.string().regex(/^[a-f0-9]{64}$/i),
  /** Binds id/kind/label/prompt/shot to the source plan before a provider runs. */
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  receipt: z.object({
    provider: text,
    model: text,
    responseId: text,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    responseSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    costUsd: z.number().finite().nonnegative(),
  }).passthrough(),
}).strict();

export const VisualMatterMoodBoardSchema = z.object({
  id: z.literal("mood-primary"),
  mood: text,
  palette: z.array(z.string().min(1)).max(12),
  lighting: text,
  visualPrompt: text,
}).strict();

export const VisualMatterCharacterSchema = z.object({
  id: text,
  name: text,
  identityLock: text,
  stylePrompt: text,
}).strict();

export const VisualMatterSettingSchema = z.object({
  id: text,
  name: text,
  continuityLock: text,
  stylePrompt: text,
}).strict();

export const VisualMatterStoryboardSchema = z.object({
  shotId: z.string().regex(/^shot-[a-z0-9-]+$/),
  beatId: text,
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  characterIds: z.array(text).max(6),
  settingId: z.string().min(1).optional(),
  promptAddendum: text,
  motionAddendum: text,
  acceptanceCriteria: z.array(text).min(3).max(16),
  referenceAssetIds: z.array(text).max(VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT),
}).refine((frame) => frame.t1 > frame.t0, "storyboard frame must have a positive time window");

export const VisualMatterReviewLockSchema = z.object({
  shotId: z.string().regex(/^shot-[a-z0-9-]+$/),
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().positive(),
  expected: text,
  acceptanceCriteria: z.array(text).min(3).max(16),
}).refine((lock) => lock.endSec > lock.startSec, "visual review lock must have a positive time window");

/** A compact, sealed treatment projection; all detailed rules compile into the shot locks below. */
const VisualMatterTreatmentSchema = z.object({
  key: z.enum(["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"]),
  label: text,
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  requiredReferenceKinds: z.array(VisualMatterAssetKindSchema).min(1),
  qaBenchmarkIds: z.array(text).min(1),
}).strict();

export const VisualMatterManifestSchema = z.object({
  version: z.literal("visual-matter/v1"),
  /** disabled is a deliberate no-op, not an absent or malformed handoff. */
  status: z.enum(["disabled", "planned", "anchored"]),
  revision: z.string().regex(/^[a-f0-9]{64}$/i),
  topic: text,
  channelWorld: text,
  moodBoard: VisualMatterMoodBoardSchema,
  characters: z.array(VisualMatterCharacterSchema).max(6),
  settings: z.array(VisualMatterSettingSchema).max(6),
  storyboard: z.array(VisualMatterStoryboardSchema).min(1),
  reviewLocks: z.array(VisualMatterReviewLockSchema).min(1),
  /** Present only when a canonical treatment plan was explicitly selected. */
  treatment: VisualMatterTreatmentSchema.optional(),
  referenceAssets: z.array(VisualMatterReferenceAssetSchema).max(16),
  /** Present only when actual, byte-bound reference pixels are attached. */
  referencePackFingerprint: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict().superRefine((manifest, context) => {
  const hasReferenceAssets = manifest.referenceAssets.length > 0;
  if (manifest.status === "anchored") {
    if (!hasReferenceAssets) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceAssets"],
        message: "an anchored Visual Matter manifest requires actual reference assets",
      });
    }
    if (!manifest.referencePackFingerprint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referencePackFingerprint"],
        message: "an anchored Visual Matter manifest requires a reference-pack fingerprint",
      });
    } else if (manifest.referencePackFingerprint !== visualMatterReferencePackFingerprint(manifest)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referencePackFingerprint"],
        message: "Visual Matter reference-pack fingerprint does not bind the attached assets",
      });
    }
    return;
  }
  if (hasReferenceAssets || manifest.referencePackFingerprint) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["referenceAssets"],
      message: "only an anchored Visual Matter manifest may carry reference assets",
    });
  }
});

export type VisualMatterManifest = z.infer<typeof VisualMatterManifestSchema>;
export type VisualMatterReferenceAsset = z.infer<typeof VisualMatterReferenceAssetSchema>;

export interface PlanVisualMatterInput {
  topic: string;
  channelName?: string;
  styleDNA?: Record<string, unknown> | null;
  visualBrief?: Record<string, unknown> | null;
  continuityLedger: unknown;
  narrativeBeats: unknown;
  shotList: unknown;
  dpVisualSpecs: unknown;
  /** Approved Studio Library recipe text only—never paths, bytes, or raw guides. */
  studioAssetRecipeProjection?: StudioAssetRecipeProjection;
  /** Canonical treatment plan; revalidated before it can affect prompts or QA locks. */
  visualTreatment?: VisualTreatmentPlan;
  maxCharacters?: number;
  maxSettings?: number;
}

export interface VisualMatterAssetRequest {
  id: string;
  kind: z.infer<typeof VisualMatterAssetKindSchema>;
  label: string;
  prompt: string;
  shotId?: string;
}

export interface VisualMatterShotDirective {
  renderPrompt: string;
  motionPrompt: string;
  qaCriteria: string;
  referenceAssetLabels: string[];
}

function sha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function requestIdentity(request: VisualMatterAssetRequest) {
  return {
    id: request.id,
    kind: request.kind,
    label: request.label,
    prompt: request.prompt,
    ...(request.shotId ? { shotId: request.shotId } : {}),
  };
}

/** A provider-independent binding from one planned reference request to its source plan. */
export function visualMatterAssetRequestFingerprint(
  manifestRevision: string,
  request: VisualMatterAssetRequest,
): string {
  return sha256({
    version: "visual-matter-reference-request/v1",
    manifestRevision,
    request: requestIdentity(request),
  });
}

/**
 * The plan revision intentionally stays stable after pre-production assets
 * arrive. This second fingerprint binds the concrete reference pack without
 * pretending that planning text alone is image evidence.
 */
export function visualMatterReferencePackFingerprint(
  manifest: Pick<VisualMatterManifest, "revision" | "referenceAssets">,
): string {
  return sha256({
    version: "visual-matter-reference-pack/v1",
    sourceManifestRevision: manifest.revision,
    referenceAssets: [...manifest.referenceAssets]
      .map((asset) => VisualMatterReferenceAssetSchema.parse(asset))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

/** Verify bytes at the first real consumer boundary before they reach visual QA. */
export function assertVisualMatterReferenceAssetBytes(
  asset: VisualMatterReferenceAsset,
  bytes: Uint8Array,
): VisualMatterReferenceAsset {
  const parsed = VisualMatterReferenceAssetSchema.parse(asset);
  const actual = sha256BytesHex(bytes);
  if (actual !== parsed.contentSha256) {
    throw new Error(`Visual Matter reference asset '${parsed.id}' bytes do not match its declared contentSha256`);
  }
  return parsed;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : [];
}

function stringAt(record: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, safe));
}

function clipped(value: string, max = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function evenlyPick<T>(values: readonly T[], count: number): T[] {
  if (count <= 0 || values.length === 0) return [];
  if (values.length <= count) return [...values];
  return Array.from({ length: count }, (_, index) => {
    const at = Math.min(values.length - 1, Math.floor(((index + 0.5) * values.length) / count));
    return values[at];
  });
}

/** Build the deterministic pre-production package. No image provider is called here. */
export function planVisualMatter(input: PlanVisualMatterInput): VisualMatterManifest {
  const topic = clipped(input.topic || "Untitled story", 300);
  const ledger = ContinuityLedgerSchema.parse(input.continuityLedger);
  const beats = z.array(NarrativeBeatSchema).min(1).parse(input.narrativeBeats);
  const shots = z.array(ShotPlanSchema).min(1).parse(input.shotList);
  const specs = z.array(DPVisualSpecSchema).min(1).parse(input.dpVisualSpecs);
  const treatment = input.visualTreatment
    ? assertVisualTreatmentPlan(input.visualTreatment)
    : undefined;
  const treatmentProjection = treatment
    ? {
      key: treatment.treatmentKey,
      label: treatment.label,
      planFingerprint: treatment.fingerprint,
      requiredReferenceKinds: [...treatment.storyboard.requiredReferenceKinds],
      qaBenchmarkIds: treatment.qaBenchmarks.map((benchmark) => benchmark.id),
    }
    : undefined;
  const specByShot = new Map(specs.map((spec) => [spec.shotId, spec]));
  if (specByShot.size !== shots.length || shots.some((shot) => !specByShot.has(shot.id))) {
    throw new Error("visual matter requires one DP visual spec for every story shot");
  }
  const beatById = new Map(beats.map((beat) => [beat.id, beat]));

  const dna = input.styleDNA ?? {};
  const visualBrief = input.visualBrief ?? {};
  const studioRecipes = input.studioAssetRecipeProjection;
  const cameraRecipe = studioRecipes?.cameraAddenda.length
    ? clipped(studioRecipes.cameraAddenda.join(". "), 600)
    : "";
  const motionRecipe = studioRecipes?.motionAddenda.length
    ? clipped(studioRecipes.motionAddenda.join(". "), 600)
    : "";
  const promptRecipe = studioRecipes?.promptAddenda.length
    ? clipped(studioRecipes.promptAddenda.join(". "), 600)
    : "";
  const palette = [...new Set([
    ...strings(dna["palette"]),
    ...ledger.palette,
  ])].slice(0, 8);
  const setting = stringAt(dna, "setting") ?? ledger.locations[0]?.name;
  const recurringSubject = stringAt(dna, "recurringSubject") ?? ledger.entities[0]?.name;
  const colorGrade = stringAt(dna, "colorGrade");
  const mood = stringAt(visualBrief, "mood") ?? stringAt(dna, "vibe") ??
    (colorGrade ? `${colorGrade} cinematic mood` : "intentional cinematic mood tied to the narration");
  const lighting = stringAt(dna, "lighting") ?? "motivated, coherent lighting that supports the story beat";
  const treatmentComposition = treatment?.cinematography.compositionRules.join(" ") ?? "";
  const treatmentMotion = treatment?.cinematography.motionRules.join(" ") ?? "";
  const treatmentAvoid = treatment?.cinematography.avoid.join(", ") ?? "";
  const treatmentStoryboard = treatment?.storyboard.framePlanningRules.join(" ") ?? "";
  const treatmentAnimatic = treatment?.storyboard.animaticRules.join(" ") ?? "";
  const treatmentLocks = treatment?.continuity.requiredLocks.join(", ") ?? "";
  const treatmentDrift = treatment?.continuity.forbiddenDrift.join(", ") ?? "";
  const channelWorld = clipped([
    input.channelName ? `Channel: ${input.channelName}` : "",
    recurringSubject ? `Recurring subject: ${recurringSubject}` : "",
    setting ? `World: ${setting}` : "",
    colorGrade ? `Color grade: ${colorGrade}` : "",
    palette.length ? `Palette: ${palette.join(", ")}` : "",
    promptRecipe ? `Approved Studio treatment: ${promptRecipe}` : "",
    treatment ? `Selected visual treatment: ${treatment.label}. ${treatmentComposition}` : "",
    `Mood: ${mood}`,
  ].filter(Boolean).join(". ") || `A deliberate cinematic world for ${topic}`);

  const maxCharacters = boundedInteger(input.maxCharacters, 3, 0, 6);
  const characters = ledger.entities.slice(0, maxCharacters).map((entity) => {
    const wardrobe = ledger.wardrobe.length ? `Wardrobe: ${ledger.wardrobe.join(", ")}.` : "";
    const props = ledger.props.length ? `Recurring props: ${ledger.props.join(", ")}.` : "";
    const identityLock = clipped(`${entity.look}. ${wardrobe} ${props}`);
    return {
      id: entity.id,
      name: entity.name,
      identityLock,
      stylePrompt: clipped(
        `Create a consistent cinematic character reference for ${entity.name}. ${identityLock} ` +
        `${channelWorld}. ${treatment ? `Treatment storyboard rule: ${treatmentStoryboard}. ` : ""}` +
        `Full figure, front/three-quarter/profile turnaround, neutral readable pose, ` +
        `no typography, labels, captions, logos, or watermarks.`,
      ),
    };
  });

  const maxSettings = boundedInteger(input.maxSettings, 3, 0, 6);
  const sourceLocations = ledger.locations.length
    ? ledger.locations
    : setting
      ? [{ id: "location-primary", name: setting, look: setting }]
      : [];
  const settings = sourceLocations.slice(0, maxSettings).map((location) => {
    const continuityLock = clipped(
      `${location.look}. Era: ${ledger.era}. ${ledger.props.length ? `Key props: ${ledger.props.join(", ")}.` : ""} ` +
      `Lighting: ${lighting}. ${palette.length ? `Palette: ${palette.join(", ")}.` : ""}`,
    );
    return {
      id: location.id,
      name: location.name,
      continuityLock,
      stylePrompt: clipped(
        `Create a cinematic environment reference for ${location.name}. ${continuityLock} ${channelWorld}. ` +
        `${treatment ? `Treatment composition rule: ${treatmentComposition}. ` : ""}` +
        `Show spatial logic, surfaces, depth, and practical light sources. No people unless needed for scale. ` +
        `No typography, labels, captions, logos, or watermarks.`,
      ),
    };
  });
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const settingById = new Map(settings.map((location) => [location.id, location]));

  const moodBoard = {
    id: "mood-primary" as const,
    mood: clipped(mood, 300),
    palette,
    lighting: clipped(lighting, 300),
    visualPrompt: clipped(
      `Create a cinematic mood board for “${topic}”. ${channelWorld}. ` +
      `${treatment ? `Treatment reference requirement: ${treatment.storyboard.requiredReferenceKinds.join(", ")}. ` : ""}` +
      `Include atmosphere, material, light, framing, and color references that make the visual world unmistakable. ` +
      `It is a visual reference only: no readable typography, labels, captions, logos, or watermarks.`,
    ),
  };

  const storyboard = shots.map((shot) => {
    const beat = beatById.get(shot.beatId);
    const characterIds = shot.entities.filter((id) => characterById.has(id));
    const settingId = shot.locationId && settingById.has(shot.locationId) ? shot.locationId : undefined;
    const characterLock = characterIds.length
      ? characterIds.map((id) => characterById.get(id)!.identityLock).join(" ")
      : "No named character is required; retain the world and subject continuity.";
    const settingLock = settingId
      ? settingById.get(settingId)!.continuityLock
      : setting ?? "Use the established cinematic world without an arbitrary location change.";
    const promptAddendum = clipped(
      `Visual Matter lock for ${shot.id}: ${shot.literalContent}. ` +
      `Story purpose: ${beat?.purpose ?? shot.coveragePurpose}. Character lock: ${characterLock} ` +
      `Setting lock: ${settingLock} Mood: ${moodBoard.mood}. ` +
      `${treatment ? `Treatment composition: ${treatmentComposition}. Storyboard rule: ${treatmentStoryboard}. ` : ""}` +
      `${cameraRecipe ? `Approved camera grammar: ${cameraRecipe}. ` : ""}` +
      `Retain this exact story state; do not substitute generic beauty footage.`,
    );
    const motionAddendum = clipped(
      `Begin from the locked storyboard state and preserve identity, setting, wardrobe, props, palette, and lighting. ` +
      `${treatment ? `Treatment motion: ${treatmentMotion}. Animatic rule: ${treatmentAnimatic}. ` : ""}` +
      `${motionRecipe ? `Apply the approved motion grammar: ${motionRecipe}. ` : ""}` +
      `Only advance the action implied by “${shot.literalContent}”; no unmotivated morph, costume swap, location jump, or era drift.`,
    );
    const acceptanceCriteria = [
      `The frame visibly depicts the narrated moment: ${shot.literalContent}`,
      characterIds.length
        ? `Named-character identity remains consistent: ${characterIds.join(", ")}`
        : "The subject and visual world remain consistent with the storyboard lock",
      settingId
        ? `The setting remains ${settingById.get(settingId)!.name}`
        : "The setting remains coherent with the established channel world",
      `Mood, lighting, palette, wardrobe, props, and era remain coherent: ${moodBoard.mood}`,
      ...(treatment
        ? [
          `Treatment continuity locks remain intact: ${treatmentLocks}`,
          `Treatment-specific drift is absent: ${treatmentDrift}`,
          ...treatment.qaBenchmarks.map((benchmark) =>
            `${treatment.label} ${benchmark.scope} QA (${benchmark.id}): ${benchmark.criterion} Fail if: ${benchmark.failureSignal}`,
          ),
          `Treatment exclusions are absent: ${treatmentAvoid}`,
        ]
        : []),
      ...(studioRecipes?.sourceEntryFingerprints.length
        ? ["Approved Studio recipe grammar is retained without adding unapproved visual material"]
        : []),
      "No accidental text, logo, watermark, duplicate anatomy, broken geometry, or generic unrelated footage",
    ];
    return {
      shotId: shot.id,
      beatId: shot.beatId,
      t0: shot.t0,
      t1: shot.t1,
      characterIds,
      ...(settingId ? { settingId } : {}),
      promptAddendum,
      motionAddendum,
      acceptanceCriteria,
      referenceAssetIds: [
        "mood-primary",
        ...characterIds,
        ...(settingId ? [settingId] : []),
      ],
    };
  });
  const reviewLocks = storyboard.map((frame) => ({
    shotId: frame.shotId,
    startSec: frame.t0,
    endSec: frame.t1,
    expected: frame.promptAddendum,
    acceptanceCriteria: frame.acceptanceCriteria,
  }));
  const revision = sha256({
    topic,
    channelWorld,
    moodBoard,
    characters,
    settings,
    storyboard,
    treatment: treatmentProjection,
    studioRecipeProjectionFingerprint: studioRecipes?.fingerprint,
  });

  return VisualMatterManifestSchema.parse({
    version: "visual-matter/v1",
    status: "planned",
    revision,
    topic,
    channelWorld,
    moodBoard,
    characters,
    settings,
    storyboard,
    reviewLocks,
    ...(treatmentProjection ? { treatment: treatmentProjection } : {}),
    referenceAssets: [],
  });
}

/**
 * Select a bounded reference pack for a paid image pass. Storyboard frames are
 * distributed through the story rather than spending the whole allowance on
 * the opening seconds.
 */
export function visualMatterAssetRequests(
  manifest: VisualMatterManifest,
  maxImages: number,
): VisualMatterAssetRequest[] {
  if (manifest.status === "disabled") return [];
  const limit = boundedInteger(maxImages, 8, 1, 12);
  const requests: VisualMatterAssetRequest[] = [
    {
      id: manifest.moodBoard.id,
      kind: "mood_board",
      label: "Mood board",
      prompt: manifest.moodBoard.visualPrompt,
    },
    // A character sheet is a TURNAROUND, not a portrait.
    //
    // This asked for a single view, which is what a portrait is: it shows the
    // renderer one angle of a face and leaves every other angle to invention,
    // so the same character drifts between shots. Real character sheets exist
    // precisely to solve that, and the fix costs nothing — one image either
    // way, except that the model now draws the SAME person three times inside
    // one frame instead of three independent generations agreeing by luck.
    //
    // The style prompt still leads, so a watercolour channel gets a watercolour
    // turnaround. This adds layout, never look.
    ...manifest.characters.map((character) => ({
      id: character.id,
      kind: "character_sheet" as const,
      label: `Character sheet · ${character.name}`,
      prompt: [
        character.stylePrompt,
        "Lay this out as a model-sheet TURNAROUND: the same character drawn three times " +
        "side by side in one frame — front view, three-quarter view, and profile — at " +
        "identical scale and height, evenly spaced, all facing the same lighting.",
        "Plain neutral background, full figure in every view, no props or scenery.",
        "Keep face, hair, build, wardrobe and every distinctive marking identical across " +
        "all three views; they are one person seen from three angles, not three people.",
      ].join(" "),
    })),
    ...manifest.settings.map((setting) => ({
      id: setting.id,
      kind: "setting_sheet" as const,
      label: `Setting sheet · ${setting.name}`,
      prompt: setting.stylePrompt,
    })),
  ];
  const fixed = requests.slice(0, limit);
  const remaining = Math.max(0, limit - fixed.length);
  const storyboard = evenlyPick(manifest.storyboard, remaining).map((frame) => ({
    id: `storyboard:${frame.shotId}`,
    kind: "storyboard_frame" as const,
    label: `Storyboard frame · ${frame.shotId}`,
    shotId: frame.shotId,
    prompt: clipped(
      `Create the locked storyboard keyframe for ${frame.shotId}. ${frame.promptAddendum} ` +
      `Compose it as a single cinematic production reference, not an infographic or collage. ` +
      `No typography, labels, captions, logos, or watermarks.`,
    ),
  }));
  return [...fixed, ...storyboard];
}

/** Attach immutable provider/R2 receipts after an explicit reference-image pass. */
export function attachVisualMatterReferenceAssets(
  manifest: VisualMatterManifest,
  assets: readonly VisualMatterReferenceAsset[],
): VisualMatterManifest {
  if (manifest.status === "disabled") {
    throw new Error("cannot attach reference assets to disabled Visual Matter");
  }
  if (manifest.status === "anchored") {
    throw new Error("Visual Matter reference assets are immutable once anchored");
  }
  if (!assets.length) return manifest;

  // This is the adapter boundary: it accepts only requests that the plan
  // actually issued, with their unmodified prompt and shot association. A
  // future provider cannot smuggle an arbitrary image into a story merely by
  // naming it a mood board or character sheet.
  const expectedById = new Map(
    visualMatterAssetRequests(manifest, 12).map((request) => [request.id, request]),
  );
  const unique = new Map<string, VisualMatterReferenceAsset>();
  for (const asset of assets) {
    if (unique.has(asset.id)) throw new Error(`visual matter reference asset '${asset.id}' was generated twice`);
    const parsed = VisualMatterReferenceAssetSchema.parse(asset);
    const expected = expectedById.get(parsed.id);
    if (!expected) {
      throw new Error(`visual matter reference asset '${parsed.id}' was not requested by the source plan`);
    }
    if (
      parsed.kind !== expected.kind ||
      parsed.label !== expected.label ||
      parsed.prompt !== expected.prompt ||
      parsed.shotId !== expected.shotId
    ) {
      throw new Error(`visual matter reference asset '${parsed.id}' does not match its planned request`);
    }
    if (parsed.sourceManifestRevision !== manifest.revision) {
      throw new Error(`visual matter reference asset '${parsed.id}' belongs to a different source plan`);
    }
    const expectedFingerprint = visualMatterAssetRequestFingerprint(manifest.revision, expected);
    if (parsed.requestFingerprint !== expectedFingerprint) {
      throw new Error(`visual matter reference asset '${parsed.id}' has an invalid request fingerprint`);
    }
    unique.set(parsed.id, parsed);
  }
  const referenceAssets = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
  const anchored = {
    ...manifest,
    status: "anchored" as const,
    referenceAssets,
  };
  return VisualMatterManifestSchema.parse({
    ...anchored,
    storyboard: manifest.storyboard.map((frame) => {
      const storyboardAssetId = `storyboard:${frame.shotId}`;
      return unique.has(storyboardAssetId) && !frame.referenceAssetIds.includes(storyboardAssetId)
        ? { ...frame, referenceAssetIds: [...frame.referenceAssetIds, storyboardAssetId] }
        : frame;
    }),
    referencePackFingerprint: visualMatterReferencePackFingerprint(anchored),
  });
}

export function visualMatterFromUnknown(value: unknown): VisualMatterManifest | undefined {
  const parsed = VisualMatterManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Compile a small, shot-specific handoff instead of dumping the whole bible into every prompt. */
export function visualMatterDirectiveForShot(
  manifest: VisualMatterManifest | undefined,
  shotId: string,
): VisualMatterShotDirective | undefined {
  if (!manifest || manifest.status === "disabled") return undefined;
  const frame = manifest.storyboard.find((candidate) => candidate.shotId === shotId);
  if (!frame) return undefined;
  const byId = new Map(manifest.referenceAssets.map((asset) => [asset.id, asset]));
  const referenceAssetLabels = frame.referenceAssetIds
    .map((id) => byId.get(id)?.label)
    .filter((label): label is string => Boolean(label));
  return {
    renderPrompt: clipped(
      `${frame.promptAddendum} ${referenceAssetLabels.length ? `Reference package available: ${referenceAssetLabels.join("; ")}.` : ""}`,
    ),
    motionPrompt: frame.motionAddendum,
    qaCriteria: frame.acceptanceCriteria.join(" | "),
    referenceAssetLabels,
  };
}

/** Actual reference pixels available for a shot's visual QA comparison. */
export function visualMatterReferenceAssetsForShot(
  manifest: VisualMatterManifest | undefined,
  shotId: string,
): VisualMatterReferenceAsset[] {
  if (!manifest || manifest.status !== "anchored") return [];
  const frame = manifest.storyboard.find((candidate) => candidate.shotId === shotId);
  if (!frame) return [];
  const byId = new Map(manifest.referenceAssets.map((asset) => [asset.id, asset]));
  return frame.referenceAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is VisualMatterReferenceAsset => Boolean(asset))
    .sort((left, right) => {
      const leftPriority = left.shotId === shotId ? 0 : left.kind === "character_sheet" ? 1 : left.kind === "setting_sheet" ? 2 : 3;
      const rightPriority = right.shotId === shotId ? 0 : right.kind === "character_sheet" ? 1 : right.kind === "setting_sheet" ? 2 : 3;
      return leftPriority - rightPriority || left.id.localeCompare(right.id);
    });
}

export function visualMatterReviewLocks(value: VisualMatterManifest | unknown | undefined): z.infer<typeof VisualMatterReviewLockSchema>[] {
  const manifest = value && typeof value === "object" && "version" in value
    ? visualMatterFromUnknown(value)
    : undefined;
  return manifest?.status === "disabled" ? [] : manifest?.reviewLocks ?? [];
}
