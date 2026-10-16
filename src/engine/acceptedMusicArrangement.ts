import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const ACCEPTED_MUSIC_ARRANGEMENT_VERSION = "accepted-music-arrangement/v1" as const;

function nonblankText(maximum?: number) {
  const text = maximum === undefined ? z.string() : z.string().max(maximum);
  return text.refine((value) => value.trim().length > 0, "text must not be blank");
}
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const fraction = z.number().finite().min(0).max(1);
export const MusicSymbolicScorePolicySchema = z.literal("instrumental");
export const MusicSymbolicScoreSchema = z.string().min(1).max(32000).refine(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 32000,
  "symbolic score must be nonblank and at most 32000 UTF-8 bytes",
);

const MusicReviewContextBodySchema = z.object({
  version: z.literal("music-review-context/v1"),
  topic: nonblankText(), family: nonblankText(120), channelName: z.string().max(500).nullable(),
  promptContext: nonblankText(65_536),
}).strict();

export const MusicReviewContextSchema = MusicReviewContextBodySchema.extend({ fingerprint }).strict()
  .superRefine((context, issue) => {
    const { fingerprint: supplied, ...body } = context;
    if (supplied !== sha256Hex(canonicalJson(body))) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["fingerprint"], message: "music review context fingerprint mismatch" });
    }
  });

export function createMusicReviewContext(input: Omit<z.infer<typeof MusicReviewContextBodySchema>, "version">) {
  const body = MusicReviewContextBodySchema.parse({ version: "music-review-context/v1", ...input });
  return MusicReviewContextSchema.parse({ ...body, fingerprint: sha256Hex(canonicalJson(body)) });
}

export const AcceptedMusicArrangementSectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  label: nonblankText(80),
  startFraction: fraction,
  endFraction: fraction,
  energy: fraction,
  instruction: nonblankText(600),
}).strict().superRefine((section, issue) => {
  if (section.endFraction <= section.startFraction) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["endFraction"], message: "section must end after it starts" });
  }
});
export type AcceptedMusicArrangementSection = z.infer<typeof AcceptedMusicArrangementSectionSchema>;

const MusicGroundingDecisionSchema = z.object({
  dimension: z.enum(["instrumentation", "register", "texture", "harmony", "rhythm", "dynamics", "articulation", "space", "development"]),
  choice: nonblankText(240).refine((value) => value.trim().length >= 20, "musical choice must be specific"),
}).strict();
const MusicGroundingEntrySchema = z.object({
  source: z.enum(["channel_persona", "style_grammar", "show_bible", "audio_identity", "episode_topic"]),
  cue: nonblankText(240).refine((value) => value.trim().length >= 8, "grounding cue must identify a concrete source detail"),
  decisions: z.array(MusicGroundingDecisionSchema).min(2).max(4),
  sectionIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u)).min(1).max(8),
}).strict().superRefine((entry, issue) => {
  const dimensions = entry.decisions.map((decision) => decision.dimension);
  if (new Set(dimensions).size !== dimensions.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions"], message: "grounding decisions must cover distinct musical dimensions" });
  }
  if (new Set(entry.sectionIds).size !== entry.sectionIds.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["sectionIds"], message: "grounding section ids must be unique" });
  }
});
export const MusicChannelGroundingSchema = z.array(MusicGroundingEntrySchema).min(2).max(5).superRefine((entries, issue) => {
  const sources = new Set(entries.map((entry) => entry.source));
  if (!sources.has("episode_topic") || !entries.some((entry) => entry.source !== "episode_topic")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "grounding must connect both a channel identity and the episode topic to music choices" });
  }
  const cues = entries.map((entry) => `${entry.source}:${entry.cue.trim().toLocaleLowerCase()}`);
  if (new Set(cues).size !== cues.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "grounding cues must be distinct" });
  }
});

const arrangementControls = {
  role: z.enum(["primary_music", "narration_bed", "meditation_bed", "sleep_sound_bed", "short_form_bed"]),
  tempoMode: z.enum(["metered", "unmetered"]).optional(),
  requestedDurationSec: z.number().finite().int().min(10).max(300),
  form: z.enum(["continuous", "through_composed", "sectional"]),
  ending: z.enum(["seamless_wrap", "natural_cadence"]),
  playback: z.enum(["repeat", "once"]),
} as const;

/** Explicit caller constraints, not defaults inferred from the channel family. */
export const MusicArrangementIntentSchema = z.object(arrangementControls).partial().strict().superRefine((intent, issue) => {
  for (const [key, value] of Object.entries(intent)) {
    if (value === undefined) issue.addIssue({ code: z.ZodIssueCode.custom, path: [key],
      message: "omit unspecified music intent fields instead of supplying undefined" });
  }
});
export type MusicArrangementIntent = z.infer<typeof MusicArrangementIntentSchema>;

