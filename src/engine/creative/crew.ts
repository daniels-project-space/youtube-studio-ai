/**
 * Per-video crew briefs. Each helper turns the channel's Show Bible + the current
 * topic into one slice of the VideoBrief, via the matching crew agent. Single-shot
 * (cheap Gemini) with graceful failure → returns undefined so the brief block can
 * degrade and downstream blocks fall back to their archetype defaults.
 *
 * Same signature for every role (brief(bible, ctx) → slice) — the "same thing,
 * custom goal" contract: only the agent + the doctrine differ.
 */
import { z } from "zod";
import { CADENCE_BASE as EDITOR_CADENCE_BASE } from "@/lib/crew/editor";
import { agentJson, agentJsonConfiguration } from "@/agents/mastra";
import {
  ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS,
  SCORED_ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS,
  assertArrangementComposerAdmission,
  assertArrangementComposerInput,
  type ArrangementComposerAdmission,
} from "@/lib/arrangementComposerBudget";
import { ExecutionError } from "@/engine/executionErrors";
import { AcceptedMusicArrangementDraftSchema, createMusicReviewContext, MusicReviewContextSchema, MusicSymbolicScoreSchema,
  MusicArrangementIntentSchema, MusicChannelGroundingSchema, MusicSymbolicScorePolicySchema,
  refineMusicArrangementIntent, type MusicArrangementIntent } from "@/engine/acceptedMusicArrangement";
import type {
  ShowBible,
  StyleDNA,
  StructureBrief,
  VisualBrief,
  CutSheet,
  AudioBrief,
  ValidationAssertion,
  ValidationSpec,
} from "./types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface CrewContext {
  topic: string;
  family: string;
  niche?: string;
  channelName?: string;
  targetSeconds?: number;
  /** Compact Style-DNA digest — the frozen channel identity every brief conforms to. */
  dnaDigest?: string;
  /** Audio slice of the DNA (composer only). */
  dnaAudio?: string;
  /** Exact frozen identity for opt-in producers; legacy prompts remain unchanged. */
  persona?: string;
  styleGrammar?: string;
  sourceAudioDna?: Partial<StyleDNA["audio"]> | null;
  /** Resolved per-channel role controls; must influence the actual brief. */
  roleDirectives?: string;
  /** Only the opt-in arrangement composer uses these explicit, typed constraints. */
  musicIntent?: MusicArrangementIntent;
  /** Bounded, immutable serial-episode continuity (when the route owns one). */
  serializedEpisodeContext?: string;
  log?: Logger;
}

function header(bible: ShowBible, ctx: CrewContext): string {
  return [
    `Channel: ${ctx.channelName ?? "this channel"}${ctx.niche ? ` (${ctx.niche})` : ""}.`,
    `Positioning: ${bible.positioning}`,
    `Vibe: ${bible.vibe}`,
    `Iconic motif: ${bible.iconicMotif}`,
    bible.worksInSpace.length ? `WORKS in this space: ${bible.worksInSpace.join("; ")}` : "",
    bible.avoidInSpace.length ? `NEVER do (fails here): ${bible.avoidInSpace.join("; ")}` : "",
    ctx.dnaDigest ?? "",
    ctx.roleDirectives ? `Operator role directives: ${ctx.roleDirectives}` : "",
    `Video topic: "${ctx.topic}".`,
    ctx.serializedEpisodeContext ?? "",
    ctx.targetSeconds ? `Target length: ~${Math.round(ctx.targetSeconds / 60)} min.` : "",
  ].filter(Boolean).join("\n");
}

/* ------------------------------ Director ------------------------------- */

const structureSchema = z.object({
  hook: z.string(),
  beats: z.array(z.object({ name: z.string(), intentSec: z.number(), note: z.string() })).default([]),
});

