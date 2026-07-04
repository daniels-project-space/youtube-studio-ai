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
import { agentJson } from "@/agents/mastra";
import type {
  ShowBible,
  StructureBrief,
  VisualBrief,
  CutSheet,
  AudioBrief,
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
    `Video topic: "${ctx.topic}".`,
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
      maxTokens: 1200,
      temperature: 0.8,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.directorDoctrine ? `Your doctrine: ${bible.directorDoctrine}\n\n` : "") +
        `Design this video's STRUCTURE: a scroll-stopping hook line, then an ordered beat map ` +
        `(name, intended on-screen seconds, and the emotional/narrative intent of each beat) that ` +
        `sums to roughly the target length and serves the channel's vibe. Return STRICT JSON ` +
        `{"hook":string,"beats":[{"name":string,"intentSec":number,"note":string}]}.`,
    });
    const beats = (raw.beats ?? []).filter((b) => b && b.name).map((b) => ({
      name: b.name.trim(), intentSec: Math.max(1, Math.round(b.intentSec || 0)), note: (b.note ?? "").trim(),
    }));
    if (!raw.hook && beats.length === 0) return undefined;
    return { hook: (raw.hook ?? "").trim(), beats };
  } catch (e) {
    log(`crew/director: ${e instanceof Error ? e.message : e}`);
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
      maxTokens: 1000,
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
    const queries = (raw.footageQueries ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 16);
    if (queries.length === 0 && !raw.promptStyle) return undefined;
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
    return {
      footageQueries: queries,
      promptStyle: clause(raw.promptStyle, 500),
      palette: (raw.palette ?? []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 5),
      motion: clause(raw.motion, 300),
      avoid: (raw.avoid ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    };
  } catch (e) {
    log(`crew/dp: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* ------------------------------- Editor -------------------------------- */

const cutSchema = z.object({
  sections: z.array(z.object({ name: z.string(), cutsPerMin: z.number() })).default([]),
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
      maxTokens: 900,
      temperature: 0.7,
      prompt:
        `${header(bible, ctx)}\n\n` +
        (bible.editorDoctrine ? `Your doctrine: ${bible.editorDoctrine}\n\n` : "") +
        `Cut this video. Provide: cut cadence per section (name + cuts per minute), the transition ` +
        `language, caption styling intent, and the overlay/quote-card placement rule. Match the channel's ` +
        `pace — calibrate cutsPerMin to real editing practice: contemplative/documentary 2-5, standard ` +
        `essay 4-7, energetic explainer 8-12 (a "deliberate, breathing" edit is NOT 8+ cuts/min). Return STRICT JSON ` +
        `{"sections":[{"name":string,"cutsPerMin":number}],"transitions":string,"captionStyle":string,"overlayRule":string}.`,
    });
    const sections = (raw.sections ?? []).filter((s) => s && s.name).map((s) => ({
      name: s.name.trim(), cutsPerMin: Math.max(0, s.cutsPerMin || 0),
    }));
    if (sections.length === 0 && !raw.transitions && !raw.captionStyle) return undefined;
    return {
      sections,
      transitions: (raw.transitions ?? "").trim(),
      captionStyle: (raw.captionStyle ?? "").trim(),
      overlayRule: (raw.overlayRule ?? "").trim(),
    };
  } catch (e) {
    log(`crew/editor: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* ------------------------------ Composer ------------------------------- */

const composerSchema = z.object({
  musicPrompt: z.string().default(""),
  duckDb: z.number().default(-12),
  bedLufs: z.number().default(-22),
  voiceFx: z.string().optional(),
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
      maxTokens: 700,
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
    log(`crew/composer: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/* ------------------------------- Critic -------------------------------- */

const specSchema = z.object({
  assertions: z.array(z.object({
    id: z.string(),
    description: z.string(),
    check: z.enum(["deterministic", "vision"]),
    metric: z.string().optional(),
    op: z.enum(["<", "<=", ">", ">=", "=="]).optional(),
    threshold: z.number().optional(),
    severity: z.enum(["block", "warn"]),
  })).default([]),
});

/** Known deterministic metrics the executor can actually compute (§ validate.ts). */
const KNOWN_METRICS = [
  "durationSec", "captionCoveragePct", "overlapSec", "loopSeamDiff", "bedLufs", "footageRepeatMaxRun",
];

export async function briefCritic(bible: ShowBible, ctx: CrewContext): Promise<ValidationSpec | undefined> {
  const log = ctx.log ?? (() => {});
  try {
    const raw = await agentJson({
      role: "critic",
      schema: specSchema,
      log: (m) => log(m),
      maxTokens: 1200,
      temperature: 0.5,
      prompt:
        `${header(bible, ctx)}\nFormat: ${ctx.family}.\n\n` +
        (bible.criticDoctrine ? `Your doctrine: ${bible.criticDoctrine}\n\n` : "") +
        `Author the VALIDATION SPEC this specific video must pass — AT MOST 12 assertions; pick only the ` +
        `dealbreakers (a 39-item spec is noise, not a gate). Each assertion: a stable id, a description, ` +
        `a check kind ("deterministic" for measurable checks, "vision" for judged ones), and a severity ` +
        `("block" = must pass, "warn" = nice-to-have).\n` +
        `For deterministic checks set metric/op/threshold. The executor can compute these metrics ONLY: ` +
        `${KNOWN_METRICS.join(", ")}. UNITS + CALIBRATION: captionCoveragePct = PERCENT of the video BODY that is ` +
        `spoken narration — deliberate inter-sentence pauses mean calm channels run 70-85, so use floors like >=60, ` +
        `NEVER >=90. durationSec/overlapSec are seconds — narration length varies, so bound durationSec generously ` +
        `(between 0.6x and 1.5x the target length, not a tight cap). bedLufs is LUFS (negative). ` +
        `Use those exact metric names where they fit; otherwise use "vision". ` +
        `"vision" assertions are judged on sampled STILL FRAMES — only author vision checks that are visually ` +
        `assessable (never audio/music/voice/pacing).\n` +
        `Tailor to the format and the channel's dealbreakers (e.g. seamless loop for music loops; quotes ` +
        `present + caption coverage + no overlap for narrated essays; hook-in-2s for shorts). Return STRICT ` +
        `JSON {"assertions":[{"id","description","check","metric"?,"op"?,"threshold"?,"severity"}]}.`,
    });
    const assertions = (raw.assertions ?? []).filter((a) => a && a.id && a.description);
    if (assertions.length === 0) return undefined;
    return { assertions };
  } catch (e) {
    log(`crew/critic: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

export { KNOWN_METRICS };
