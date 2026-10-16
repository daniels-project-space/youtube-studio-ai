import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { spreadDefault } from "@/lib/identitySpread";
import { sha256Hex } from "@/lib/sha256";

export const CHANNEL_MUSIC_PROGRAM_VERSION = "channel-music-program/v1" as const;
/** Exact maximum tolerated early high-band collapse in a retained Music3 WAV. */
export const MUSIC_PROGRAM_MAX_OPENING_HIGH_BAND_DROP_DB = 18;
/**
 * MiniMax's official Music3 prompting guidance recommends a concise structured
 * caption (roughly 250–450 words). The arrangement must be detailed enough to
 * create a real arc, but repeating the full channel identity in every section
 * turns a long form into a generic adjective stack instead of musical control.
 */
export const MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS = 450;
export const MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS = 250;

/**
 * Music3's caption guidance is a quality boundary, not presentation copy.
 * Count normalized whitespace so it matches the worker's actual prompt body.
 */
export function music3StructuredCaptionWordCount(caption: string): number {
  const normalized = caption.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export const ChannelMusicRoleSchema = z.enum([
  "primary_music",
  "narration_bed",
  "meditation_bed",
  "sleep_sound_bed",
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
const BpmRangeSchema = z.tuple([
  z.number().int().min(30).max(300),
  z.number().int().min(30).max(300),
]);

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
  channelIdentityPromptContract: z.literal("channel-identity-caption/v1").optional(),
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
    bpmRange: z.union([BpmRangeSchema, z.null()]),
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
  // Optional for legacy provider-neutral programs; new non-MiniMax programs
  // must not inherit MiniMax-only attribution and commercial terms.
  minimaxLicense: z.object({
    uiAttribution: z.literal("MiniMax-Music3"),
    prominentCommercialAttributionRequired: z.literal(true),
    generatedContentDisclosureRequired: z.literal(true),
    safeguardsRequired: z.literal(true),
    separateAuthorizationAboveAnnualRevenueUsd: z.literal(20_000_000),
    operatorAttestationRequiredBeforeEnablement: z.literal(true),
  }).strict().optional(),
}).strict();

type ChannelMusicProgramBody = z.infer<typeof ChannelMusicProgramBodyBaseSchema>;

function validateChannelMusicProgramBody(
  program: ChannelMusicProgramBody,
  issue: z.RefinementCtx,
): void {
  const routeOwnedRole = routeOwnedMusicRole(program.family, program.contentLaneKey);
  if (routeOwnedRole && program.role !== routeOwnedRole) {
    issue.addIssue({
      code: z.ZodIssueCode.custom,
      message: `music role ${program.role} conflicts with route-owned role ${routeOwnedRole}`,
    });
  }
  const bpmRange = program.identity.bpmRange;
  if (bpmRange && bpmRange[0] > bpmRange[1]) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "music BPM range is inverted" });
  }
  if (program.role !== "sleep_sound_bed" && bpmRange === null) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "metered music roles require an explicit BPM range" });
  }
  const rhythmicCue = sleepSoundRhythmicCue(program.role, program.identity.instrumentation);
  if (rhythmicCue) {
    issue.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identity", "instrumentation"],
      message: `sleep soundscape cannot use rhythmic instrumentation: ${rhythmicCue}`,
    });
  }
  const rhythmicGenre = sleepSoundRhythmicGenre(program.role, program.identity.genre);
  if (rhythmicGenre) {
    issue.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identity", "genre"],
      message: `sleep soundscape cannot use a rhythmic genre: ${rhythmicGenre}`,
    });
  }
  const sections = program.generation.sections;
  if (program.role === "sleep_sound_bed") {
    if (sections.some((section) => section.energy > 0.12) ||
        sections.some((section) => section.energy !== sections[0]?.energy)) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generation", "sections"],
        message: "sleep soundscape sections must maintain stable low arousal",
      });
    }
    const sleepDirection = [program.generation.structuredCaption, ...sections.map((section) => section.instruction)]
      .join(" ")
      .match(/\b(?:four[-\s]?on[-\s]?the[-\s]?floor|driving|strong|prominent|steady|insistent|pulsing)\s+(?:beat|pulse|groove|rhythm|drums?|percussion)\b|\b(?:boom[-\s]?bap|breakbeat|drum\s*(?:and|&)\s*bass)\b/iu)?.[0];
    if (sleepDirection) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generation", "structuredCaption"],
        message: `sleep soundscape cannot include rhythmic generation direction: ${sleepDirection}`,
      });
    }
  }
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
  if (program.role !== "primary_music" && !program.mix.narrationPriority &&
      program.role !== "meditation_bed" && program.role !== "sleep_sound_bed") {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrated/short music beds must preserve narration priority" });
  }
  if (program.channelIdentityPromptContract === "channel-identity-caption/v1") {
    const caption = program.generation.structuredCaption.toLocaleLowerCase("en-US");
    const declaredSoundCues = [
      program.topic,
      program.identity.genre,
      program.identity.moodArc,
      ...program.identity.instrumentation,
      ...program.identity.textures,
      ...program.identity.exclusions,
      ...(bpmRange && program.role !== "sleep_sound_bed"
        ? [bpmRange[0] === bpmRange[1] ? `${bpmRange[0]} BPM` : `${bpmRange[0]}–${bpmRange[1]} BPM`]
        : []),
    ];
    for (const cue of declaredSoundCues) {
      if (!caption.includes(cue.toLocaleLowerCase("en-US"))) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          message: `music structured caption omits declared channel sound cue: ${cue}`,
        });
      }
    }
  }
  if (program.generation.providerPreference === "minimax_music3") {
    if (!program.minimaxLicense) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "MiniMax-Music3 programs require the provider-specific license and attribution terms" });
    }
    const words = music3StructuredCaptionWordCount(program.generation.structuredCaption);
    if (words < MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS || words > MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: `MiniMax-Music3 structured caption must contain ${MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS}–${MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS} words; received ${words}`,
      });
    }
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