export async function briefDirector(bible: ShowBible, ctx: CrewContext): Promise<StructureBrief | undefined> {
  const log = ctx.log ?? (() => {});
  try {
    const raw = await agentJson({
      role: "crew_director",
      schema: structureSchema,
      log: (m) => log(m),
      // Reasoning route: the ceiling covers the thinking AND the list. Measured —
      // an agentJson list failed at 500 and passed at 1000; an 8-item ranking
      // failed at 1500 and passed at 2500. See scripts/audit-json-contract-ceilings.ts,
      // which could not see this call at all until it learned to resolve a schema
      // passed by reference.
      maxTokens: 2500,
      temperature: 0.8,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.directorDoctrine ? `Your doctrine: ${bible.directorDoctrine}\n\n` : "") +
        `Design this video's STRUCTURE: a scroll-stopping hook line, then an ordered beat map ` +
        `(name, intended on-screen seconds, and the emotional/narrative intent of each beat) that ` +
        `sums to roughly the target length and serves the channel's vibe. Return STRICT JSON ` +
        `{"hook":string,"beats":[{"name":string,"intentSec":number,"note":string}]}.`,
    });
    const hook = raw.hook.trim();
    const proposedBeats = raw.beats ?? [];
    if (!hook) {
      log("crew/director: BRIEF REJECTED — the structure has no hook");
      return undefined;
    }
    if (proposedBeats.length === 0) {
      log("crew/director: BRIEF REJECTED — the structure has no beats");
      return undefined;
    }
    const invalidBeatIndex = proposedBeats.findIndex((beat) =>
      !beat.name.trim() || !beat.note.trim() || !Number.isFinite(beat.intentSec) || beat.intentSec <= 0,
    );
    if (invalidBeatIndex >= 0) {
      log(`crew/director: BRIEF REJECTED — beat ${invalidBeatIndex + 1} is missing a name, intent, or positive duration`);
      return undefined;
    }
    const beats = proposedBeats.map((beat) => ({
      name: beat.name.trim(), intentSec: Math.max(1, Math.round(beat.intentSec)), note: beat.note.trim(),
    }));
    return { hook, beats };
  } catch (e) {
    // Returning undefined is the right degradation — a video without a director
    // brief still renders. But the log has to say the brief is GONE, not just
    // echo a provider error, or a run that shipped with no structure/beats reads
    // exactly like a run that had them.
    log(`crew/director: BRIEF UNAVAILABLE — this video gets no structure/beats from the director: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* --------------------------- Cinematographer --------------------------- */

const visualSchema = z.object({
  footageQueries: z.array(z.string()).default([]),
  promptStyle: z.string().default(""),
  palette: z.array(z.string()).default([]),
  motion: z.string().default(""),
  avoid: z.array(z.string()).default([]),
});

export async function briefCinematographer(bible: ShowBible, ctx: CrewContext): Promise<VisualBrief | undefined> {
  const log = ctx.log ?? (() => {});
  try {
    const raw = await agentJson({
      role: "cinematographer",
      schema: visualSchema,
      log: (m) => log(m),
      // Reasoning route: the ceiling covers the thinking AND the list. Measured —
      // an agentJson list failed at 500 and passed at 1000; an 8-item ranking
      // failed at 1500 and passed at 2500. See scripts/audit-json-contract-ceilings.ts,
      // which could not see this call at all until it learned to resolve a schema
      // passed by reference.
      maxTokens: 2500,
      temperature: 0.8,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.dpDoctrine ? `Your doctrine: ${bible.dpDoctrine}\n\n` : "") +
        `Direct the LOOK for this video. Provide: 8-14 CONCRETE stock-footage search queries. Each query ` +
        `MUST be 2-5 words — a literal stock-site SEARCH TERM (e.g. "city skyline night", "coins on desk", ` +
        `"espresso steam closeup"), NEVER a full scene description: long queries return zero results. ` +
        `Also: a promptStyle clause to blend into AI keyframe/scene prompts; ` +
        `a palette (hex) to bias toward; the motion language (what moves, how); and visual things to avoid. ` +
        `Stay consistent with the iconic motif. Return STRICT JSON ` +
        `{"footageQueries":string[],"promptStyle":string,"palette":string[],"motion":string,"avoid":string[]}.`,
    });
    const queries = [...new Map((raw.footageQueries ?? [])
      .map((query) => query.trim())
      .filter((query) => {
        const words = query.split(/\s+/u);
        return words.length >= 2 && words.length <= 5;
      })
      .map((query) => [query.toLocaleLowerCase("en-US"), query] as const))]
      .slice(0, 14)
      .map(([, query]) => query);
    // OUTPUT SANITY: a degenerate LLM loop once emitted a 307,000-char
    // promptStyle ("gigantic" x420) that was blended into every downstream
    // i2v prompt and 422'd the provider. Clause fields are CLAUSES: hard-cap
    // them and collapse runaway token repetition to the first clean sentence.
    const clause = (s: string | undefined, cap: number): string => {
      let v = (s ?? "").trim();
      if (!v) return v;
      const toks = v.split(/\s+/);
      if (toks.length > 40) {
        const uniq = new Set(toks.map((t) => t.toLowerCase()));
        if (uniq.size / toks.length < 0.35) v = v.split(/(?<=[.!?])\s+/)[0] ?? v.slice(0, 200);
      }
      return v.length > cap ? v.slice(0, cap).replace(/\s+\S*$/, "") : v;
    };
    const promptStyle = clause(raw.promptStyle, 500);
    const palette = [...new Set((raw.palette ?? []).filter((color) => /^#[0-9a-fA-F]{6}$/u.test(color)))]
      .slice(0, 5);
    const motion = clause(raw.motion, 300);
    const avoid = [...new Set((raw.avoid ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
    const missing: string[] = [];
    if (queries.length < 8) missing.push(`only ${queries.length} valid distinct stock queries (needs 8)`);
    if (!promptStyle) missing.push("prompt style");
    if (palette.length === 0) missing.push("valid color palette");
    if (!motion) missing.push("motion direction");
    if (avoid.length === 0) missing.push("visual avoid guidance");
    if (missing.length) {
      log(`crew/dp: BRIEF REJECTED — incomplete visual brief: ${missing.join(", ")}`);
      return undefined;
    }
    return {
      footageQueries: queries,
      promptStyle,
      palette,
      motion,
      avoid,
    };
  } catch (e) {
    // Returning undefined is the right degradation — a video without a dp
    // brief still renders. But the log has to say the brief is GONE, not just
    // echo a provider error, or a run that shipped with no visual specs reads
    // exactly like a run that had them.
    log(`crew/dp: BRIEF UNAVAILABLE — this video gets no visual specs from the dp: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* ------------------------------- Editor -------------------------------- */

const minEditorCadence = Math.min(...Object.values(EDITOR_CADENCE_BASE));
const maxEditorCadence = Math.max(...Object.values(EDITOR_CADENCE_BASE));
const cutSchema = z.object({
  sections: z.array(z.object({ name: z.string(), cutsPerMin: z.number().finite().min(minEditorCadence).max(maxEditorCadence) })).default([]),
  transitions: z.string().default(""),
  captionStyle: z.string().default(""),
  overlayRule: z.string().default(""),
});

export async function briefEditor(bible: ShowBible, ctx: CrewContext): Promise<CutSheet | undefined> {
  const log = ctx.log ?? (() => {});
  try {
    const raw = await agentJson({
      role: "editor",
      schema: cutSchema,
      log: (m) => log(m),
      // Reasoning route: the ceiling covers the thinking AND the list. Measured —
      // an agentJson list failed at 500 and passed at 1000; an 8-item ranking
      // failed at 1500 and passed at 2500. See scripts/audit-json-contract-ceilings.ts,
      // which could not see this call at all until it learned to resolve a schema
      // passed by reference.
      maxTokens: 2500,
      temperature: 0.7,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.editorDoctrine ? `Your doctrine: ${bible.editorDoctrine}\n\n` : "") +
        `Cut this video. Provide: cut cadence per section (name + cuts per minute), the transition ` +
        `language, caption styling intent, and the overlay/quote-card placement rule. Match the channel's ` +
        `pace — calibrate cutsPerMin to real editing practice: still ${EDITOR_CADENCE_BASE.still}, contemplative/documentary 2-5, standard ` +
        `essay 4-7, energetic explainer 8-12, frenetic ${EDITOR_CADENCE_BASE.frenetic} ` +
        `(a "deliberate, breathing" edit is NOT 8+ cuts/min). Supported range: ${minEditorCadence}-${maxEditorCadence} cuts/min. Return STRICT JSON ` +
        `{"sections":[{"name":string,"cutsPerMin":number}],"transitions":string,"captionStyle":string,"overlayRule":string}.`,
    });
    const proposedSections = raw.sections ?? [];
    const sections = proposedSections.map((section) => ({
      name: section.name.trim(),
      cutsPerMin: section.cutsPerMin,
    }));
    const invalidSection = sections.some((section) =>
      !section.name || !Number.isFinite(section.cutsPerMin) || section.cutsPerMin < minEditorCadence || section.cutsPerMin > maxEditorCadence,
    );
    const uniqueSectionNames = new Set(sections.map((section) => section.name.toLocaleLowerCase("en-US")));
    const transitions = raw.transitions?.trim() ?? "";
    const captionStyle = raw.captionStyle?.trim() ?? "";
    const overlayRule = raw.overlayRule?.trim() ?? "";
    const missing: string[] = [];
    if (sections.length === 0) missing.push("section cadence");
    if (invalidSection) missing.push(`valid named cadence between ${minEditorCadence} and ${maxEditorCadence} cuts per minute`);
    if (uniqueSectionNames.size !== sections.length) missing.push("distinct section names");
    if (!transitions) missing.push("transition language");
    if (!captionStyle) missing.push("caption styling");
    if (!overlayRule) missing.push("overlay placement rule");
    if (missing.length) {
      log(`crew/editor: BRIEF REJECTED — incomplete cut sheet: ${missing.join(", ")}`);
      return undefined;
    }
    return {
      sections,
      transitions,
      captionStyle,
      overlayRule,
    };
  } catch (e) {
    // Returning undefined is the right degradation — a video without a editor
    // brief still renders. But the log has to say the brief is GONE, not just
    // echo a provider error, or a run that shipped with no cut plan reads
    // exactly like a run that had them.
    log(`crew/editor: BRIEF UNAVAILABLE — this video gets no cut plan from the editor: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* ------------------------------ Composer ------------------------------- */

const composerSchema = z.object({
  musicPrompt: z.string().trim().min(1),
  duckDb: z.number().finite().default(-12),
  bedLufs: z.number().finite().default(-22),
  voiceFx: z.enum(["radio"]).optional(),
});

export async function briefComposer(
  bible: ShowBible,
  ctx: CrewContext,
): Promise<{ musicPrompt: string; audio: AudioBrief } | undefined> {
  const log = ctx.log ?? (() => {});
  try {
    const raw = await agentJson({
      role: "composer",
      schema: composerSchema,
      log: (m) => log(m),
      // Reasoning route: the ceiling covers the thinking AND the list. Measured —
      // an agentJson list failed at 500 and passed at 1000; an 8-item ranking
      // failed at 1500 and passed at 2500. See scripts/audit-json-contract-ceilings.ts,
      // which could not see this call at all until it learned to resolve a schema
      // passed by reference.
      maxTokens: 2500,
      temperature: 0.8,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.composerDoctrine ? `Your doctrine: ${bible.composerDoctrine}\n\n` : "") +
        (ctx.dnaAudio ? `${ctx.dnaAudio}\n\n` : "") +
        `Score this video. Write a single MUSIC generation prompt (genre, instrumentation, dynamics, ` +
        `BPM band, mood, and what to avoid — e.g. "no drums, no vocals" when that fits the vibe). Also give ` +
        `duckDb (how far to duck music under narration, negative dB; ignore if no narration), bedLufs (music ` +
        `loudness target), and optional voiceFx ("radio" or omit). Return STRICT JSON ` +
        `{"musicPrompt":string,"duckDb":number,"bedLufs":number,"voiceFx":string?}.`,
    });
    const musicPrompt = (raw.musicPrompt ?? "").trim();
    if (!musicPrompt) return undefined;
    const fx = (raw.voiceFx ?? "").trim().toLowerCase();
    return {
      musicPrompt,
      audio: {
        duckDb: typeof raw.duckDb === "number" && Number.isFinite(raw.duckDb) ? raw.duckDb : -12,
        bedLufs: typeof raw.bedLufs === "number" && Number.isFinite(raw.bedLufs) ? raw.bedLufs : -22,
        voiceFx: fx === "radio" ? "radio" : undefined,
      },
    };
  } catch (e) {
    // Returning undefined is the right degradation — a video without a composer
    // brief still renders. But the log has to say the brief is GONE, not just
    // echo a provider error, or a run that shipped with no music arc reads
    // exactly like a run that had them.
    log(`crew/composer: BRIEF UNAVAILABLE — this video gets no music arc from the composer: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

const arrangementComposerResponseSchema = z.object({
  arrangement: AcceptedMusicArrangementDraftSchema,
  channelGrounding: MusicChannelGroundingSchema,
  duckDb: z.number().finite(),
  bedLufs: z.number().finite(),
  voiceFx: z.literal("radio").optional(),
}).strict();

function requireExplicitArrangementTempo<T extends z.infer<typeof arrangementComposerResponseSchema>>(
  schema: z.ZodType<T>,
) {
  return schema.superRefine((response, issue) => {
    if (response.arrangement.tempoMode === undefined) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["arrangement", "tempoMode"],
        message: "new Composer responses must explicitly choose metered or unmetered tempoMode" });
    }
  });
}

const arrangementComposerResponseWithTempoSchema = requireExplicitArrangementTempo(arrangementComposerResponseSchema);
const scoredArrangementComposerResponseSchema = requireExplicitArrangementTempo(
  arrangementComposerResponseSchema.extend({ symbolicScore: MusicSymbolicScoreSchema }),
);

export const ComposerBriefWithArrangementSchema = z.object({
  musicPrompt: z.string().min(1),
  musicIntent: MusicArrangementIntentSchema.optional(),
  reviewContext: MusicReviewContextSchema.optional(),
  channelGrounding: MusicChannelGroundingSchema,
  symbolicScore: MusicSymbolicScoreSchema.optional(),
  symbolicScorePolicy: MusicSymbolicScorePolicySchema.optional(),
  audio: z.object({
    duckDb: z.number().finite(),
    bedLufs: z.number().finite(),
    voiceFx: z.literal("radio").optional(),
  }).strict(),
  arrangement: AcceptedMusicArrangementDraftSchema,
}).passthrough().superRefine((brief, refinement) => {
  refineMusicArrangementIntent(brief, refinement);
  if (brief.musicPrompt !== brief.arrangement.direction) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      message: "musicPrompt must equal the accepted arrangement direction",
      path: ["musicPrompt"],
    });
  }
  const sectionIds = new Set(brief.arrangement.sections.map((section) => section.id));
  const groundingCoverage = new Set(brief.channelGrounding.flatMap((entry) => entry.sectionIds));
  if (!brief.reviewContext || !brief.channelGrounding.some((entry) => entry.source === "episode_topic" && entry.cue === brief.reviewContext!.topic) ||
      !brief.channelGrounding.some((entry) => entry.source !== "episode_topic") ||
      brief.channelGrounding.some((entry) => !brief.reviewContext!.promptContext.toLocaleLowerCase().includes(entry.cue.toLocaleLowerCase()) ||
        entry.sectionIds.some((id) => !sectionIds.has(id))) ||
      [...sectionIds].some((id) => !groundingCoverage.has(id))) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["channelGrounding"],
      message: "channel grounding must quote frozen identity and episode cues and bind concrete decisions to every section" });
  }
});

