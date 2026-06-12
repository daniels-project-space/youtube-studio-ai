/**
 * Script generation for narrated archetypes (essay / crime / shorts / meditation).
 * The cold open comes FIRST from hookcraft (judge-gated, topic-specific); the
 * latest Gemini Pro then writes the narration continuing from it. Pure helper;
 * the `script_gen` block wraps it. Failures are loud — no thin-script fallback.
 */
import { geminiJson, geminiJsonPro, scriptProModel, hasGeminiKey } from "@/lib/gemini";
import { CRAFT_RULES, resolveVoiceDoctrine, V3_TAG_PALETTES } from "@/engine/golden";
import { craftHook, type CraftedHook } from "@/lib/hookcraft";
import { scriptPlaybookDigest, type ScriptPlaybook } from "@/lib/scriptLab";

export interface ScriptSection {
  heading: string;
  narration: string;
  /** Structural role in the three-act arc (assigned positionally). */
  role?: "intro" | "body" | "outro";
}

/** Positional role assignment: first = intro, last = outro, rest = body. */
function assignRoles(sections: ScriptSection[]): ScriptSection[] {
  return sections.map((s, i) => ({
    ...s,
    role: i === 0 ? ("intro" as const) : i === sections.length - 1 ? ("outro" as const) : ("body" as const),
  }));
}

/**
 * The STORY-JOURNEY arc every script follows — sectioning as a pipeline law,
 * modeled on how Calm structures its sessions and programs: arrival ritual →
 * experience BEFORE explanation → one theme carried by one image → an
 * integration step that lands in the viewer's actual day → ritual close with
 * a quotable takeaway. Generalized for every channel archetype.
 */
const ARC_RULES =
  "STRUCTURE — write the sections as a STORY JOURNEY, not an essay outline:\n" +
  "- INTRO (first section) = ARRIVAL: it follows the cold open (never repeats it), re-anchors the viewer " +
  "in the channel's recognizable ritual shape, honors where the journey stands, and lays out today's path " +
  "in 60-120 words.\n" +
  "- BODY (middle sections) = THE JOURNEY: experience BEFORE explanation — drop the viewer into the " +
  "concrete scene, story, or practice FIRST and distill the principle only once they are inside it; never " +
  "open a movement with abstract theory. ONE theme and ONE carrying image/metaphor hold the entire episode " +
  "together — every movement returns to it from one layer DEEPER (progression, never lateral restarts). " +
  "Each movement is a story beat: a turn, a deepening, a small reveal.\n" +
  "- INTEGRATION (the movement before the outro): turn today's lesson into the viewer's ACTUAL day — one " +
  "concrete, immediately doable carry-out, stated plainly.\n" +
  "- OUTRO (final section) = THE LANDING: explicitly pay off the loop the cold open opened, close with the " +
  "channel's ritual (a practice, a meditation, a recap, a sign-off), and leave ONE quotable line that " +
  "distills the whole episode — the takeaway the viewer carries. Never a flat stop.";

/**
 * Formal series/program support (Calm-style progressive curriculum): each
 * episode is one facet of the program's theme, builds on yesterday, seeds
 * tomorrow, and lives inside the SAME ritual shell as every other episode.
 */
export interface SeriesContext {
  /** Program name, e.g. "7 Days of Gratitude". */
  name: string;
  /** 1-based episode number. */
  episode: number;
  total: number;
  /** What the previous episode taught / where it left the viewer. */
  previousSummary?: string;
  /** The thread to seed for the next episode (omit → a soft forward thread). */
  nextSeed?: string;
}

function seriesClause(series?: SeriesContext): string {
  if (!series) return "";
  const { episode, total } = series;
  const phase =
    episode === 1 ? "ORIENTATION: welcome the viewer into the program, establish the ritual shell and the journey's promise"
    : episode === total ? "GRADUATION: gather every thread of the program, land its deepest lesson, and send the viewer onward changed"
    : episode <= Math.ceil(total / 3) ? "FOUNDATION: build the core skill/idea one solid layer at a time"
    : episode >= total - 1 ? "APPLICATION: turn the program's lessons toward real life — this is where practice becomes habit"
    : "DEEPENING: go one honest layer deeper, including the uncomfortable part of the theme";
  return (
    `SERIES CONTEXT — this is episode ${episode} of ${total} of "${series.name}", an episodic program ` +
    `(Calm-style progressive curriculum). Episode phase: ${phase}.\n` +
    (series.previousSummary ? `The previous episode: ${series.previousSummary} — honor that thread early.\n` : "") +
    `Keep the program's ritual shell recognizable (the same arrival and closing shape as every episode). ` +
    `Near the end, seed the next episode: ${series.nextSeed ?? "leave one soft, curious thread forward"} — ` +
    `an invitation, never a cliffhanger that cheats today's closure.`
  );
}