/** Channel-level sound contract, excluding per-video topic and channel identifiers. */
export function musicSoundProfileFingerprint(program: ChannelMusicProgram): string {
  return sha256Hex(canonicalJson({
    role: program.role,
    identity: program.identity,
    generation: {
      providerPreference: program.generation.providerPreference,
      durationSec: program.generation.durationSec,
      instrumental: program.generation.instrumental,
      lyricsControl: program.generation.lyricsControl,
      sections: program.generation.sections,
    },
    mix: program.mix,
    quality: program.quality,
  }));
}

export interface CreateChannelMusicProgramInput {
  readonly channelId: string;
  readonly channelIdentityFingerprint: string;
  readonly family?: string;
  readonly contentLaneKey?: string;
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

export interface PrimaryMusicFallbackProfile {
  readonly genre: string;
  readonly instrumentation: readonly string[];
  readonly textures: readonly string[];
  readonly moodArc: string;
  readonly prompt: string;
}

const LOFI_PRIMARY_MUSIC_PROFILES: readonly PrimaryMusicFallbackProfile[] = Object.freeze([
  Object.freeze({
    genre: "warm lo-fi instrumental",
    instrumentation: ["felt piano", "soft bass", "restrained brush percussion"],
    textures: ["natural room depth", "subtle tape warmth"],
    moodArc: "a recognizable motif deepens through real variation and returns with warmer resolution",
    prompt: "warm cozy lo-fi instrumental, mellow Rhodes piano, soft boom-bap drums, gentle bass, vinyl grain and tape warmth; calm, nostalgic, purely instrumental, loop-friendly",
  }),
  Object.freeze({
    genre: "nocturnal lo-fi instrumental",
    instrumentation: ["muted electric piano", "rounded sub-bass", "soft rim-click percussion"],
    textures: ["dim late-night room tone", "soft cassette haze"],
    moodArc: "a muted motif drifts through cool harmony, opens briefly, then settles into night",
    prompt: "nocturnal lo-fi instrumental, muted electric piano, rounded sub-bass and soft rim clicks; intimate room tone, restrained cassette haze, gentle harmonic drift and no dramatic drop",
  }),
  Object.freeze({
    genre: "sunlit lo-fi instrumental",
    instrumentation: ["soft Rhodes piano", "nylon-string guitar", "light brushed drums"],
    textures: ["open daylight room", "fine vinyl dust"],
    moodArc: "a light motif gains warmth through guitar replies, then returns to calm",
    prompt: "sunlit lo-fi instrumental, soft Rhodes piano, nylon-string guitar and light brushed drums; airy daylight room, fine vinyl dust, warm melodic replies and relaxed dynamics",
  }),
  Object.freeze({
    genre: "jazzy lo-fi instrumental",
    instrumentation: ["smoky jazz piano", "upright bass", "soft brush kit"],
    textures: ["close wooden resonance", "faint tape grain"],
    moodArc: "piano and bass trade phrases, open one harmony, then settle into a relaxed pocket",
    prompt: "jazzy lo-fi instrumental, smoky piano voicings, upright bass and soft brush kit; close wooden resonance, faint tape grain, understated call-and-response and a relaxed pocket",
  }),
]);

const PRIMARY_MUSIC_FALLBACK_PROFILES: readonly PrimaryMusicFallbackProfile[] = Object.freeze([
  Object.freeze({
    genre: "cinematic post-rock instrumental",
    instrumentation: ["electric piano", "bowed electric guitar", "restrained toms"],
    textures: ["wide natural room", "soft tape saturation"],
    moodArc: "a clear melodic motif grows through patient interplay, opens into a full but controlled lift, and returns with earned resolution",
    prompt: "cinematic post-rock instrumental with electric piano, bowed electric guitar and restrained toms; patient melodic development, spacious dynamics and an earned lift; full music-forward arrangement, no vocals",
  }),
  Object.freeze({
    genre: "organic acoustic instrumental",
    instrumentation: ["fingerstyle acoustic guitar", "upright bass", "soft hand percussion"],
    textures: ["close wooden resonance", "natural room air"],
    moodArc: "a memorable acoustic motif travels through warm rhythmic variation and settles into a natural, satisfying return",
    prompt: "organic acoustic instrumental led by fingerstyle guitar with upright bass and soft hand percussion; warm, rhythmic, melodic and fully arranged for attentive listening, no vocals",
  }),
  Object.freeze({
    genre: "deep analog electronic instrumental",
    instrumentation: ["analog synthesizer", "rounded electric bass", "restrained electronic percussion"],
    textures: ["dimensional analog space", "subtle modular movement"],
    moodArc: "a focused synth motif gains harmonic color and rhythmic depth, creates one meaningful contrast, then resolves without a generic drop",
    prompt: "deep analog electronic instrumental with a distinctive synth motif, rounded bass and restrained electronic percussion; evolving harmony, dimensional sound design and a deliberate contrast, no vocals or generic EDM drop",
  }),
  Object.freeze({
    genre: "modern chamber instrumental",
    instrumentation: ["cello", "felt piano", "muted frame drum"],
    textures: ["intimate chamber space", "soft bow detail"],
    moodArc: "an intimate chamber theme develops through conversational strings and piano, finds a measured pulse, and closes with quiet conviction",
    prompt: "modern chamber instrumental led by expressive cello and felt piano with a measured frame-drum pulse; intimate, melodic and dynamically alive, building through musical conversation rather than a preset loop, no vocals",
  }),
]);

export function primaryMusicFallbackProfile(input: {
  readonly family?: string;
  readonly contentLaneKey?: string;
  readonly channelIdentitySeed: string;
}): PrimaryMusicFallbackProfile {
  const family = input.family?.trim().toLowerCase() ?? "";
  const lane = input.contentLaneKey?.trim().toLowerCase() ?? "";
  if (family === "music_loop" && lane === "music_loop") {
    return spreadDefault(input.channelIdentitySeed, LOFI_PRIMARY_MUSIC_PROFILES);
  }
  return spreadDefault(input.channelIdentitySeed, PRIMARY_MUSIC_FALLBACK_PROFILES);
}

function cleanText(value: string | undefined, fallback: string, maximum: number): string {
  return (value?.replace(/\s+/gu, " ").trim() || fallback).slice(0, maximum).trim();
}

function unique(values: readonly string[] | undefined, fallback: readonly string[], maximum: number): string[] {
  const cleaned = [...new Set((values ?? fallback).map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))];
  return (cleaned.length ? cleaned : [...fallback]).slice(0, maximum);
}