/** Opt-in producer: the composer authors the form; downstream modules only seal and execute it. */
export async function briefComposerWithArrangement(
  bible: ShowBible,
  ctx: CrewContext,
  admission: ArrangementComposerAdmission,
  includeSymbolicScore = false,
): Promise<z.infer<typeof ComposerBriefWithArrangementSchema>> {
  const musicIntent = ctx.musicIntent === undefined ? undefined : MusicArrangementIntentSchema.parse(ctx.musicIntent);
  const config = agentJsonConfiguration("composer_arrangement");
  assertArrangementComposerAdmission(config.model, admission, includeSymbolicScore);
  const responseSchema = includeSymbolicScore
    ? scoredArrangementComposerResponseSchema
    : arrangementComposerResponseWithTempoSchema;
  const promptContext = [
    header(bible, ctx), `Content family: ${ctx.family}.`,
    musicIntent ? `Explicit music intent (required exact values, not suggestions): ${JSON.stringify(musicIntent)}` : "",
    ctx.persona ? `Channel persona: ${ctx.persona}` : "",
    ctx.styleGrammar ? `Channel style grammar: ${ctx.styleGrammar}` : "",
    bible.composerDoctrine ? `Your doctrine: ${bible.composerDoctrine}` : "",
    ctx.sourceAudioDna === undefined ? ctx.dnaAudio ?? "" :
      `Frozen audio identity (only authored values; omitted fields are unspecified): ${JSON.stringify(ctx.sourceAudioDna)}\n` +
      `Loopability alone does not specify musical ending, playback, or progression. Do not invent channel defaults for absent fields.`,
  ].filter(Boolean).join("\n\n");
  const prompt = `${promptContext}\n\n` +
      `Author this video's complete instrumental music arrangement. Preserve the locked channel sound, ` +
      `operator direction, and episode nuance. You own the musical form; the generator will not invent ` +
      `a build, drop, climax, motif, or section progression for you. A continuous flat arrangement is valid ` +
      `when requested: its sections are review intervals, not mandatory musical changes, and may have ` +
      `identical energy and instructions with stable texture and no development. ` +
      `Channel-grounding standard: turn each supplied persona, style-grammar, doctrine, and authored audio-identity ` +
      `cue into concrete audible choices in the direction and section instructions (for example register, ` +
      `instrumentation, density, harmonic motion, articulation, space, or development). Make the combination ` +
      `distinctive to this channel and episode, not a list of mood adjectives or a generic genre preset. ` +
      `Preserve constraints and exclusions explicitly; do not invent identity traits or preferences for fields that ` +
      `were not supplied. Every section must state what remains recognizable and what, if anything, is allowed to change. ` +
      `Return channelGrounding with one episode_topic cue that exactly quotes the supplied video topic and at least one ` +
      `channel identity cue (persona, style grammar, Show Bible, or authored audio identity) quoted exactly from the context. ` +
      `For each cue provide at least two distinct dimensions from instrumentation, register, texture, harmony, rhythm, ` +
      `dynamics, articulation, space, or development, with concrete audible choices and the section ids they govern. ` +
      `Choose role primary_music, narration_bed, meditation_bed, sleep_sound_bed, or short_form_bed from the supplied intent. ` +
      `sleep_sound_bed is for unattended sleep: stable low arousal, no pulse, melodic arrival, crescendo, or attention-catching event. ` +
      `Set tempoMode explicitly to metered or unmetered. sleep_sound_bed must be unmetered; meditation_bed ` +
      `may use either mode. Unmetered arrangements must not supply a pulse or BPM direction. Provide full direction including ` +
      `genre, instrumentation, mood, and exclusions. No vocals or lyrics. ` +
      `requestedDurationSec requests one native source piece, an integer from 10 to 300 seconds; it is ` +
      `neither total video duration nor a promise of exact provider output length. Do not clamp an explicit ` +
      `out-of-range source-piece request into this range. Choose form continuous, through_composed, or sectional. ` +
      `Ending (seamless_wrap or natural_cadence) and playback (repeat or once) are independent choices: ` +
      `preserve each supplied intent without inferring one from the other. Do not replace a natural ending with a loop. ` +
      `Supply 4 to 8 ordered sections with unique lowercase hyphenated ids, labels, startFraction, endFraction, ` +
      `energy (0 to 1), and instruction. Fractions must cover exactly 0 to 1 without gaps or overlaps. ` +
      `Also give duckDb, bedLufs, and optional voiceFx (radio or omit), as in the existing audio brief. ` +
      `Return STRICT JSON {"arrangement":{"role":string,"direction":string,"requestedDurationSec":number,` +
      `"form":string,"ending":string,"playback":string,"sections":[{"id":string,"label":string,` +
      `"startFraction":number,"endFraction":number,"energy":number,"instruction":string}]},` +
      `"channelGrounding":[{"source":"channel_persona|style_grammar|show_bible|audio_identity|episode_topic",` +
      `"cue":string,"decisions":[{"dimension":"instrumentation|register|texture|harmony|rhythm|dynamics|articulation|space|development",` +
      `"choice":string}],"sectionIds":[string]}],` +
      `"duckDb":number,"bedLufs":number,"voiceFx":string?${includeSymbolicScore ? ',"symbolicScore":string' : ""}}.` +
      (includeSymbolicScore ? `\n\nAuthor symbolicScore as a complete original YuE2 native ABC composition, not prose or Markdown. ` +
        `Bind every musical choice to this channel, topic, and the arrangement you just authored. The score is the ` +
        `generator's executable composition: preserve its form, section proportions, energy, instrumentation, exclusions ` +
        `and ending; do not substitute a generic chord loop. This is a restricted native dialect, NOT general ABC. ` +
        `The first two lines must be exactly X:1 and T: (blank title; never append a song name). ` +
        `Continue in this exact order with M:<meter>, L:1/32, Q:1/4=<tempo>, ` +
        `V: Vocal clef=treble name="Vocal Melody" snm="Vocal", ` +
        `V: Ins clef=treble name="Ins Melody" snm="Inst.", and K:<key>. ` +
        `Use paired V: Vocal and V: Ins groups, with % section-id comments matching the arrangement. Each voice in ` +
        `a group has exactly one music line containing 1 to 4 complete measures and ending with a plain | barline. ` +
        `Use additional paired groups for longer sections; do not add blank lines, double barlines or arbitrary header fields. ` +
        `Vocal bars must contain rests only (z) with optional quoted chord symbols; no lyrics or vocal notes. ` +
        `Author sequential instrumental notes/rests in Ins; simultaneous bracketed note chords such as [CEG]8 are INVALID. ` +
        `Ins represents the instrumental melodic/reduced line; put harmony in Vocal's quoted chord symbols and rich ` +
        `instrumentation/voicings in the arrangement direction. Chord quotes contain a bare chord name such as "Fmaj7", ` +
        `never "[Fmaj7]". Supported chord qualities are major (no suffix), m, dim, aug, 7, maj7, m7, dim7, m7b5, ` +
        `sus4, sus2, 6, m6, 7sus4 and m(maj7), with optional slash bass. ` +
        `Use standard major/minor K: values such as F, Bb, Am; not mode names. ` +
        `Allowed note/rest length suffixes are only 1,2,3,4,6,8,12,16,24,32,48. Split other lengths into supported ` +
        `tied notes or separate rests; no fractional lengths, tuplets, decorations or velocity directives. ` +
        `Quoted chord symbols belong only in Vocal. Both voices must have the same ` +
        `number of measures and matching meter/key/time grids in every group. ` +
        `All note/rest lengths use L:1/32, including sustained notes; do not use repeats or abbreviated omitted bars. ` +
        `Calculate symbolic duration from total beats and the quarter-note tempo: total quarter-note beats * 60 / tempo ` +
        `must equal requestedDurationSec exactly. Q must be a positive integer. Every bar must sum exactly to its meter; ` +
        `partial final bars are invalid. When needed, use matching M: changes immediately after each voice marker for a ` +
        `complete final measure with a different meter, without changing the requested musical identity or duration. ` +
        `Check all duration arithmetic before answering. A notation time grid does not authorize audible pulse, drums or melodic ` +
        `development in an unmetered drone or static sleep texture; use sustained tones/rests to preserve those intentions. ` +
        `When the brief asks for a stable drone with no development, preserve the same pitch/register and harmonic support ` +
        `across review intervals, using ties across barlines to avoid unrequested reattacks. Section labels alone never ` +
        `authorize a new chord or melody; reserve any requested cadence for the ending. ` +
        `A long note occupies its full written duration: it is not empty space between sparse gestures. When the brief ` +
        `requires space for speech or gaps between gestures, write actual z rests in the instrumental line. ` +
        `If an instruction promises trailing silence, end the score with explicit rests after the resolved phrase, ` +
        `counted inside the exact source duration. Do not rely on prose to contradict sounding notes in the score. ` +
        `A requested natural ending must resolve; do not truncate a phrase merely to hit a number. The performance may ` +
        `end naturally under the permitted source policy; final video looping and duration belong to assembly. ` +
        `Keep the exact score below 32000 UTF-8 bytes. Its native syntax and symbolic duration will be independently ` +
        `checked before GPU work; writing a score does not certify instrumental-only audio, channel fit or a seamless loop.` : "");
  assertArrangementComposerInput(prompt, config.system);
  const reviewContext = createMusicReviewContext({
    topic: ctx.topic, family: ctx.family, channelName: ctx.channelName ?? null, promptContext,
  });
  let dispatchAdmitted = false;
  try {
    const raw = responseSchema.parse(await agentJson({
      role: "composer_arrangement",
      schema: responseSchema,
      log: ctx.log,
      // Eight section objects plus full direction and reasoning need more
      // headroom than the legacy paragraph. This same bound prices admission.
      maxTokens: includeSymbolicScore ? SCORED_ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS : ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS,
      temperature: 0.8,
      prompt,
      beforeDispatch: async () => {
        assertArrangementComposerInput(prompt, config.system);
        assertArrangementComposerAdmission(config.model, admission, includeSymbolicScore);
        if (!admission.beforeDispatch) {
          throw new ExecutionError("INLINE_PAID_EXECUTION_LEASE_REQUIRED: arrangement composer has no execution authority", {
            code: "INLINE_PAID_EXECUTION_LEASE_REQUIRED", retryable: false,
          });
        }
        await admission.beforeDispatch();
        dispatchAdmitted = true;
      },
    }));
    return ComposerBriefWithArrangementSchema.parse({
      reviewContext,
      ...(musicIntent ? { musicIntent } : {}),
      arrangement: raw.arrangement,
      ...("symbolicScore" in raw ? { symbolicScore: MusicSymbolicScoreSchema.parse(raw.symbolicScore),
        symbolicScorePolicy: "instrumental" as const } : {}),
      musicPrompt: raw.arrangement.direction,
      channelGrounding: raw.channelGrounding,
      audio: {
        duckDb: raw.duckDb,
        bedLufs: raw.bedLufs,
        ...(raw.voiceFx === undefined ? {} : { voiceFx: raw.voiceFx }),
      },
    });
  } catch (error) {
    if (!dispatchAdmitted) throw error;
    // A schema failure can still be a consumed response. Preserve observed
    // usage in the runner and hold this paid stage instead of buying it again.
    throw new ExecutionError(
      `PAID_STAGE_RECONCILIATION_REQUIRED: arrangement composer dispatched without an accepted artifact: ${error instanceof Error ? error.message : String(error)}`,
      { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false },
    );
  }
}