export const AcceptedMusicArrangementDraftSchema = z.object({
  ...arrangementControls,
  direction: nonblankText(8_000),
  sections: z.array(AcceptedMusicArrangementSectionSchema).min(4).max(8),
}).strict().superRefine((draft, issue) => {
  if (draft.tempoMode === "unmetered" && draft.role !== "meditation_bed" && draft.role !== "sleep_sound_bed") {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["tempoMode"],
      message: "unmetered arrangements are only supported for meditation and sleep roles" });
  }
  if (draft.role === "sleep_sound_bed" && draft.tempoMode === "metered") {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["tempoMode"],
      message: "sleep arrangements must be unmetered" });
  }
  const sections = draft.sections;
  if (sections[0]?.startFraction !== 0 || sections.at(-1)?.endFraction !== 1) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: "sections must cover the full program from 0 to 1" });
  }
  const ids = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (ids.has(section.id)) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "id"], message: "section ids must be unique" });
    }
    ids.add(section.id);
    if (index > 0 && sections[index - 1]!.endFraction !== section.startFraction) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "startFraction"], message: "sections must be gap-free and non-overlapping in supplied order" });
    }
  }
});
export type AcceptedMusicArrangementDraft = z.infer<typeof AcceptedMusicArrangementDraftSchema>;

export function refineMusicArrangementIntent(
  value: { arrangement: AcceptedMusicArrangementDraft; musicIntent?: MusicArrangementIntent },
  issue: z.RefinementCtx,
): void {
  for (const [key, expected] of Object.entries(value.musicIntent ?? {})) {
    if (expected !== undefined && value.arrangement[key as keyof MusicArrangementIntent] !== expected) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["arrangement", key],
        message: `arrangement ${key} conflicts with explicit music intent` });
    }
  }
}

const AcceptedMusicArrangementBodySchema = z.object({
  version: z.literal(ACCEPTED_MUSIC_ARRANGEMENT_VERSION),
  ownerId: nonblankText(),
  channelId: nonblankText(),
  runId: nonblankText(),
  topic: nonblankText(),
  sourceBriefFingerprint: fingerprint,
  arrangement: AcceptedMusicArrangementDraftSchema,
  musicIntent: MusicArrangementIntentSchema.optional(),
  reviewContext: MusicReviewContextSchema.optional(),
  channelGrounding: MusicChannelGroundingSchema.optional(),
  symbolicScore: MusicSymbolicScoreSchema.optional(),
  symbolicScorePolicy: MusicSymbolicScorePolicySchema.optional(),
}).strict();

export const AcceptedMusicArrangementSchema = AcceptedMusicArrangementBodySchema.extend({
  fingerprint,
}).strict().superRefine((artifact, issue) => {
  refineMusicArrangementIntent(artifact, issue);
  if (artifact.symbolicScorePolicy && !artifact.symbolicScore) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["symbolicScorePolicy"], message: "score policy requires a symbolic score" });
  }
  if (artifact.reviewContext && artifact.reviewContext.topic !== artifact.topic) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewContext"], message: "music review context belongs to another topic" });
  }
  if (artifact.channelGrounding) {
    if (!artifact.reviewContext) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["channelGrounding"], message: "grounding requires retained review context" });
    } else {
      const promptContext = artifact.reviewContext.promptContext.toLocaleLowerCase();
      const sections = new Set(artifact.arrangement.sections.map((section) => section.id));
      const covered = new Set<string>();
      for (const [index, entry] of artifact.channelGrounding.entries()) {
        if (!promptContext.includes(entry.cue.trim().toLocaleLowerCase()) ||
          (entry.source === "episode_topic" && entry.cue.trim() !== artifact.topic)) {
          issue.addIssue({ code: z.ZodIssueCode.custom, path: ["channelGrounding", index, "cue"],
            message: "grounding cue must match its frozen channel or episode context" });
        }
        for (const id of entry.sectionIds) {
          if (!sections.has(id)) issue.addIssue({ code: z.ZodIssueCode.custom, path: ["channelGrounding", index, "sectionIds"],
            message: "grounding decision references an unknown arrangement section" });
          covered.add(id);
        }
      }
      if ([...sections].some((id) => !covered.has(id))) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["channelGrounding"],
          message: "every arrangement section must be tied to at least one grounded musical choice" });
      }
    }
  }
  const { fingerprint: suppliedFingerprint, ...body } = artifact;
  if (suppliedFingerprint !== sha256Hex(canonicalJson(body))) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ["fingerprint"], message: "accepted music arrangement fingerprint does not bind its content" });
  }
});
export type AcceptedMusicArrangement = z.infer<typeof AcceptedMusicArrangementSchema>;

export function acceptedMusicArrangementForRun(
  value: unknown,
  expected: Pick<AcceptedMusicArrangement, "ownerId" | "channelId" | "runId" | "topic">,
): AcceptedMusicArrangement | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = AcceptedMusicArrangementSchema.safeParse(value);
  if (!parsed.success) throw new Error("accepted music arrangement receipt is malformed");
  const receipt = parsed.data;
  if (receipt.ownerId !== expected.ownerId || receipt.channelId !== expected.channelId ||
    receipt.runId !== expected.runId || receipt.topic !== expected.topic) {
    throw new Error("accepted music arrangement receipt does not match the current owner, channel, run and topic");
  }
  return receipt;
}