export function musicRoleForRoute(family: string, contentLaneKey: string): ChannelMusicRole {
  const familyRoute = family.toLowerCase();
  const laneRoute = contentLaneKey.toLowerCase();
  const route = `${familyRoute} ${laneRoute}`;
  if (/sleep/u.test(route)) return "sleep_sound_bed";
  if (/meditat|ambient[_ -]?guided|asmr/u.test(route)) return "meditation_bed";
  if (/short|quiz|trivia/u.test(route)) return "short_form_bed";
  if (/music[_ -]?loop|lofi|music[_ -]?video/u.test(route)) return "primary_music";
  return "narration_bed";
}

function routeOwnedMusicRole(family: string, contentLaneKey: string): ChannelMusicRole | undefined {
  const familyRoute = family.trim().toLowerCase();
  const laneRoute = contentLaneKey.trim().toLowerCase();
  const role = musicRoleForRoute(familyRoute, laneRoute);
  if (
    role === "sleep_sound_bed" ||
    role === "meditation_bed" ||
    role === "short_form_bed" ||
    role === "primary_music"
  ) {
    return role;
  }
  return undefined;
}

function routeHasNarrationCue(family: string, contentLaneKey: string): boolean {
  const routeWords = `${family} ${contentLaneKey}`.toLowerCase().replace(/[_-]+/gu, " ");
  return /\b(?:guided|breathwork|spoken|narrated)\b/u.test(routeWords);
}