/* ------------------------------- Critic -------------------------------- */

const specSchema = z.object({
  assertions: z.array(z.object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    check: z.enum(["deterministic", "vision"]),
    metric: z.string().optional(),
    op: z.enum(["<", "<=", ">", ">=", "=="]).optional(),
    threshold: z.number().optional(),
    severity: z.enum(["block", "warn"]),
  }).strict()).max(12).default([]),
});

/**
 * Deterministic metrics are a production contract, not a menu of aspirational
 * measurements. Keep the critic's options aligned with what final QA actually
 * supplies for each renderer; otherwise a skipped assertion can look like a
 * passing review.
 */
const NARRATED_QA_METRICS = ["durationSec", "captionCoveragePct", "overlapSec"] as const;
const BASIC_QA_METRICS = ["durationSec"] as const;
const MUSIC_LOOP_QA_METRICS = ["durationSec", "loopSeamDiff"] as const;

const QA_METRICS_BY_FAMILY: Record<string, readonly string[]> = {
  narrated_stock: NARRATED_QA_METRICS,
  cinematic: NARRATED_QA_METRICS,
  sleep: NARRATED_QA_METRICS,
  shorts: NARRATED_QA_METRICS,
  music_loop: MUSIC_LOOP_QA_METRICS,
  documentary_collage_short: BASIC_QA_METRICS,
  whiteboard: BASIC_QA_METRICS,
  comic: BASIC_QA_METRICS,
  loreshort: BASIC_QA_METRICS,
  quizyear: BASIC_QA_METRICS,
};