export interface Script {
  hook: string;
  sections: ScriptSection[];
  /** Full narration text (hook + sections) ready for TTS. */
  narrationText: string;
  estDurationSec: number;
  /** A short, definitive closing line for the outro card (≤ 10 words). */
  closingLine?: string;
  /** The promise the cold open made — qa_script verifies the script pays it off. */
  hookLoop?: string;
}

export interface ScriptRequest {
  topic: string;
  channelName?: string;
  persona?: string;
  styleGrammar?: string;
  niche?: string;
  /** Archetype tone: essay | crime | shorts | meditation | generic. */
  style?: string;
  /** Spoken language (BCP-47-ish: en | es | de | …). Default English. */
  language?: string;
  /** Target spoken length; drives word budget (~2.5 words/sec). */
  maxSeconds?: number;
  /** End the narration with a concise recap/summary section (default true). */
  endWithSummary?: boolean;
  /** Director (crew) structure brief: a hook + ordered beats to follow. */
  structure?: { hook?: string; beats?: { name: string; note?: string }[] };
  /**
   * The narration block's inter-sentence pause (sec). Folded into the word
   * budget so target length accounts for REAL pacing, not just speech rate —
   * without it a 150-sentence script overshoots its slot by ~2 minutes.
   */
  sentenceGapSec?: number;
  /** Narration speed multiplier (×0.94 documentary voice etc.) — folded into
   * the word budget; without it a slowed voice overshoots the slot ~15%. */
  ttsSpeed?: number;
  /** Channel voice is ElevenLabs v3: write inline [audio tags] (performed,
   * not read) and PRESERVE them through sanitization. */
  voiceTags?: boolean;
  /** Critic issues from a rejected prior draft — the regen must fix these. */
  priorIssues?: string[];
  /**
   * The channel's Style-DNA narrative spec — the per-channel register the
   * script must be written in (beats the generic per-archetype tone).
   */
  narrative?: { scriptStyle?: string; hookStyle?: string; pacing?: string; delivery?: string };
  /**
   * The channel renders spoken numbers as on-screen motion graphics
   * (visual_inserts) — the script must SPEAK concrete, attributable figures.
   */
  dataRich?: boolean;
  /**
   * Script Lab playbook (hook rules + opening devices distilled from WATCHING
   * the niche's top-view videos). One opening device is assigned per video.
   */
  playbook?: ScriptPlaybook;
  openingDeviceIdx?: number;
  /** Episodic program context (Calm-style progressive curriculum). */
  series?: SeriesContext;
}

/** Per-request sanitize that PRESERVES audio tags on v3-voiced channels. */
function spoken(req: ScriptRequest, text: string): string {
  return sanitizeSpoken(text, { keepAudioTags: req.voiceTags === true });
}

/**
 * ElevenLabs v3 audio-tag writing guidance — emitted ONLY when the channel's
 * voice performs them (otherwise tags would be read aloud / stripped). Built
 * on the official v3 prompting guide: tags must match what the voice can
 * CREDIBLY perform, pacing comes from punctuation/structure (v3 has no break
 * tags), ellipses add weight, strategic caps add emphasis, and tags never
 * describe physical actions or alter the text's meaning.
 */
function voiceTagClause(req: ScriptRequest): string {
  if (!req.voiceTags) return "";
  // Channel-aware gesture palette: the voice archetype decides which tags the
  // narrator can credibly perform (a gentle guide whispers; it never [laughs]).
  const doctrine = resolveVoiceDoctrine(req.niche);
  const palette =
    (doctrine && V3_TAG_PALETTES[doctrine.voice]) ||
    "[pause] [long pause] [sighs] [exhales] [seriously] [slowly] [emphatic] [thoughtful]";
  return [
    `AUDIO DELIVERY TAGS: the narration voice (ElevenLabs v3) PERFORMS bracketed delivery directions placed ` +
      `inline in the text — it never reads them aloud. This channel's voice can credibly perform ONLY this ` +
      `palette${doctrine ? ` (its "${doctrine.voice}" character)` : ""}: ${palette}.`,
    `Placement rules: a tag goes immediately BEFORE the words it should color; at most ONE tag per 3-4 ` +
      `sentences and only where the moment earns it (a number landing, a turn in the argument, a confession, ` +
      `the breath before a reveal); never stack tags; never invent tags outside the palette; never put a tag ` +
      `inside an attributed quote; never tag physical actions or sounds ([standing], [music], [applause]).`,
    `Pacing & emphasis (v3 has no break tags — the TEXT carries the rhythm): use ellipses (...) for weighted ` +
      `pauses, sentence breaks and short paragraphs for pacing, and OCCASIONAL strategic capitalization of a ` +
      `single load-bearing word for emphasis (sparingly — once per section at most). Tags color the delivery; ` +
      `they must never replace or alter the spoken words themselves.`,
  ].join(" ");
}

/** Full playbook guidance (hook + assigned device + retention + voice). */
function playbookFull(req: ScriptRequest): string {
  return req.playbook ? scriptPlaybookDigest(req.playbook, req.openingDeviceIdx ?? 0) : "";
}