function roleSections(role: ChannelMusicRole, durationSec: number): Array<z.infer<typeof MusicSectionSchema>> {
  // Global Metadata and Vocal Details already establish genre, instruments,
  // space and the instrumental constraint. Repeating all of that inside every
  // Arrangement entry pushed long-form captions beyond Music3's useful prompt
  // range and diluted each section's distinct musical job.
  const shared = "Maintain identity.";
  if (role === "primary_music") {
    // Music3's longer tag map needs a matching arrangement map. Otherwise a
    // five-minute request repeats the short form as generic texture even while
    // the lyrics-control stream says more composition remains. Each extra
    // section below has a distinct musical job which the per-section audition
    // receipt must review independently.
    if (durationSec > 180) {
      return [
        { id: "intro", label: "Intro", startFraction: 0, endFraction: 0.07, energy: 0.3, instruction: `Introduce one two-bar lead motif, then leave a breath before the groove enters; make the opening harmony identifiable enough to return to. ${shared}` },
        { id: "theme", label: "Theme", startFraction: 0.07, endFraction: 0.19, energy: 0.5, instruction: `Restate that motif with a grounded groove and a low-register answer; use call-and-response rather than stacking every instrument at once. ${shared}` },
        { id: "deepen", label: "Deepen", startFraction: 0.19, endFraction: 0.33, energy: 0.64, instruction: `Keep the lead motif legible, change one chord colour, and introduce one quiet counterline only after the second phrase; create depth through interplay, not louder mastering. ${shared}` },
        { id: "variation", label: "Variation", startFraction: 0.33, endFraction: 0.47, energy: 0.72, instruction: `Turn the motif through a different rhythmic placement or answering phrase, then briefly remove one layer so the return has contrast; never substitute a generic riser. ${shared}` },
        { id: "contrast", label: "Contrast", startFraction: 0.47, endFraction: 0.58, energy: 0.42, instruction: `Create a genuine contrast passage by thinning the drum or bass relationship and letting one transformed motif fragment answer in open space; preserve the pulse without a dead loop. ${shared}` },
        { id: "rebuild", label: "Rebuild", startFraction: 0.58, endFraction: 0.72, energy: 0.76, instruction: `Reintroduce the groove one role at a time, add a fresh counter-rhythm, and let the transformed motif earn a late lift; avoid louder limiting or trailer-style escalation. ${shared}` },
        { id: "return", label: "Return", startFraction: 0.72, endFraction: 0.9, energy: 0.58, instruction: `Bring back the original motif in a warmer voicing with the same groove; the listener should recognize the return without a density spike. ${shared}` },
        { id: "outro", label: "Outro", startFraction: 0.9, endFraction: 1, energy: 0.3, instruction: `Strip back to the opening harmony and one final motif fragment, leaving a natural handoff so the later deterministic loop fold is musical. ${shared}` },
      ];
    }
    return [
      { id: "intro", label: "Intro", startFraction: 0, endFraction: 0.1, energy: 0.3, instruction: `Introduce one two-bar lead motif, then leave a breath before the groove enters; make the opening harmony identifiable enough to return to. ${shared}` },
      { id: "theme", label: "Theme", startFraction: 0.1, endFraction: 0.3, energy: 0.5, instruction: `Restate that motif with a grounded groove and a low-register answer; use call-and-response rather than stacking every instrument at once. ${shared}` },
      { id: "deepen", label: "Deepen", startFraction: 0.3, endFraction: 0.52, energy: 0.64, instruction: `Keep the lead motif legible, change one chord colour, and introduce one quiet counterline only after the second phrase; create depth through interplay, not louder mastering. ${shared}` },
      { id: "variation", label: "Variation", startFraction: 0.52, endFraction: 0.72, energy: 0.72, instruction: `Turn the motif through a different rhythmic placement or answering phrase, then briefly remove one layer so the return has contrast; never substitute a generic riser. ${shared}` },
      { id: "return", label: "Return", startFraction: 0.72, endFraction: 0.9, energy: 0.58, instruction: `Bring back the original motif in a warmer voicing with the same groove; the listener should recognize the return without a density spike. ${shared}` },
      { id: "outro", label: "Outro", startFraction: 0.9, endFraction: 1, energy: 0.3, instruction: `Strip back to the opening harmony and one final motif fragment, leaving a natural handoff so the later deterministic loop fold is musical. ${shared}` },
    ];
  }
  if (role === "sleep_sound_bed") {
    return [
      { id: "settle", label: "Settle", startFraction: 0, endFraction: 0.2, energy: 0.12, instruction: `Arrive as a soft, already-stable texture with no transient, pulse, lead melody, or attention-grabbing entrance. ${shared}` },
      { id: "steady", label: "Steady", startFraction: 0.2, endFraction: 0.52, energy: 0.12, instruction: `Hold the same low-arousal sound bed; use sustained tones and gentle noise texture without a beat, chord change, or melodic phrase. ${shared}` },
      { id: "drift", label: "Drift", startFraction: 0.52, endFraction: 0.78, energy: 0.12, instruction: `Make only one extremely gradual timbral or spatial shift, with no swell, new layer attack, or change in perceived loudness. ${shared}` },
      { id: "rest", label: "Rest", startFraction: 0.78, endFraction: 1, energy: 0.12, instruction: `Return to the opening texture and leave a calm, loop-compatible tail; no cadence, fade cue, climax, or new event. ${shared}` },
    ];
  }
  if (role === "meditation_bed") {
    if (durationSec > 180) {
      return [
        { id: "arrival", label: "Arrival", startFraction: 0, endFraction: 0.12, energy: 0.18, instruction: `Enter with one soft sustained dyad and no transient shock; establish a slow, safe breathing space before any pulse. ${shared}` },
        { id: "settle", label: "Settle", startFraction: 0.12, endFraction: 0.31, energy: 0.22, instruction: `Hold a slow stable pulse with tiny timing and timbre changes every few phrases; keep the lead below attention threshold rather than static. ${shared}` },
        { id: "open", label: "Open", startFraction: 0.31, endFraction: 0.5, energy: 0.26, instruction: `Open one harmonic interval and let a distant upper-register response appear, then recede; preserve physical space and avoid a climactic swell. ${shared}` },
        { id: "drift", label: "Drift", startFraction: 0.5, endFraction: 0.69, energy: 0.24, instruction: `Shift one texture or room reflection gradually while the original breath pulse remains recognizable; make variation felt through movement, never through a surprise event. ${shared}` },
        { id: "return", label: "Return", startFraction: 0.69, endFraction: 0.84, energy: 0.2, instruction: `Return to the arrival dyad with a subtly warmer voicing and less density, leaving uninterrupted room for calm attention. ${shared}` },
        { id: "release", label: "Release", startFraction: 0.84, endFraction: 1, energy: 0.16, instruction: `Remove one layer at a time and return to the arrival harmony; end gently without a hard cadence, abrupt fade, or new event. ${shared}` },
      ];
    }
    return [
      { id: "arrival", label: "Arrival", startFraction: 0, endFraction: 0.16, energy: 0.18, instruction: `Enter with one soft sustained dyad and no transient shock; establish a slow, safe breathing space before any pulse. ${shared}` },
      { id: "settle", label: "Settle", startFraction: 0.16, endFraction: 0.48, energy: 0.22, instruction: `Hold a slow stable pulse with tiny timing and timbre changes every few phrases; keep the lead below attention threshold rather than static. ${shared}` },
      { id: "breathe", label: "Breathe", startFraction: 0.48, endFraction: 0.78, energy: 0.26, instruction: `Open one harmonic interval and let a distant upper-register response appear, then recede; preserve physical space and avoid a climactic swell. ${shared}` },
      { id: "release", label: "Release", startFraction: 0.78, endFraction: 1, energy: 0.16, instruction: `Remove one layer at a time and return to the arrival harmony; end gently without a hard cadence, abrupt fade, or new event. ${shared}` },
    ];
  }
  if (role === "short_form_bed") {
    return [
      { id: "hook", label: "Hook", startFraction: 0, endFraction: 0.18, energy: 0.62, instruction: `Open on the first beat with a compact two-note motif and pulse, never a generic impact hit; leave the spoken-frequency range open. ${shared}` },
      { id: "drive", label: "Drive", startFraction: 0.18, endFraction: 0.5, energy: 0.68, instruction: `Keep a clear rhythmic engine under fast information, using one answering figure between phrases rather than adding a competing melody. ${shared}` },
      { id: "turn", label: "Turn", startFraction: 0.5, endFraction: 0.78, energy: 0.76, instruction: `Mark the reveal by changing harmony or removing the pulse for one beat before its return; never use a hollow riser. ${shared}` },
      { id: "button", label: "Button", startFraction: 0.78, endFraction: 1, energy: 0.58, instruction: `Return the opening motif in a concise final button, resolving before the final spoken line without masking it. ${shared}` },
    ];
  }
  if (durationSec > 180) {
    return [
      { id: "cold-open", label: "Cold open", startFraction: 0, endFraction: 0.09, energy: 0.28, instruction: `Place a quiet two-note pulse under the hook, then leave room after it; create intrigue without filling the speech band. ${shared}` },
      { id: "exposition", label: "Exposition", startFraction: 0.09, endFraction: 0.28, energy: 0.22, instruction: `Keep one sparse harmonic bed and a delayed low answer while the story establishes context; use rests between phrases. ${shared}` },
      { id: "complication", label: "Complication", startFraction: 0.28, endFraction: 0.45, energy: 0.36, instruction: `Introduce subtle harmonic tension or a restrained pulse underneath the narration, then withdraw one layer; do not become trailer music. ${shared}` },
      { id: "reveal", label: "Reveal", startFraction: 0.45, endFraction: 0.6, energy: 0.42, instruction: `Mark a meaningful story turn through one changed chord colour and a short answering figure, then restore speech space immediately; no generic riser or impact hit. ${shared}` },
      { id: "recovery", label: "Recovery", startFraction: 0.6, endFraction: 0.75, energy: 0.26, instruction: `Reduce density after the reveal and let the low answer carry continuity; retain motion without competing with the next spoken idea. ${shared}` },
      { id: "resolution", label: "Resolution", startFraction: 0.75, endFraction: 0.9, energy: 0.3, instruction: `Release tension by returning a warmer version of the opening harmony, with one short answer figure rather than a sentimental swell. ${shared}` },
      { id: "tail", label: "Tail", startFraction: 0.9, endFraction: 1, energy: 0.18, instruction: `Thin to the opening texture and resolve beneath the closing thought; no new motif, hard cadence, or abrupt fade. ${shared}` },
    ];
  }
  return [
    { id: "cold-open", label: "Cold open", startFraction: 0, endFraction: 0.12, energy: 0.28, instruction: `Place a quiet two-note pulse under the hook, then leave room after it; create intrigue without filling the speech band. ${shared}` },
    { id: "exposition", label: "Exposition", startFraction: 0.12, endFraction: 0.42, energy: 0.22, instruction: `Keep one sparse harmonic bed and a delayed low answer while the story establishes context; use rests between phrases. ${shared}` },
    { id: "complication", label: "Complication", startFraction: 0.42, endFraction: 0.65, energy: 0.36, instruction: `Introduce subtle harmonic tension or a restrained pulse underneath the narration, then withdraw one layer; do not become trailer music. ${shared}` },
    { id: "resolution", label: "Resolution", startFraction: 0.65, endFraction: 0.88, energy: 0.3, instruction: `Release tension by returning a warmer version of the opening harmony, with one short answer figure rather than a sentimental swell. ${shared}` },
    { id: "tail", label: "Tail", startFraction: 0.88, endFraction: 1, energy: 0.18, instruction: `Thin to the opening texture and resolve beneath the closing thought; no new motif, hard cadence, or abrupt fade. ${shared}` },
  ];
}