/** Union retained for the existing catalog/UI export below. */
const KNOWN_METRICS = [...new Set(Object.values(QA_METRICS_BY_FAMILY).flat())];

export function measurableValidationMetricsForFamily(family: string): readonly string[] {
  return QA_METRICS_BY_FAMILY[family] ?? BASIC_QA_METRICS;
}

/**
 * An LLM can still request a metric it was told not to use. Remove malformed or
 * unsupported deterministic assertions before they become a release contract;
 * if nothing usable remains, `critic_spec` fails loudly instead of emitting a
 * spec whose only result would be "skipped".
 */
export function filterCriticAssertionsForQa(
  assertions: ValidationAssertion[],
  family: string,
  log: Logger = () => {},
): ValidationAssertion[] {
  const allowedMetrics = new Set(measurableValidationMetricsForFamily(family));
  return assertions.filter((assertion) => {
    if (assertion.check === "vision") return true;
    if (
      typeof assertion.metric !== "string" ||
      assertion.metric.length === 0 ||
      assertion.op === undefined ||
      typeof assertion.threshold !== "number" ||
      !Number.isFinite(assertion.threshold)
    ) {
      log(`crew/critic: dropping malformed deterministic assertion ${assertion.id}`);
      return false;
    }
    if (!allowedMetrics.has(assertion.metric)) {
      log(
        `crew/critic: dropping deterministic assertion ${assertion.id}; ` +
        `metric ${assertion.metric} is not measured for ${family}`,
      );
      return false;
    }
    return true;
  });
}