function sourceBriefFingerprint(value: unknown): string {
  const ancestors = new Set<object>();
  // canonicalJson can omit or coerce non-JSON values. Refuse those before
  // sealing provenance, including custom objects, accessors and sparse arrays.
  function assertJson(entry: unknown): void {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (typeof entry !== "object" || ancestors.has(entry)) {
      throw new Error("source brief must contain only acyclic JSON values");
    }
    const array = Array.isArray(entry);
    if (!array && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
      throw new Error("source brief JSON objects must be plain records");
    }
    ancestors.add(entry);
    const keys = Reflect.ownKeys(entry).filter((key) => !(array && key === "length"));
    if (array && (keys.length !== entry.length || keys.some((key, index) => key !== String(index)))) {
      throw new Error("source brief JSON arrays must be dense and have no extra properties");
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("source brief JSON records must have enumerable string data properties");
      }
      assertJson(descriptor.value);
    }
    ancestors.delete(entry);
  }
  assertJson(value);
  return sha256Hex(canonicalJson(value));
}

export function createAcceptedMusicArrangement(input: {
  ownerId: string;
  channelId: string;
  runId: string;
  topic: string;
  sourceBrief: unknown;
  arrangement: unknown;
}): AcceptedMusicArrangement {
  const briefFingerprint = sourceBriefFingerprint(input.sourceBrief);
  const reviewContext = input.sourceBrief !== null && typeof input.sourceBrief === "object" &&
    Object.hasOwn(input.sourceBrief, "reviewContext")
    ? MusicReviewContextSchema.parse((input.sourceBrief as Record<string, unknown>).reviewContext) : undefined;
  const musicIntent = input.sourceBrief !== null && typeof input.sourceBrief === "object" &&
    Object.hasOwn(input.sourceBrief, "musicIntent")
    ? MusicArrangementIntentSchema.parse((input.sourceBrief as Record<string, unknown>).musicIntent) : undefined;
  const symbolicScore = input.sourceBrief !== null && typeof input.sourceBrief === "object" &&
    Object.hasOwn(input.sourceBrief, "symbolicScore")
    ? MusicSymbolicScoreSchema.parse((input.sourceBrief as Record<string, unknown>).symbolicScore) : undefined;
  const channelGrounding = input.sourceBrief !== null && typeof input.sourceBrief === "object" &&
    Object.hasOwn(input.sourceBrief, "channelGrounding")
    ? MusicChannelGroundingSchema.parse((input.sourceBrief as Record<string, unknown>).channelGrounding) : undefined;
  const symbolicScorePolicy = input.sourceBrief !== null && typeof input.sourceBrief === "object" &&
    Object.hasOwn(input.sourceBrief, "symbolicScorePolicy")
    ? MusicSymbolicScorePolicySchema.parse((input.sourceBrief as Record<string, unknown>).symbolicScorePolicy) : undefined;
  const body = AcceptedMusicArrangementBodySchema.parse({
    version: ACCEPTED_MUSIC_ARRANGEMENT_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    topic: input.topic,
    sourceBriefFingerprint: briefFingerprint,
    arrangement: input.arrangement,
    ...(musicIntent ? { musicIntent } : {}),
    ...(reviewContext ? { reviewContext } : {}),
    ...(channelGrounding === undefined ? {} : { channelGrounding }),
    ...(symbolicScore === undefined ? {} : { symbolicScore }),
    ...(symbolicScorePolicy === undefined ? {} : { symbolicScorePolicy }),
  });
  return AcceptedMusicArrangementSchema.parse({ ...body, fingerprint: sha256Hex(canonicalJson(body)) });
}

export function projectAcceptedMusicArrangementToYuEStyle(value: unknown): string {
  const artifact = AcceptedMusicArrangementSchema.parse(value);
  const { arrangement } = artifact;
  const style = [
    `Role: ${arrangement.role}.`,
    `Requested duration: ${arrangement.requestedDurationSec} seconds.`,
    `Form: ${arrangement.form}.`,
    `Ending: ${arrangement.ending}.`,
    `Playback: ${arrangement.playback}.`,
    "Technical restriction: instrumental only; no vocals or lyrics.",
    "Direction:",
    arrangement.direction,
    "Sections (fractions of the requested duration):",
    ...arrangement.sections.flatMap((section) => [
      `Section ${section.id}: ${section.label}; startFraction ${section.startFraction}; endFraction ${section.endFraction}; energy ${section.energy}.`,
      section.instruction,
    ]),
    ...(artifact.channelGrounding ? ["Grounded channel and episode decisions:", ...artifact.channelGrounding.flatMap((entry) => [
      `Source ${entry.source}: ${entry.cue}. Apply to sections: ${entry.sectionIds.join(", ")}.`,
      ...entry.decisions.map((decision) => `${decision.dimension}: ${decision.choice}`),
    ])] : []),
  ].join("\n");
  if (new TextEncoder().encode(style).byteLength > 32_000) {
    throw new Error("accepted music arrangement YuE style exceeds 32000 UTF-8 bytes");
  }
  return style;
}