function sleepSoundRhythmicCue(role: ChannelMusicRole, instrumentation: readonly string[] | undefined): string | undefined {
  if (role !== "sleep_sound_bed") return undefined;
  return instrumentation?.find((instrument) =>
    /\b(?:drums?|percussion|boom[-\s]?bap|kick|snare|hi[-\s]?hat|cymbals?|tambourine|shaker|groove|rhythmic)\b/iu.test(instrument),
  );
}

function sleepSoundRhythmicGenre(role: ChannelMusicRole, genre: string | undefined): string | undefined {
  if (role !== "sleep_sound_bed" || !genre) return undefined;
  return /\b(?:techno|house|drum\s*(?:and|&)\s*bass|dnb|breakbeat|boom[-\s]?bap|hip[-\s]?hop|disco|funk|trap|dance)\b/iu.test(genre)
    ? genre
    : undefined;
}

function assertRoleCompatibleIdentity(
  role: ChannelMusicRole,
  instrumentation: readonly string[] | undefined,
  genre: string | undefined,
): void {
  const rhythmicCue = sleepSoundRhythmicCue(role, instrumentation);
  if (rhythmicCue) {
    throw new Error(`sleep soundscape cannot use rhythmic instrumentation: ${rhythmicCue}`);
  }
  const rhythmicGenre = sleepSoundRhythmicGenre(role, genre);
  if (rhythmicGenre) {
    throw new Error(`sleep soundscape cannot use a rhythmic genre: ${rhythmicGenre}`);
  }
}