export async function briefCritic(bible: ShowBible, ctx: CrewContext): Promise<ValidationSpec | undefined> {
  const log = ctx.log ?? (() => {});
  const measurableMetrics = measurableValidationMetricsForFamily(ctx.family);
  try {
    const raw = await agentJson({
      role: "critic",
      schema: specSchema,
      log: (m) => log(m),
      // Reasoning route: the ceiling covers the thinking AND the list. Measured —
      // an agentJson list failed at 500 and passed at 1000; an 8-item ranking
      // failed at 1500 and passed at 2500. See scripts/audit-json-contract-ceilings.ts,
      // which could not see this call at all until it learned to resolve a schema
      // passed by reference.
      maxTokens: 2500,
      temperature: 0.5,
      prompt:
        `${header(bible, ctx)}\nFormat: ${ctx.family}.\n\n` +
        (bible.criticDoctrine ? `Your doctrine: ${bible.criticDoctrine}\n\n` : "") +
        `Author the VALIDATION SPEC this specific video must pass — AT MOST 12 assertions; pick only the ` +
        `dealbreakers (a 39-item spec is noise, not a gate). Each assertion: a stable id, a description, ` +
        `a check kind ("deterministic" for measurable checks, "vision" for judged ones), and a severity ` +
        `("block" = must pass, "warn" = nice-to-have).\n` +
        `For deterministic checks set metric/op/threshold. The executor can compute these metrics for THIS format ONLY: ` +
        `${measurableMetrics.join(", ")}. UNITS + CALIBRATION: captionCoveragePct = PERCENT of the video BODY that is ` +
        `spoken narration — deliberate inter-sentence pauses mean calm channels run 70-85, so use floors like >=60, ` +
        `NEVER >=90. durationSec/overlapSec are seconds — narration length varies, so bound durationSec generously ` +
        `(between 0.6x and 1.5x the target length, not a tight cap). ` +
        (measurableMetrics.includes("loopSeamDiff")
          ? `loopSeamDiff is 1 - first/last-frame SSIM (0 is best); use <= 0.12 for a clean visual loop. `
          : "") +
        `Use those exact metric names where they fit; otherwise use "vision". ` +
        `"vision" assertions are judged on sampled STILL FRAMES — only author vision checks that are visually ` +
        `assessable (never audio/music/voice/pacing).\n` +
        `Tailor to the format and the channel's dealbreakers (e.g. seamless loop for music loops; quotes ` +
        `present + caption coverage + no overlap for narrated essays; hook-in-2s for shorts). Return STRICT ` +
        `JSON {"assertions":[{"id","description","check","metric"?,"op"?,"threshold"?,"severity"}]}.`,
    });
    const assertions = filterCriticAssertionsForQa(
      raw.assertions ?? [],
      ctx.family,
      log,
    );
    if (assertions.length === 0) return undefined;
    const assertionIds = assertions.map((assertion) => assertion.id.toLowerCase());
    if (new Set(assertionIds).size !== assertionIds.length) {
      log("crew/critic: BRIEF REJECTED — assertion ids must be unique for verdict attribution");
      return undefined;
    }
    if (!assertions.some((assertion) => assertion.severity === "block")) {
      log("crew/critic: BRIEF REJECTED — the review spec contains no blocking dealbreaker");
      return undefined;
    }
    return { assertions };
  } catch (e) {
    // Returning undefined is the right degradation — a video without a critic
    // brief still renders. But the log has to say the brief is GONE, not just
    // echo a provider error, or a run that shipped with no review spec reads
    // exactly like a run that had them.
    log(`crew/critic: BRIEF UNAVAILABLE — this video gets no review spec from the critic: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

export { KNOWN_METRICS };
