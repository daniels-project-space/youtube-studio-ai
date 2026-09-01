import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CHANNEL_MUSIC_PROGRAM_VERSION = "channel-music-program/v1" as const;

export const ChannelMusicRoleSchema = z.enum([
  "primary_music",
  "narration_bed",
  "meditation_bed",
  "short_form_bed",
]);
export type ChannelMusicRole = z.infer<typeof ChannelMusicRoleSchema>;

export const ChannelMusicProviderSchema = z.enum([
  "minimax_music3",
  "suno",
  "mureka",
]);
export type ChannelMusicProvider = z.infer<typeof ChannelMusicProviderSchema>;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

const MusicSectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  label: boundedText(80),
  startFraction: z.number().min(0).max(1),
  endFraction: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
  instruction: boundedText(600),
}).strict().superRefine((section, issue) => {
  if (section.endFraction <= section.startFraction) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music section must end after it starts" });
  }
});

const ChannelMusicProgramBodyBaseSchema = z.object({
  version: z.literal(CHANNEL_MUSIC_PROGRAM_VERSION),
  channelId: boundedText(320),
  channelIdentityFingerprint: FingerprintSchema,
  family: boundedText(120),
  contentLaneKey: boundedText(120),
  topic: boundedText(320),
  role: ChannelMusicRoleSchema,
  identity: z.object({
    genre: boundedText(160),
    instrumentation: z.array(boundedText(120)).min(1).max(12),
    textures: z.array(boundedText(120)).max(8),
    bpmRange: z.tuple([z.number().int().min(30).max(300), z.number().int().min(30).max(300)]),
    moodArc: boundedText(600),
    exclusions: z.array(boundedText(160)).min(1).max(20),
  }).strict(),
  generation: z.object({
    providerPreference: ChannelMusicProviderSchema,
    durationSec: z.number().int().min(10).max(300),
    instrumental: z.literal(true),
    structuredCaption: boundedText(8_000),
    lyricsControl: boundedText(4_096),
    sections: z.array(MusicSectionSchema).min(4).max(8),
  }).strict(),
  mix: z.object({
    targetLufs: z.number().min(-23).max(-12),
    truePeakMaxDbtp: z.literal(-1),
    bodyMusicVol: z.number().min(0.01).max(1),
    narrationPriority: z.boolean(),
    transparentConstantGainOnly: z.literal(true),
    compressorProhibited: z.literal(true),
    limiterProhibited: z.literal(true),
  }).strict(),
  quality: z.object({
    minimumLraLu: z.number().min(1).max(20),
    minimumCrestDb: z.number().min(4).max(30),
    maximumConsecutiveCeilingSamples: z.number().int().min(1).max(12),
    maximumClippedSamples: z.literal(0),
    minimumEmotionalDepthScore: z.number().min(0.7).max(1),
    minimumArrangementDepthScore: z.number().min(0.7).max(1),
    sectionReviewRequired: z.literal(true),
    humanAuditionRequired: z.literal(true),
  }).strict(),
  minimaxLicense: z.object({
    uiAttribution: z.literal("MiniMax-Music3"),
    prominentCommercialAttributionRequired: z.literal(true),
    generatedContentDisclosureRequired: z.literal(true),
    safeguardsRequired: z.literal(true),
    separateAuthorizationAboveAnnualRevenueUsd: z.literal(20_000_000),
    operatorAttestationRequiredBeforeEnablement: z.literal(true),
  }).strict(),
}).strict();

type ChannelMusicProgramBody = z.infer<typeof ChannelMusicProgramBodyBaseSchema>;

function validateChannelMusicProgramBody(
  program: ChannelMusicProgramBody,
  issue: z.RefinementCtx,
): void {
  const [minimumBpm, maximumBpm] = program.identity.bpmRange;
  if (minimumBpm > maximumBpm) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music BPM range is inverted" });
  }
  const sections = program.generation.sections;
  if (sections[0]?.startFraction !== 0 || sections.at(-1)?.endFraction !== 1) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music sections must cover the full program from 0 to 1" });
  }
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index - 1]!.endFraction !== sections[index]!.startFraction) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "music sections must be gap-free and non-overlapping" });
    }
  }
  if (program.role === "primary_music" && program.mix.bodyMusicVol !== 1) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "primary music must remain music-forward at unity body gain" });
  }
  if (program.role !== "primary_music" && !program.mix.narrationPriority && program.role !== "meditation_bed") {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrated/short music beds must preserve narration priority" });
  }
}

function musicProgramFingerprint(body: ChannelMusicProgramBody): string {
  return sha256Hex(canonicalJson(body));
}