function structuredCaption(input: {
  channelIdentityFingerprint: string;
  topic: string;
  role: ChannelMusicRole;
  genre: string;
  instrumentation: readonly string[];
  textures: readonly string[];
  bpmRange: readonly [number, number] | null;
  moodArc: string;
  composerDirection: string;
  sections: readonly z.infer<typeof MusicSectionSchema>[];
  exclusions: readonly string[];
}): string {
  const roleLanguage: Record<ChannelMusicRole, string> = {
    primary_music: "music-forward original instrumental for focused repeated listening",
    narration_bed: "restrained cinematic underscore that supports speech without dictating emotion",
    meditation_bed: "stable meditative bed with organic micro-variation and no startling events",
    sleep_sound_bed: "continuous low-arousal sleep soundscape with no pulse, melodic arrival, or startling events",
    short_form_bed: "compact information-forward underscore with an immediate motif and clean final button",
  };
  // Music3 still needs the explicit metadata/arrangement map below, but its
  // official prompt guidance is equally clear that the conditioning itself
  // should open like a musician's creative brief rather than a comma-separated
  // tag pile.  Put the emotional point of view and a concrete scene first, then
  // keep the audible palette deliberately small.  This gives the model a
  // memorable musical reason for the later section map without replacing the
  // channel-owned identity or adding an unbounded list of instruments.
  const tempo = input.bpmRange ? Math.round((input.bpmRange[0] + input.bpmRange[1]) / 2) : null;
  // Music3's Global Metadata explicitly calls for a key and scale. Derive it
  // from the stable channel identity, not episode mood, so a changing brief
  // does not make one channel's playlist feel tonally unrelated. This is prompt
  // guidance, not a claim that the generator can guarantee symbolic harmony.
  const tonalPalette = [
    "D minor", "E minor", "A minor", "C minor", "G minor", "B minor",
    "C major", "D major", "E-flat major", "F major", "G major", "A-flat major",
  ] as const;
  const tonalSource = input.channelIdentityFingerprint;
  const tonalIndex = Number.parseInt(sha256Hex(tonalSource).slice(0, 8), 16) % tonalPalette.length;
  const tonalCenter = tonalPalette[tonalIndex]!;
  const listeningScenario: Record<ChannelMusicRole, string> = {
    primary_music: "sustained focused work or relaxed repeat listening",
    narration_bed: "a paced narrated story where words remain the foreground",
    meditation_bed: "quiet reflection or breathwork with a steady, gently responsive pulse",
    sleep_sound_bed: "unattended overnight listening with stable loudness and no attention-catching events",
    short_form_bed: "a quick editorial insight with a single clear reveal",
  };
  const featuredInstruments = input.instrumentation.slice(0, 3);
  const featuredPalette = featuredInstruments.length === 1
    ? featuredInstruments[0]!
    : featuredInstruments.length === 2
      ? `${featuredInstruments[0]} and ${featuredInstruments[1]}`
      : `${featuredInstruments[0]}, ${featuredInstruments[1]}, and ${featuredInstruments[2]}`;
  // The focused opening must not erase a channel's complete declared sound
  // identity. The detailed control section retains it for compatible routes.
  const supportingTimbres = input.instrumentation.slice(1);
  const beatlessSleep = input.role === "sleep_sound_bed";
  if (!beatlessSleep && !input.bpmRange) throw new Error("metered music caption requires a BPM range");
  const globalMetadata = beatlessSleep
    ? `unmetered and beatless; no tempo or tonal-center instruction; ${roleLanguage[input.role]}. ` +
      `Scenario: ${listeningScenario[input.role]}. Topic: “${input.topic}”. ` +
      `Production: dimensional and spatially coherent—not a flat preset stack. Additional composer direction: ${input.composerDirection}`
    : `${input.bpmRange![0]}–${input.bpmRange![1]} BPM; ${roleLanguage[input.role]}. ` +
      `Key/scale: ${tonalCenter}; scenario: ${listeningScenario[input.role]}. ` +
      `Topic: “${input.topic}”. ` +
      `Production: dimensional and spatially coherent—not a flat preset stack. ` +
      `Additional composer direction: ${input.composerDirection}`;
  const vocalDetails = beatlessSleep
    ? "Instrumental sleep soundscape only: no lead vocal, backing vocal, chant, spoken word, whisper, or lyric. " +
      `Keep ${featuredPalette} as diffuse, sustained background texture; no featured or melodic lead.`
    : `Instrumental only: no lead vocal, backing vocal, chant, spoken word, whisper, or lyric. ` +
      `The melodic lead belongs to ${input.instrumentation[0]}; supporting timbres are ${supportingTimbres.join(", ") || "restrained harmonic texture"}.`;
  const creativeFoundation = beatlessSleep
    ? `${input.genre}: “${input.topic}”. Character: ${input.moodArc}. Keep ${featuredPalette} diffuse and sustained.`
    : `A ${input.moodArc} ${input.genre} instrumental at ${tempo} BPM: “${input.topic}”. Feature ${featuredPalette}.`;
  return [
    "### Creative Foundation",
    creativeFoundation,
    "",
    "### Global Metadata",
    globalMetadata,
    "",
    "### Vocal Details",
    vocalDetails,
    "",
    "### Arrangement",
    input.sections.map((section) =>
      `${section.label} (${Math.round(section.startFraction * 100)}–${Math.round(section.endFraction * 100)}%, energy ${section.energy.toFixed(2)}): ${section.instruction}`,
    ).join("\n"),
    `Texture and space: ${input.textures.join(", ") || "natural room depth"}. ` +
      `Hard exclusions: ${input.exclusions.join("; ")}. ` +
      (beatlessSleep
        ? "For sleep, these beatless/no-tonal-arrival constraints override any conflicting channel or composer direction; preserve an unmetered, stable sound texture."
        : "Preserve musical causality: every entrance, change, and exit must be audible and motivated."),
  ].join("\n");
}

/**
 * Music3 separates sung words from musical direction. Its lyrics input accepts
 * recognised section tags, while the Structured Caption owns arrangement,
 * instrumentation, energy and exclusions. Keeping prose instructions out of
 * the lyrics field prevents an instrumental render from treating phrases such
 * as “add harmonic depth” as performable text.
 */