/** The hookcraft cold open is LAW for the script writer — continue, never repeat. */
function hookMandate(crafted: CraftedHook): string {
  return (
    `THE COLD OPEN IS ALREADY WRITTEN (device: ${crafted.device}) and will be SPOKEN before your first ` +
    `section — do NOT repeat, rephrase, or re-introduce it:\n"${crafted.coldOpen}"\n` +
    `Your FIRST section must continue seamlessly from where it leaves off, and the script MUST explicitly ` +
    `pay off this promise the cold open made: "${crafted.loop}".`
  );
}

/** Slim slice for per-section calls (voice + never — the hook is already set). */
function playbookSlim(req: ScriptRequest): string {
  const p = req.playbook;
  if (!p) return "";
  return [
    p.voiceRules.length ? `VOICE RULES:\n- ${p.voiceRules.join("\n- ")}` : "",
    p.avoid.length ? `NEVER:\n- ${p.avoid.join("\n- ")}` : "",
  ].filter(Boolean).join("\n");
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

// Calibrated to the ACTUAL TTS speaking rate (Fish/etc. read ~3.0-3.3 w/s, NOT the
// 2.5 we assumed) — at 2.5 the word budget was ~20-25% too small, so every long-form
// video came out short and failed length_check. Env-tunable (set NARRATION_WPS in the
// vault to fine-tune per voice).
const WORDS_PER_SEC = Number(process.env.NARRATION_WPS) || 3.1;

/**
 * Strip anything the TTS would read aloud as a symbol. Models occasionally leak
 * markdown (*bold*, _italic_, # heading), bracketed stage directions ([music],
 * (pause)), or slashes ("and/or" → "...slash...") into narration. Remove them so
 * the voice never says "asterisk" / "slash" / "hashtag". Spoken text only.
 */
export function sanitizeSpoken(text: string, opts?: { keepAudioTags?: boolean }): string {
  return (
    // ElevenLabs v3 channels keep their bracketed AUDIO TAGS ([pause], [sighs],
    // [whispers]…) — the voice PERFORMS them. Everyone else strips brackets.
    (opts?.keepAudioTags ? text : text.replace(/\[[^\]]*\]/g, " "))
    .replace(/\((?:pause|beat|music|sfx|silence|sound[^)]*|[^)]*\bcue\b[^)]*)\)/gi, " ")
    // markdown emphasis / heading / code / quote markers
    .replace(/[*_`~#>|]/g, "")
    // list bullets at line start
    .replace(/^\s*[-•]\s+/gm, "")
    // slashes read as "slash": "and/or" -> "and or", "24/7" -> "24 7"
    .replace(/\s*\/\s*/g, " ")
    // leftover backslashes / carets
    .replace(/[\\^]/g, "")
    // collapse whitespace (preserve paragraph breaks)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  );
}

/** Strip structure-scaffold prefixes the model leaks into chapter headings. */
function cleanHeading(h: string): string {
  return h
    .replace(/^\s*(?:beat|section|part|chapter)\s*\d+\s*[:.\-–—]\s*/i, "")
    .replace(/^\s*(?:arrival|the journey|journey|integration|the landing|landing|intro|body|outro)\s*[:.\-–—]\s*/i, "")
    .trim();
}

function assemble(hook: string, sections: ScriptSection[]): string {
  return [hook, ...sections.map((s) => s.narration)]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n\n");
}

// CRAFT_RULES targets <15-word sentences; ~14 is the observed mean.
const AVG_WORDS_PER_SENTENCE = 14;

/**
 * Effective speaking rate INCLUDING the per-sentence pause the TTS block adds.
 * gap=0.85s at 3.1 w/s → ~2.7 effective w/s; ignoring it over-budgets every
 * script by 10-20%.
 */
function effectiveWps(gapSec = 0, ttsSpeed = 1): number {
  const g = Math.max(0, gapSec);
  const speed = Math.min(1.3, Math.max(0.7, ttsSpeed || 1));
  // The voice-speed multiplier scales the SPEECH rate, not the pauses.
  return 1 / (1 / (WORDS_PER_SEC * speed) + g / AVG_WORDS_PER_SENTENCE);
}

function estSeconds(text: string, gapSec = 0, ttsSpeed = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words / effectiveWps(gapSec, ttsSpeed));
}

const LANG_NAMES: Record<string, string> = {
  es: "Spanish", de: "German", fr: "French", pt: "Portuguese", it: "Italian", nl: "Dutch",
};
/** Appended to script prompts so the SPOKEN text is written in the target language. */
function langDirective(language?: string): string {
  if (!language || language === "en") return "";
  const name = LANG_NAMES[language] ?? language;
  return ` IMPORTANT: Write ALL spoken narration text in ${name}. Names/quotes keep their original form but the surrounding narration is in ${name}.`;
}

function styleGuidance(req: ScriptRequest): string {
  const { style, language, narrative, niche } = req;
  // The channel's OWN narrative DNA outranks the generic per-archetype tone —
  // a finance documentary channel must not inherit the stoic-essay register.
  const dnaClause = narrative && (narrative.scriptStyle || narrative.hookStyle || narrative.delivery)
    ? "WRITE IN THIS CHANNEL'S LOCKED NARRATIVE REGISTER (it overrides any generic tone below): " +
      [
        narrative.scriptStyle ? `script style: ${narrative.scriptStyle}` : "",
        narrative.hookStyle ? `hook style: ${narrative.hookStyle}` : "",
        narrative.delivery ? `delivery: ${narrative.delivery}` : "",
        narrative.pacing ? `pacing: ${narrative.pacing}` : "",
      ].filter(Boolean).join(" | ") + " "
    : "";
  // The niche's voice ARCHETYPE — how this KIND of channel sounds (history =
  // narrator who teaches, finance = calm teacher-advisor, chaos = loudest
  // verified fact first). Sits beneath the DNA register, above the base tone.
  const doctrine = resolveVoiceDoctrine(niche);
  const doctrineClause = doctrine
    ? `VOICE ARCHETYPE "${doctrine.voice}" — the whole narration must sound like this: ${doctrine.tone} `
    : "";
  return dnaClause + doctrineClause + styleGuidanceBase(style) + langDirective(language);
}

/**
 * Channels with a data-viz layer must SPEAK numbers — vague "studies show"
 * hedging gives the on-screen charts nothing to render (and reads as filler).
 */
export function dataDiscipline(dataRich?: boolean): string {
  return dataRich
    ? "DATA DISCIPLINE: this channel renders spoken numbers as on-screen motion graphics. Work 3-6 CONCRETE, " +
      "well-established figures into the narration at key moments — dollar amounts, percentages, year ranges, " +
      "before/after comparisons — each spoken plainly in its own sentence with its source named in the narration " +
      "(e.g. \"according to Vanguard's 2024 study…\"). Use widely-documented real figures only; NEVER invent " +
      "statistics, and never hedge with vague phrases like \"studies consistently show\". "
    : "";
}

function styleGuidanceBase(style?: string): string {
  switch (style) {
    case "crime":
      return "True-crime / mystery tone: open on an unsettling hook, build tension, withhold-then-reveal, vivid sensory detail.";
    case "shorts":
      return "Punchy short-form: a 1-line scroll-stopping hook, then 3-5 fast escalating beats, payoff at the end. Tight.";
    case "meditation":
      return "Calm guided tone: slow, soothing, second-person, long gentle sentences, generous pauses (use ellipses).";
    default:
      // Channel-AGNOSTIC essay tone. (This used to mandate two Stoic-philosopher
      // quotes for every "generic" channel — finance/health/tech videos were
      // being told to quote Marcus Aurelius.)
      return (
        "Engaging video-essay tone: a curiosity hook, then clear narrative sections with a satisfying arc. " +
        "Occasionally (when it genuinely fits — not every video) draw the viewer in with an immersive " +
        "second-person hypothetical or short illustrative story to make an abstract idea concrete and felt " +
        "before explaining it. When it strengthens the video, weave in 1-2 short, ACCURATELY ATTRIBUTED " +
        "quotes or data points from credible figures/sources RELEVANT TO THIS TOPIC AND NICHE (a philosopher " +
        "for philosophy, an investor or economist for finance, a researcher for health…). Introduce each " +
        "naturally in the spoken narration; use genuine quotes only, keep them concise."
      );
  }
}

/**
 * ONE-SHOT long script via a capable long-context model (Gemini 2.5 Pro by default;
 * set GEMINI_SCRIPT_MODEL to point at a newer model like gemini-3-pro). Pro supports
 * tens of thousands of output tokens, so it writes a full 15-35 min script in a
 * SINGLE call — no flaky section-by-section stitching. Returns null if it errors or
 * under-delivers, so the caller falls back to chunked generation.
 */
async function synthFullScriptOneShot(
  req: ScriptRequest,
  crafted: CraftedHook,
  maxSeconds: number,
  wordBudget: number,
  log: Logger,
): Promise<Script | null> {
  const model = scriptProModel();
  const minWords = Math.round(wordBudget * 0.85);
  // Time-box the one-shot so a slow/overloaded Pro call can't stall script_gen for
  // 15+ min — on timeout we fall back to chunked generation. maxTokens sized to a
  // full long-form script (~10k words) + thinking, not the old bloated 48k.
  const ONE_SHOT_TIMEOUT_MS = Number(process.env.SCRIPT_ONESHOT_TIMEOUT_MS ?? 300_000);
  try {
    const o = await Promise.race([
      geminiJson<{ sections?: { heading?: string; narration?: string }[]; closing_line?: string }>({
      model,
      maxTokens: 22000,
      temperature: 0.8,
      prompt: [
        `Write a COMPLETE long-form YouTube narration script about "${req.topic}".`,
        req.channelName ? `Channel: ${req.channelName}.` : "",
        req.persona ? `Channel voice/persona: ${req.persona}` : "",
        req.niche ? `Niche: ${req.niche}.` : "",
        hookMandate(crafted),
        seriesClause(req.series),
        styleGuidance(req) + dataDiscipline(req.dataRich),
        playbookFull(req),
        voiceTagClause(req),
        CRAFT_RULES,
        ARC_RULES,
        `TARGET LENGTH: about ${Math.round(maxSeconds / 60)} minutes of SPOKEN narration — roughly ${wordBudget} words ` +
          `TOTAL. This is a HARD requirement: the script MUST total at least ${minWords} words across the sections. Do ` +
          `NOT stop short — write the FULL length as 8-18 substantive sections, each developing a distinct idea in depth ` +
          `(about 250-450 words each).`,
        `End with a CONCLUSION section that lands on a single, definitive closing sentence.`,
        `PLAIN SPOKEN text only — no markdown, asterisks, slashes, or bracketed cues. ` +
          `Return STRICT JSON {"sections":[{"heading":string,"narration":string}],"closing_line":string}.`,
      ].filter(Boolean).join("\n\n"),
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`scriptGen one-shot timed out after ${ONE_SHOT_TIMEOUT_MS}ms`)), ONE_SHOT_TIMEOUT_MS)),
    ]) as { sections?: { heading?: string; narration?: string }[]; closing_line?: string };
    const sections: ScriptSection[] = (o.sections ?? [])
      .map((s) => ({ heading: cleanHeading(typeof s.heading === "string" ? s.heading : ""), narration: spoken(req, typeof s.narration === "string" ? s.narration : "") }))
      .filter((s) => s.narration.length > 0);
    const wordCount = sections.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
    if (sections.length < 3 || wordCount < minWords) {
      log(`scriptGen one-shot (${model}): ${wordCount}/${wordBudget} words, ${sections.length} sections — under target, falling back to chunked`);
      return null;
    }
    const hook = spoken(req, crafted.coldOpen);
    const closingLine = typeof o.closing_line === "string" ? sanitizeSpoken(o.closing_line).replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const narrationText = assemble(hook, sections);
    log(`scriptGen one-shot (${model}): ${sections.length} sections, ${wordCount} words (~${estSeconds(narrationText)}s) ✓`);
    return { hook, sections: assignRoles(sections), narrationText, estDurationSec: estSeconds(narrationText), closingLine, hookLoop: crafted.loop };
  } catch (e) {
    log(`scriptGen one-shot (${model}) failed (${e instanceof Error ? e.message : e}) — falling back to chunked`);
    return null;
  }
}

/**
 * Long-form scripts (15-35 min). PRIMARY path is the one-shot capable-model call
 * above; if that under-delivers/errors we fall back to chunked generation (outline
 * → per-section, with retries) so we always produce something of the right length.
 */
async function synthLongScript(
  req: ScriptRequest,
  crafted: CraftedHook,
  maxSeconds: number,
  wordBudget: number,
  log: Logger,
): Promise<Script> {
  // PRIMARY: one capable-model call writes the whole script reliably.
  const oneShot = await synthFullScriptOneShot(req, crafted, maxSeconds, wordBudget, log);
  if (oneShot) return oneShot;

  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  // Models reliably under-deliver on word count, so over-provision sections and
  // keep generating until we actually REACH the target (then stop to avoid
  // overshooting the length gate). Assume ~200 real words/section.
  const planSections = async (n: number, exclude: string[]): Promise<{ heading: string; brief: string }[]> => {
    try {
      const o = await geminiJson<{ sections?: { heading?: string; brief?: string }[] }>({
        prompt: [
          `Plan ${n} DISTINCT, non-repeating sections for a long narrated video about "${req.topic}".`,
          req.persona ? `Persona: ${req.persona}` : "",
          req.niche ? `Niche: ${req.niche}` : "",
          seriesClause(req.series),
          styleGuidance(req) + dataDiscipline(req.dataRich),
          exclude.length
            ? `Already covered (do NOT repeat): ${exclude.join("; ")}`
            : `The FIRST planned section is the INTRO (orients the viewer and lays out the map after the ` +
              `cold open); the rest are BODY movements that build in a deliberate order. (The outro/` +
              `conclusion is written separately.)`,
          `Each: a heading + a 1-2 sentence brief. Return STRICT JSON {"sections":[{"heading":string,"brief":string}]}.`,
        ].filter(Boolean).join("\n\n"),
        maxTokens: 2000,
        temperature: 0.9,
      });
      return (o.sections ?? []).filter((s): s is { heading: string; brief: string } => Boolean(s && typeof s.heading === "string"));
    } catch (e) {
      log(`scriptGen long: outline chunk failed (${e instanceof Error ? e.message : e})`);
      return [];
    }
  };

  // The cold open comes pre-crafted and judge-gated (hookcraft); only the
  // closing line is generated here. The director's hook intent was already
  // honored INSIDE hookcraft as the directorIdea.
  const hookRaw = crafted.coldOpen;
  let closingRaw = "";
  try {
    const head = await geminiJson<{ closing_line?: string }>({
      prompt:
        `For a long video about "${req.topic}"${req.niche ? ` (${req.niche})` : ""}: write closing_line — ` +
        `THE QUOTE of the episode: one resonant, quotable line (<=12 words) that distills its lesson, shown ` +
        `on the outro card as the takeaway. ${styleGuidance(req)}\n` +
        `Return STRICT JSON {"closing_line":string}.`,
      maxTokens: 300,
      temperature: 0.85,
    });
    closingRaw = typeof head.closing_line === "string" ? head.closing_line : "";
  } catch { /* fallback below */ }

  const targetWords = Math.round(wordBudget * 0.95);
  const beats = req.structure?.beats?.filter((b) => b.name?.trim()) ?? [];
  let queue = beats.length
    ? beats.map((b) => ({ heading: b.name.trim(), brief: (b.note ?? "").trim() || b.name.trim() }))
    : await planSections(Math.max(8, Math.min(30, Math.ceil(wordBudget / 200))), []);
  if (queue.length === 0) throw new Error("scriptGen: long-form outline produced no sections");

  const sections: ScriptSection[] = [];
  let total = 0;
  let i = 0;
  let refills = 0;
  while (total < targetWords && sections.length < 60) {
    if (i >= queue.length) {
      if (refills >= 12) break;
      refills++;
      const more = await planSections(8, sections.map((s) => s.heading));
      if (more.length === 0) break;
      queue = queue.concat(more);
    }
    const s = queue[i++];
    const reachingEnd = total >= targetWords * 0.85;
    // BUDGETED sections: a flat "250-400 words" per section overshot short
    // budgets by ~40% (7 sections × ~257w against a 1285w budget → a 15-min
    // video for a 10-min slot). Each section gets its fair share of what's left.
    const remainingSections = Math.max(1, Math.min(queue.length - i + 1, 60 - sections.length));
    const perSection = Math.max(140, Math.min(400, Math.round((targetWords - total) / remainingSections)));
    const sectionPrompt = [
      `You are writing ONE section of a long narrated video about "${req.topic}".`,
      `Section: "${s.heading}". Focus: ${s.brief ?? s.heading}.`,
      sections.length === 0 ? hookMandate(crafted) : "",
      styleGuidance(req) + dataDiscipline(req.dataRich),
      playbookSlim(req),
      voiceTagClause(req),
      CRAFT_RULES,
      `Write ${perSection}-${Math.min(400, perSection + 80)} words of SPOKEN narration in 2-3 FULL paragraphs for ` +
        `THIS section only — substantive and specific, no heading label, do not repeat earlier sections.`,
      reachingEnd ? "This is the FINAL section: end on a single, definitive closing sentence." : "",
      "PLAIN SPOKEN text only — no markdown, asterisks, slashes, or bracketed cues.",
      `Return STRICT JSON {"narration":string}.`,
    ].filter(Boolean).join("\n\n");
    // RETRY transient failures — a dropped section used to permanently lose ~300
    // words, which is the main reason long videos came out short under model load.
    let added = false;
    for (let attempt = 0; attempt < 3 && !added; attempt++) {
      try {
        // Narration is written by the latest Gemini Pro (best at narration);
        // the floored budget covers Pro's thinking overhead.
        const r = await geminiJsonPro<{ narration?: string }>({ prompt: sectionPrompt, maxTokens: 6500, temperature: 0.82, log });
        const narration = spoken(req, typeof r.narration === "string" ? r.narration : "");
        if (narration.length > 0) {
          sections.push({ heading: s.heading, narration });
          total += words(narration);
          added = true;
        }
      } catch (e) {
        log(`scriptGen long: section "${s.heading}" attempt ${attempt + 1}/3 failed (${e instanceof Error ? e.message : e})`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    log(`scriptGen long: ${sections.length} sections, ${total}/${targetWords} words`);
  }
  if (sections.length === 0) throw new Error("scriptGen: long-form produced no narration");

  // Always finish with a dedicated CONCLUSION that rounds off the topic and brings
  // the most important points back. narration_tts renders the LAST section WITHOUT
  // a chapter card, so this flows as the spoken ending (no "Chapter N:" separation).
  try {
    const covered = sections.map((s) => s.heading).filter(Boolean).slice(0, 12).join("; ");
    const c = await geminiJsonPro<{ narration?: string }>({
      log,
      prompt: [
        `Write the CLOSING CONCLUSION (about 180-260 words, 2-3 short paragraphs) for a long narrated video about "${req.topic}".`,
        seriesClause(req.series),
        styleGuidance(req) + dataDiscipline(req.dataRich),
        `This is the emotional landing of the whole video — it must feel deliberate, rounded, and SATISFYING, never like it just stops. Build it as a clear arc:`,
        `1) A soft signal that we are arriving at the end (a reflective turn, NOT the words "in conclusion" / "to sum up" / "in summary").`,
        covered
          ? `2) Briefly draw the 2-3 MOST IMPORTANT threads back together so the listener feels the journey resolve: ${covered}.`
          : `2) Briefly draw the most important threads of the video back together so the listener feels the journey resolve.`,
        `3) Distill it all into ONE clear central takeaway, stated plainly and memorably.`,
        `4) Turn outward to the listener with a warm, forward-looking thought they carry away — what to do, feel, or remember.`,
        closingRaw
          ? `5) End on a SINGLE short, resonant, definitive final sentence that lands with weight (in the spirit of: "${closingRaw}"). Never trail off mid-idea.`
          : `5) End on a SINGLE short, resonant, definitive final sentence that lands with weight. Never trail off mid-idea.`,
        `Do NOT introduce any brand-new concept, statistic, or chapter label. No questions in the final sentence.`,
        "PLAIN SPOKEN text only — no markdown, asterisks, slashes, or bracketed cues.",
        `Return STRICT JSON {"narration":string}.`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1500,
      temperature: 0.78,
    });
    const cn = spoken(req, typeof c.narration === "string" ? c.narration : "");
    if (cn.length > 0) sections.push({ heading: "Conclusion", narration: cn });
  } catch (e) {
    log(`scriptGen long: conclusion failed (${e instanceof Error ? e.message : e})`);
  }

  const hook = spoken(req, hookRaw);
  const closingLine = sanitizeSpoken(closingRaw).replace(/\s+/g, " ").trim().slice(0, 80);
  const narrationText = assemble(hook, sections);
  log("scriptGen: long script ready", { sections: sections.length, words: narrationText.split(/\s+/).length, estSec: estSeconds(narrationText) });
  return { hook, sections: assignRoles(sections), narrationText, estDurationSec: estSeconds(narrationText), closingLine, hookLoop: crafted.loop };
}

/** Translate one spoken passage; keep names/quotes intact. Degrades to original. */
async function translateText(text: string, langName: string, log: Logger): Promise<string> {
  const t = (text ?? "").trim();
  if (!t) return "";
  try {
    const o = await geminiJson<{ translation?: string }>({
      prompt:
        `Translate this spoken narration into ${langName}. Keep proper names and direct quotes in their ` +
        `ORIGINAL form (do NOT translate names). Natural, fluent ${langName} suitable for voiceover. ` +
        `Return STRICT JSON {"translation":string}.\n\nTEXT:\n${t}`,
      maxTokens: 2200,
      temperature: 0.3,
    });
    return sanitizeSpoken(typeof o.translation === "string" ? o.translation : t);
  } catch (e) {
    log(`scriptGen translate failed (keeping original): ${e instanceof Error ? e.message : e}`);
    return t;
  }
}

/**
 * Render-group reuse: translate an existing EN script into another language
 * instead of regenerating it, so sibling channels reuse the base's structure +
 * research and only the words change. Section headings (chapter cards) + closing
 * line are translated too. No-op for English / no key.
 */
export async function translateScript(
  script: Script,
  language: string | undefined,
  log: Logger = () => {},
): Promise<Script> {
  if (!language || language === "en" || !hasGeminiKey()) return script;
  const name = LANG_NAMES[language] ?? language;
  log(`scriptGen: translating ${script.sections.length}-section script → ${name}`);
  const hook = await translateText(script.hook, name, log);
  const sections: ScriptSection[] = [];
  for (const s of script.sections) {
    sections.push({
      heading: await translateText(s.heading, name, log),
      narration: await translateText(s.narration, name, log),
    });
  }
  const closingLine = script.closingLine ? await translateText(script.closingLine, name, log) : undefined;
  const narrationText = assemble(hook, sections);
  return { hook, sections, narrationText, estDurationSec: estSeconds(narrationText), closingLine };
}

export async function synthScript(
  req: ScriptRequest,
  log: Logger = () => {},
): Promise<Script> {
  const maxSeconds = req.maxSeconds ?? 240;
  const gapSec = req.sentenceGapSec ?? 0;
  // Speed multiplier folded in — a 0.94× documentary voice on a 1.0× budget
  // overshot the slot ~15% (render #6: 848s actual vs 660s target).
  const wordBudget = Math.round(maxSeconds * effectiveWps(gapSec, req.ttsSpeed ?? 1));

  if (!hasGeminiKey()) {
    // NO silent thin-fallback: a one-sentence "script" used to ship as a full
    // video. A missing script model is a real failure — surface it.
    throw new Error("scriptGen: GEMINI_API_KEY missing — cannot write a real script (no fallback)");
  }

  // THE COLD OPEN COMES FIRST — crafted and judge-gated by hookcraft (lint +
  // punch/specificity/curiosity/voiceMatch gates, one retry, loud fail). The
  // director's hook idea is honored INSIDE the craft as intent, never verbatim.
  const crafted = await craftHook({
    topic: req.topic,
    channelName: req.channelName,
    niche: req.niche,
    persona: req.persona,
    narrative: req.narrative,
    style: req.style,
    playbookDigest: playbookFull(req) || undefined,
    directorIdea: req.structure?.hook?.trim() || undefined,
    seriesNote: req.series
      ? `episode ${req.series.episode} of ${req.series.total} of "${req.series.name}"` +
        (req.series.previousSummary ? `; the previous episode: ${req.series.previousSummary}` : "")
      : undefined,
    language: req.language,
    voiceTags: req.voiceTags,
    log: (m) => log(m),
  });

  // Long-form (>~7 min) needs chunked generation — one call can't write it.
  if (maxSeconds > 420) {
    return synthLongScript(req, crafted, maxSeconds, wordBudget, log);
  }

  // Director (crew) structure: beats respected in SHORT-form too (the hook
  // idea already went through hookcraft above).
  const structureClause = req.structure?.beats?.length
    ? [
        "FOLLOW THIS DIRECTOR'S STRUCTURE:",
        ...(req.structure?.beats ?? [])
          .filter((b) => b.name?.trim())
          .map((b, i) => `Beat ${i + 1}: ${b.name.trim()}${b.note?.trim() ? ` — ${b.note.trim()}` : ""}`),
      ].filter(Boolean).join("\n")
    : "";

  const prompt = [
    `Write a YouTube narration script about: "${req.topic}".`,
    req.channelName ? `Channel: ${req.channelName}.` : "",
    req.persona ? `Channel voice/persona: ${req.persona}` : "",
    req.niche ? `Niche: ${req.niche}.` : "",
    hookMandate(crafted),
    seriesClause(req.series),
    styleGuidance(req) + dataDiscipline(req.dataRich),
    playbookFull(req),
    voiceTagClause(req),
    ARC_RULES,
    structureClause,
    req.priorIssues?.length
      ? `A previous draft was REJECTED by the channel's critic for these issues — this draft MUST fix every one:\n` +
        req.priorIssues.map((i) => `- ${i}`).join("\n")
      : "",
    CRAFT_RULES,
    `Target length: about ${maxSeconds} seconds — write the FULL length, roughly ${wordBudget} words of ` +
      `narration total (do NOT stop short; aim for at least ${Math.round(wordBudget * 0.9)} words across the sections).`,
    req.endWithSummary === false
      ? ""
      : "End with a FINAL section (heading like \"In Summary\") that recaps the key takeaway in 2-3 sentences.",
    "ENDING AWARENESS: the video holds a brief OUTRO card after the narration, so the narration must land on a " +
      "single DEFINITIVE closing sentence — a clean, conclusive final thought, never trailing off mid-idea. Then " +
      "provide closing_line: THE QUOTE of the episode — one resonant, quotable line (≤ 12 words) that distills " +
      "today's lesson, shown on the outro card as the takeaway the viewer carries.",
    "Return STRICT JSON only:",
    `{
  "sections": [ { "heading": string (short label), "narration": string (the spoken words for this section) } ],
  "closing_line": string (<= 12 words — THE QUOTE: the episode's lesson distilled, quotable)
}`,
    "CRITICAL: the narration is fed directly to a text-to-speech voice. Output PLAIN SPOKEN text ONLY. " +
      "Do NOT use asterisks, slashes, underscores, hashes, backticks, bullet points, markdown, emphasis " +
      "symbols, or bracketed stage directions like [music] or (pause) — the voice would read those symbols " +
      "out loud. Write numbers and abbreviations the way they should be spoken. Sentences and natural " +
      "punctuation (. , ? ! ... ) only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Latest Gemini Pro writes the narration (best at narration); the wrapper
  // retries transients and floors the budget for Pro thinking. A persistent
  // failure must FAIL the block — never ship a one-line placeholder script.
  // 13k: Pro's thinking eats the budget first — at 8k a ~1300-word script's
  // JSON came back truncated mid-string (unrepairable).
  const raw = (await geminiJsonPro({ prompt, maxTokens: 13000, temperature: 0.8, log: (m) => log(m) })) as {
    sections?: unknown;
  };

  const rawClosing = (raw as { closing_line?: unknown }).closing_line;
  const closingLine =
    typeof rawClosing === "string" ? sanitizeSpoken(rawClosing).replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const hook = spoken(req, crafted.coldOpen);
  const sections: ScriptSection[] = Array.isArray(raw.sections)
    ? raw.sections
        .map((s) => {
          const o = s as { heading?: unknown; narration?: unknown };
          return {
            heading: cleanHeading(typeof o.heading === "string" ? o.heading : ""),
            narration: typeof o.narration === "string" ? spoken(req, o.narration) : "",
          };
        })
        .filter((s) => s.narration.length > 0)
    : [];

  if (sections.length === 0) {
    throw new Error("scriptGen: model returned no usable narration sections");
  }
  const narrationText = assemble(hook, sections);
  const script: Script = {
    hook,
    sections: assignRoles(sections),
    narrationText,
    estDurationSec: estSeconds(narrationText, gapSec),
    closingLine,
    hookLoop: crafted.loop,
  };
  log("scriptGen: script ready", {
    sections: sections.length,
    words: narrationText.split(/\s+/).length,
    estSec: script.estDurationSec,
  });
  return script;
}