export const ChannelMusicProgramSchema = ChannelMusicProgramBodyBaseSchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((program, issue) => {
  const { fingerprint, ...body } = program;
  validateChannelMusicProgramBody(body, issue);
  if (fingerprint !== musicProgramFingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "channel music program fingerprint is invalid" });
  }
});

export type ChannelMusicProgram = z.infer<typeof ChannelMusicProgramSchema>;

export interface CreateChannelMusicProgramInput {
  readonly channelId: string;
  readonly channelIdentityFingerprint: string;
  readonly family: string;
  readonly contentLaneKey: string;
  readonly topic: string;
  readonly role?: ChannelMusicRole;
  readonly providerPreference?: ChannelMusicProvider;
  readonly durationSec?: number;
  readonly genre?: string;
  readonly instrumentation?: readonly string[];
  readonly textures?: readonly string[];
  readonly bpmRange?: readonly [number, number];
  readonly moodArc?: string;
  readonly composerDirection?: string;
  readonly targetLufs?: number;
  readonly bodyMusicVol?: number;
}

function cleanText(value: string | undefined, fallback: string, maximum: number): string {
  return (value?.replace(/\s+/gu, " ").trim() || fallback).slice(0, maximum).trim();
}

function unique(values: readonly string[] | undefined, fallback: readonly string[], maximum: number): string[] {
  const cleaned = [...new Set((values ?? fallback).map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))];
  return (cleaned.length ? cleaned : [...fallback]).slice(0, maximum);
}

export function musicRoleForRoute(family: string, contentLaneKey: string): ChannelMusicRole {
  const route = `${family} ${contentLaneKey}`.toLowerCase();
  if (/music[_ -]?loop|lofi|music[_ -]?video/u.test(route)) return "primary_music";
  if (/meditat|sleep|ambient[_ -]?guided|asmr/u.test(route)) return "meditation_bed";
  if (/short|quiz|trivia/u.test(route)) return "short_form_bed";
  return "narration_bed";
}

function roleSections(role: ChannelMusicRole, identity: {
  genre: string;
  instrumentation: readonly string[];
  moodArc: string;
}): Array<z.infer<typeof MusicSectionSchema>> {
  const instruments = identity.instrumentation.join(", ");
  const shared = `Keep the ${identity.genre} identity and the same acoustic space; use ${instruments}; no vocals or spoken words.`;
  if (role === "primary_music") {
    return [
      { id: "intro", label: "Intro", startFraction: 0, endFraction: 0.1, energy: 0.3, instruction: `Establish the motif with restraint. ${shared}` },
      { id: "theme", label: "Theme", startFraction: 0.1, endFraction: 0.3, energy: 0.5, instruction: `State a memorable lead motif and grounded groove. ${shared}` },
      { id: "deepen", label: "Deepen", startFraction: 0.3, endFraction: 0.52, energy: 0.64, instruction: `Add harmonic depth and one secondary texture without crowding the mix. ${shared}` },
      { id: "variation", label: "Variation", startFraction: 0.52, endFraction: 0.72, energy: 0.72, instruction: `Develop the motif through a real melodic or rhythmic variation; avoid merely adding volume. ${shared}` },
      { id: "return", label: "Return", startFraction: 0.72, endFraction: 0.9, energy: 0.58, instruction: `Return to the recognizable theme with warmer resolution and preserved dynamics. ${shared}` },
      { id: "outro", label: "Outro", startFraction: 0.9, endFraction: 1, energy: 0.3, instruction: `Resolve naturally toward the opening harmony so the later deterministic loop fold remains musical. ${shared}` },
    ];
  }
  if (role === "meditation_bed") {
    return [
      { id: "arrival", label: "Arrival", startFraction: 0, endFraction: 0.16, energy: 0.18, instruction: `Enter without a transient shock; establish safety and space. ${shared}` },
      { id: "settle", label: "Settle", startFraction: 0.16, endFraction: 0.48, energy: 0.22, instruction: `Hold a slow stable pulse with organic micro-variation and no attention-grabbing lead. ${shared}` },
      { id: "breathe", label: "Breathe", startFraction: 0.48, endFraction: 0.78, energy: 0.26, instruction: `Open the harmony slightly while keeping the texture soft and physically spacious. ${shared}` },
      { id: "release", label: "Release", startFraction: 0.78, endFraction: 1, energy: 0.16, instruction: `Reduce density gradually; end gently without a hard cadence or abrupt fade. ${shared}` },
    ];
  }
  if (role === "short_form_bed") {
    return [
      { id: "hook", label: "Hook", startFraction: 0, endFraction: 0.18, energy: 0.62, instruction: `Open immediately with a clean recognizable motif, never a generic impact hit. ${shared}` },
      { id: "drive", label: "Drive", startFraction: 0.18, endFraction: 0.5, energy: 0.68, instruction: `Support fast information rhythm while leaving the speech band clear. ${shared}` },
      { id: "turn", label: "Turn", startFraction: 0.5, endFraction: 0.78, energy: 0.76, instruction: `Mark the reveal with harmonic motion rather than a hollow riser. ${shared}` },
      { id: "button", label: "Button", startFraction: 0.78, endFraction: 1, energy: 0.58, instruction: `Land a concise musical resolution that does not mask the final spoken line. ${shared}` },
    ];
  }
  return [
    { id: "cold-open", label: "Cold open", startFraction: 0, endFraction: 0.12, energy: 0.28, instruction: `Create quiet intrigue under the hook; keep the speech band open. ${shared}` },
    { id: "exposition", label: "Exposition", startFraction: 0.12, endFraction: 0.42, energy: 0.22, instruction: `Stay calm and sparse while the story establishes context. ${shared}` },
    { id: "complication", label: "Complication", startFraction: 0.42, endFraction: 0.65, energy: 0.36, instruction: `Increase harmonic tension and pulse subtly without becoming trailer music. ${shared}` },
    { id: "resolution", label: "Resolution", startFraction: 0.65, endFraction: 0.88, energy: 0.3, instruction: `Release tension with warmer harmony while maintaining continuity under narration. ${shared}` },
    { id: "tail", label: "Tail", startFraction: 0.88, endFraction: 1, energy: 0.18, instruction: `Thin the arrangement and resolve gently beneath the closing thought. ${shared}` },
  ];
}