export function instrumentalLyricsControl(
  role: ChannelMusicRole,
  durationSec = 120,
): string {
  const forms: Record<ChannelMusicRole, { core: readonly string[]; extension: readonly string[] }> = {
    // Music3 recognises both song-section tags and its native [Instrumental]
    // tag. Keep familiar form cues for coherent progression, but state the
    // no-vocal intent in the control stream as well as in the caption. The
    // latter is prose for arrangement; this must remain tag-only so it can
    // never become accidental sung/spoken text.
    primary_music: {
      core: ["[Intro]", "[Instrumental]", "[Verse]", "[Chorus]", "[Instrumental]", "[Bridge]", "[Chorus]"],
      extension: ["[Instrumental]", "[Verse]", "[Chorus]"],
    },
    meditation_bed: {
      core: ["[Intro]", "[Instrumental]", "[Verse]", "[Bridge]"],
      extension: ["[Instrumental]", "[Verse]", "[Bridge]"],
    },
    sleep_sound_bed: {
      core: ["[Intro]", "[Instrumental]", "[Instrumental]"],
      extension: ["[Instrumental]", "[Instrumental]"],
    },
    short_form_bed: {
      core: ["[Intro]", "[Instrumental]", "[Verse]", "[Chorus]"],
      extension: ["[Instrumental]", "[Verse]"],
    },
    narration_bed: {
      core: ["[Intro]", "[Instrumental]", "[Verse]", "[Bridge]", "[Chorus]"],
      extension: ["[Instrumental]", "[Verse]", "[Chorus]"],
    },
  };
  const form = forms[role];
  // Music3 treats max_duration as a ceiling, rather than a promise. Reusing a
  // six-section lyric map for a five-minute score made the model conclude well
  // before the requested duration and weakened the later arc into generic
  // texture. Repeat only recognised, prose-free section controls for each
  // extra minute above the normal two-minute form. This tells the model there
  // is more composition left to write without ever supplying text it could
  // sing. The conventional outro remains the one final tag.
  const boundedDuration = Number.isFinite(durationSec)
    ? Math.max(10, Math.min(300, Math.floor(durationSec)))
    : 120;
  const extensionCount = Math.max(0, Math.ceil((boundedDuration - 120) / 60));
  const tags = [...form.core];
  for (let index = 0; index < extensionCount; index += 1) tags.push(...form.extension);
  tags.push("[Outro]");
  return tags.join("\n");
}