function structuredCaption(input: {
  topic: string;
  role: ChannelMusicRole;
  genre: string;
  instrumentation: readonly string[];
  textures: readonly string[];
  bpmRange: readonly [number, number];
  moodArc: string;
  composerDirection: string;
  sections: readonly z.infer<typeof MusicSectionSchema>[];
  exclusions: readonly string[];
}): string {
  const roleLanguage: Record<ChannelMusicRole, string> = {
    primary_music: "music-forward original instrumental for focused repeated listening",
    narration_bed: "restrained cinematic underscore that supports speech without dictating emotion",
    meditation_bed: "stable meditative bed with organic micro-variation and no startling events",
    short_form_bed: "compact information-forward underscore with an immediate motif and clean final button",
  };
  return [
    "### Global Metadata",
    `${input.genre}; ${input.bpmRange[0]}–${input.bpmRange[1]} BPM; ${roleLanguage[input.role]}. ` +
      `The episode subject is “${input.topic}”. Emotional progression: ${input.moodArc}. ` +
      `Production is dimensional, warm, dynamically alive, and spatially coherent—not a flat preset stack. ` +
      `Additional composer direction: ${input.composerDirection}`,
    "",
    "### Vocal Details",
    `Instrumental only: no lead vocal, backing vocal, chant, spoken word, whisper, or lyric. ` +
      `The melodic lead belongs to ${input.instrumentation[0]}; supporting timbres are ${input.instrumentation.slice(1).join(", ") || "restrained harmonic texture"}.`,
    "",
    "### Arrangement",
    input.sections.map((section) =>
      `${section.label} (${Math.round(section.startFraction * 100)}–${Math.round(section.endFraction * 100)}%, energy ${section.energy.toFixed(2)}): ${section.instruction}`,
    ).join("\n"),
    `Texture and space: ${input.textures.join(", ") || "natural room depth"}. ` +
      `Hard exclusions: ${input.exclusions.join("; ")}. Preserve musical causality: every entrance, change, and exit must be audible and motivated.`,
  ].join("\n");
}

export function createChannelMusicProgram(input: CreateChannelMusicProgramInput): ChannelMusicProgram {
  const role = input.role ?? musicRoleForRoute(input.family, input.contentLaneKey);
  const genre = cleanText(input.genre, role === "primary_music" ? "warm lo-fi instrumental" : "restrained cinematic ambient", 160);
  const instrumentation = unique(input.instrumentation, ["felt piano", "soft bass", "restrained percussion"], 12);
  const textures = unique(input.textures, ["natural room depth", "subtle tape warmth"], 8);
  const rawBpm = input.bpmRange ?? (role === "meditation_bed" ? [48, 64] : role === "short_form_bed" ? [88, 112] : [64, 84]);
  const bpmRange: [number, number] = [
    Math.max(30, Math.min(300, Math.floor(rawBpm[0]))),
    Math.max(30, Math.min(300, Math.floor(rawBpm[1]))),
  ];
  const moodArc = cleanText(
    input.moodArc,
    role === "narration_bed"
      ? "quiet intrigue develops into restrained tension, then resolves with earned warmth"
      : "a recognizable motif deepens through real variation and returns with warmer resolution",
    600,
  );
  const composerDirection = cleanText(
    input.composerDirection,
    "Give every section a musical job; preserve depth, groove, melodic purpose, and dynamic breathing room.",
    600,
  );
  const exclusions = [
    "vocals or intelligible words",
    "hollow preset-only arrangement",
    "mechanical or broadband artifacts",
    "brick-wall compression or limiter pumping",
    "flat dynamics with no section development",
    "abrupt key, tempo, or acoustic-space changes",
    "generic trailer booms and risers",
    "melody that masks narration",
  ];
  const sections = roleSections(role, { genre, instrumentation, moodArc });
  const targetLufs = Math.max(-23, Math.min(-12, input.targetLufs ?? (role === "primary_music" ? -16 : -18)));
  const bodyMusicVol = role === "primary_music"
    ? 1
    : Math.max(0.01, Math.min(1, input.bodyMusicVol ?? (role === "meditation_bed" ? 0.25 : 0.1026)));
  const durationSec = Math.max(10, Math.min(300, Math.floor(input.durationSec ?? (role === "short_form_bed" ? 60 : 120))));
  const body: ChannelMusicProgramBody = {
    version: CHANNEL_MUSIC_PROGRAM_VERSION,
    channelId: input.channelId,
    channelIdentityFingerprint: input.channelIdentityFingerprint,
    family: input.family,
    contentLaneKey: input.contentLaneKey,
    topic: input.topic,
    role,
    identity: { genre, instrumentation, textures, bpmRange, moodArc, exclusions },
    generation: {
      providerPreference: input.providerPreference ?? "minimax_music3",
      durationSec,
      instrumental: true,
      structuredCaption: structuredCaption({
        topic: input.topic,
        role,
        genre,
        instrumentation,
        textures,
        bpmRange,
        moodArc,
        composerDirection,
        sections,
        exclusions,
      }),
      lyricsControl: sections.map((section) => `[${section.label} - ${section.instruction}]`).join("\n"),
      sections,
    },
    mix: {
      targetLufs,
      truePeakMaxDbtp: -1,
      bodyMusicVol,
      narrationPriority: role === "narration_bed" || role === "short_form_bed",
      transparentConstantGainOnly: true,
      compressorProhibited: true,
      limiterProhibited: true,
    },
    quality: {
      minimumLraLu: role === "primary_music" ? 3 : role === "meditation_bed" ? 2 : 1.5,
      minimumCrestDb: role === "primary_music" ? 8 : 7,
      maximumConsecutiveCeilingSamples: 3,
      maximumClippedSamples: 0,
      minimumEmotionalDepthScore: 0.8,
      minimumArrangementDepthScore: 0.8,
      sectionReviewRequired: true,
      humanAuditionRequired: true,
    },
    minimaxLicense: {
      uiAttribution: "MiniMax-Music3",
      prominentCommercialAttributionRequired: true,
      generatedContentDisclosureRequired: true,
      safeguardsRequired: true,
      separateAuthorizationAboveAnnualRevenueUsd: 20_000_000,
      operatorAttestationRequiredBeforeEnablement: true,
    },
  };
  return Object.freeze(ChannelMusicProgramSchema.parse({
    ...body,
    fingerprint: musicProgramFingerprint(body),
  }));
}

export const MusicProgramQualityReceiptBodySchema = z.object({
  version: z.literal("music-program-quality/v1"),
  programFingerprint: FingerprintSchema,
  output: z.object({
    contentSha256: FingerprintSchema,
    byteLength: z.number().int().positive(),
    durationSec: z.number().positive(),
    sampleRate: z.number().int().min(16_000).max(192_000),
    channels: z.literal(2),
    codec: z.enum(["pcm_s16le", "pcm_f32le", "flac"]),
  }).strict(),
  measurements: z.object({
    integratedLufs: z.number().min(-60).max(0),
    truePeakDbtp: z.number().min(-100).max(3),
    lraLu: z.number().min(0).max(60),
    crestDb: z.number().min(0).max(60),
    clippedSamples: z.number().int().nonnegative(),
    maximumConsecutiveCeilingSamples: z.number().int().nonnegative(),
    dcOffsetAbsolute: z.number().min(0).max(1),
    silenceFraction: z.number().min(0).max(1),
    mechanicalArtifactScore: z.number().min(0).max(1),
  }).strict(),
  sectionReviews: z.array(z.object({
    sectionId: boundedText(80),
    score: z.number().min(0).max(1),
    evidence: boundedText(600),
  }).strict()).min(4).max(8),
  audition: z.object({
    reviewerId: boundedText(320),
    reviewReceiptFingerprint: FingerprintSchema,
    emotionalDepthScore: z.number().min(0).max(1),
    arrangementDepthScore: z.number().min(0).max(1),
    hollowOrGeneric: z.boolean(),
    verdict: z.enum(["pass", "fail"]),
    notes: boundedText(1_600),
  }).strict(),
}).strict();