export function createChannelMusicProgram(input: CreateChannelMusicProgramInput): ChannelMusicProgram {
  const family = input.family?.trim() || "unclassified";
  const contentLaneKey = input.contentLaneKey?.trim() || "unclassified";
  const routeRole = musicRoleForRoute(family, contentLaneKey);
  const routeOwnedRole = routeOwnedMusicRole(family, contentLaneKey);
  if (routeOwnedRole && input.role !== undefined && input.role !== routeOwnedRole) {
    const routeKind = routeOwnedRole === "primary_music" ? "route-owned" : "specialized route";
    throw new Error(`music role ${input.role} conflicts with ${routeKind} role ${routeOwnedRole}`);
  }
  const role = input.role ?? routeRole;
  assertRoleCompatibleIdentity(role, input.instrumentation, input.genre);
  const roleDefaults = {
    narration_bed: {
      genre: "restrained documentary underscore",
      instrumentation: ["low strings", "soft piano", "muted low pulse"],
      textures: ["dry centered dialogue space", "subtle room depth"],
      moodArc: "quiet uncertainty gathers into restrained tension, then resolves without competing with speech",
    },
    meditation_bed: {
      genre: "slow spacious ambient meditation",
      instrumentation: ["warm sustained pad", "sparse felt piano", "soft breathy flute"],
      textures: ["wide calm stereo space", "gentle natural air"],
      moodArc: "settle into a steady spacious calm, support slow breathing with subtle timbral change, and return without a strong melodic arrival",
    },
    sleep_sound_bed: {
      genre: "continuous low-arousal ambient sleep soundscape",
      instrumentation: ["soft sustained synth pad", "distant piano harmonics"],
      textures: ["steady filtered noise bed", "quiet natural room air"],
      moodArc: "remain stable and unobtrusive for unattended sleep; no pulse, melodic phrase, cadence, crescendo, or attention-catching event",
    },
    short_form_bed: {
      genre: "concise modern instrumental underscore",
      instrumentation: ["muted bass", "soft compact percussion", "single restrained pluck"],
      textures: ["tight clean low end", "controlled stereo width"],
      moodArc: "establish one clear rhythmic idea quickly, add a small lift, and resolve cleanly before the cut",
    },
  };
  const defaults = role === "primary_music"
    ? primaryMusicFallbackProfile({
        family,
        contentLaneKey,
        channelIdentitySeed: input.channelIdentityFingerprint,
      })
    : roleDefaults[role];
  const genre = cleanText(input.genre, defaults.genre, 160);
  const instrumentation = unique(input.instrumentation, defaults.instrumentation, 12);
  const textures = unique(input.textures, defaults.textures, 8);
  const rawBpm = role === "sleep_sound_bed" ? undefined :
    input.bpmRange ?? (role === "meditation_bed" ? [48, 64] : role === "short_form_bed" ? [88, 112] : [64, 84]);
  const bpmRange: [number, number] | null = rawBpm ? [
    Math.max(30, Math.min(300, Math.floor(rawBpm[0]))),
    Math.max(30, Math.min(300, Math.floor(rawBpm[1]))),
  ] : null;
  const moodArc = role === "sleep_sound_bed"
    ? defaults.moodArc
    : cleanText(input.moodArc, defaults.moodArc, 600);
  // Other roles preserve authored episode direction in full. Sleep is a
  // specialized beatless soundscape, so its role contract overrides groove,
  // meter, and movement directions while retaining the channel sound palette.
  const composerDirection = role === "sleep_sound_bed"
    ? "Keep the sound stable and unobtrusive; avoid groove, pulse, melodic hooks, chord arrivals, crescendos, or attention-catching changes."
    : input.composerDirection?.trim().replace(/\s+/gu, " ") ||
      "Give every section a musical job; preserve depth, groove, melodic purpose, and dynamic breathing room.";
  const exclusions = role === "sleep_sound_bed"
    ? [
        "vocals or intelligible words",
        "mechanical or broadband artifacts",
        "brick-wall compression or limiter pumping",
        "unintentional digital silence, clicks, or loop seams",
        "abrupt spatial or timbral jumps",
        "generic trailer booms and risers",
        "metered tempo or audible beat/pulse",
        "tonal progression, melodic hook, or cadence",
        "sudden change in loudness or density",
      ]
    : [
        "vocals or intelligible words",
        "hollow preset-only arrangement",
        "mechanical or broadband artifacts",
        "brick-wall compression or limiter pumping",
        "flat dynamics with no section development",
        "abrupt key, tempo, or acoustic-space changes",
        "generic trailer booms and risers",
        "melody that masks narration",
      ];
  const durationSec = Math.max(10, Math.min(300, Math.floor(input.durationSec ?? (role === "short_form_bed" ? 60 : 120))));
  const sections = roleSections(role, durationSec);
  const targetLufs = Math.max(-23, Math.min(-12, input.targetLufs ?? (role === "sleep_sound_bed" ? -20 : role === "primary_music" ? -16 : -18)));
  const narratedSleepRoute = role === "sleep_sound_bed" && routeHasNarrationCue(family, contentLaneKey);
  const narratedMeditationRoute = role === "meditation_bed" && routeHasNarrationCue(family, contentLaneKey);
  const defaultBodyMusicVol = role === "meditation_bed"
    ? narratedMeditationRoute ? 0.16 : 0.25
    : 0.1026;
  const bodyMusicVol = role === "primary_music" || (role === "sleep_sound_bed" && !narratedSleepRoute)
    ? 1
    : Math.max(0.01, Math.min(1, input.bodyMusicVol ?? defaultBodyMusicVol));
  const body: ChannelMusicProgramBody = {
    version: CHANNEL_MUSIC_PROGRAM_VERSION,
    channelIdentityPromptContract: "channel-identity-caption/v1",
    channelId: input.channelId,
    channelIdentityFingerprint: input.channelIdentityFingerprint,
    family,
    contentLaneKey,
    topic: input.topic,
    role,
    identity: { genre, instrumentation, textures, bpmRange, moodArc, exclusions },
    generation: {
      providerPreference: input.providerPreference ?? "minimax_music3",
      durationSec,
      instrumental: true,
      structuredCaption: structuredCaption({
        channelIdentityFingerprint: input.channelIdentityFingerprint,
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
      lyricsControl: instrumentalLyricsControl(role, durationSec),
      sections,
    },
    mix: {
      targetLufs,
      truePeakMaxDbtp: -1,
      bodyMusicVol,
      narrationPriority: role === "narration_bed" || role === "short_form_bed" || narratedSleepRoute || narratedMeditationRoute,
      transparentConstantGainOnly: true,
      compressorProhibited: true,
      limiterProhibited: true,
    },
    quality: {
      minimumLraLu: role === "primary_music" ? 3 : role === "meditation_bed" ? 2 : role === "sleep_sound_bed" ? 1 : 1.5,
      minimumCrestDb: role === "primary_music" ? 8 : 7,
      maximumConsecutiveCeilingSamples: 3,
      maximumClippedSamples: 0,
      minimumEmotionalDepthScore: 0.8,
      minimumArrangementDepthScore: 0.8,
      sectionReviewRequired: true,
      humanAuditionRequired: true,
    },
  };
  if (body.generation.providerPreference === "minimax_music3") {
    body.minimaxLicense = {
      uiAttribution: "MiniMax-Music3",
      prominentCommercialAttributionRequired: true,
      generatedContentDisclosureRequired: true,
      safeguardsRequired: true,
      separateAuthorizationAboveAnnualRevenueUsd: 20_000_000,
      operatorAttestationRequiredBeforeEnablement: true,
    };
  }
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
    // Derived from the native retained WAV, not a form field. It catches the
    // known Music3/ComfyUI failure mode where high-frequency information
    // collapses a few seconds after a normal-sounding opening.
    openingHighBandDropDb: z.number().min(0).max(100),
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
    measurements.openingHighBandDropDb > MUSIC_PROGRAM_MAX_OPENING_HIGH_BAND_DROP_DB
      ? "opening-to-early-interior high-band energy collapsed (known Music3 degradation signature)"
      : "",
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

/**
 * Re-admit a durable quality receipt at a later boundary. Parsing proves only
 * shape and fingerprint; this also reapplies the program-specific thresholds
 * so an older or hand-authored receipt cannot bypass the current quality bar.
 */
export function assertMusicProgramQualityReceipt(input: {
  readonly program: unknown;
  readonly receipt: unknown;
}): MusicProgramQualityReceipt {
  const program = ChannelMusicProgramSchema.parse(input.program);
  const receipt = MusicProgramQualityReceiptSchema.parse(input.receipt);
  if (receipt.programFingerprint !== program.fingerprint) {
    throw new Error("music quality receipt belongs to a different channel music program");
  }
  return createMusicProgramQualityReceipt({
    program,
    output: receipt.output,
    measurements: receipt.measurements,
    sectionReviews: receipt.sectionReviews,
    audition: receipt.audition,
  });
}