function musicQualityReceiptFingerprint(
  body: z.infer<typeof MusicProgramQualityReceiptBodySchema>,
): string {
  return sha256Hex(canonicalJson(body));
}

export const MusicProgramQualityReceiptSchema = MusicProgramQualityReceiptBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((receipt, issue) => {
  const { fingerprint, ...body } = receipt;
  if (fingerprint !== musicQualityReceiptFingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music quality receipt fingerprint is invalid" });
  }
});

export type MusicProgramQualityReceipt = z.infer<typeof MusicProgramQualityReceiptSchema>;

export function createMusicProgramQualityReceipt(input: {
  readonly program: unknown;
  readonly output: unknown;
  readonly measurements: unknown;
  readonly sectionReviews: readonly unknown[];
  readonly audition: unknown;
}): MusicProgramQualityReceipt {
  const program = ChannelMusicProgramSchema.parse(input.program);
  const output = MusicProgramQualityReceiptBodySchema.shape.output.parse(input.output);
  const measurements = MusicProgramQualityReceiptBodySchema.shape.measurements.parse(input.measurements);
  const sectionReviews = MusicProgramQualityReceiptBodySchema.shape.sectionReviews.parse(input.sectionReviews);
  const audition = MusicProgramQualityReceiptBodySchema.shape.audition.parse(input.audition);
  const expectedSections = program.generation.sections.map((section) => section.id);
  const reviewedSections = sectionReviews.map((section) => section.sectionId);
  if (reviewedSections.join("|") !== expectedSections.join("|")) {
    throw new Error("music quality receipt must review every sealed section exactly once and in order");
  }
  const failures = [
    Math.abs(measurements.integratedLufs - program.mix.targetLufs) > 2
      ? "integrated loudness is outside the transparent ±2 LU window"
      : "",
    measurements.truePeakDbtp > program.mix.truePeakMaxDbtp
      ? "true peak exceeds the sealed ceiling"
      : "",
    measurements.lraLu < program.quality.minimumLraLu
      ? "loudness range is below the role-specific floor"
      : "",
    measurements.crestDb < program.quality.minimumCrestDb
      ? "crest factor is below the role-specific floor"
      : "",
    measurements.clippedSamples > program.quality.maximumClippedSamples
      ? "the master contains clipped samples"
      : "",
    measurements.maximumConsecutiveCeilingSamples > program.quality.maximumConsecutiveCeilingSamples
      ? "the master contains a flat-topped ceiling run"
      : "",
    measurements.dcOffsetAbsolute > 0.02 ? "DC offset is above the release ceiling" : "",
    measurements.silenceFraction > 0.08 ? "the master contains too much digital silence" : "",
    measurements.mechanicalArtifactScore > 0.15 ? "mechanical/broadband artifact score is too high" : "",
    sectionReviews.some((section) => section.score < 0.75) ? "at least one musical section failed review" : "",
    audition.emotionalDepthScore < program.quality.minimumEmotionalDepthScore
      ? "human audition found insufficient emotional depth"
      : "",
    audition.arrangementDepthScore < program.quality.minimumArrangementDepthScore
      ? "human audition found insufficient arrangement depth"
      : "",
    audition.hollowOrGeneric ? "human audition found the result hollow or generic" : "",
    audition.verdict !== "pass" ? "human audition did not pass" : "",
  ].filter(Boolean);
  if (failures.length) throw new Error(`music quality failed: ${failures.join("; ")}`);
  const body: z.infer<typeof MusicProgramQualityReceiptBodySchema> = {
    version: "music-program-quality/v1",
    programFingerprint: program.fingerprint,
    output,
    measurements,
    sectionReviews,
    audition,
  };
  return Object.freeze(MusicProgramQualityReceiptSchema.parse({
    ...body,
    fingerprint: musicQualityReceiptFingerprint(body),
  }));
}
