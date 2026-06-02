/**
 * Script generation for narrated archetypes (essay / crime / shorts / meditation).
 * Gemini → a structured script (hook + sections + assembled narration text).
 * Pure helper; the `script_gen` block wraps it. Deterministic fallback so the
 * pipeline never hard-fails on a missing key (degrades to a thin script).
 */
import { geminiJson, hasGeminiKey } from "@/lib/gemini";

export interface ScriptSection {
  heading: string;
  narration: string;
}

export interface Script {
  hook: string;
  sections: ScriptSection[];
  /** Full narration text (hook + sections) ready for TTS. */
  narrationText: string;
  estDurationSec: number;
}

export interface ScriptRequest {
  topic: string;
  channelName?: string;
  persona?: string;
  styleGrammar?: string;
  niche?: string;
  /** Archetype tone: essay | crime | shorts | meditation | generic. */
  style?: string;
  /** Target spoken length; drives word budget (~2.5 words/sec). */
  maxSeconds?: number;
  /** End the narration with a concise recap/summary section (default true). */
  endWithSummary?: boolean;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

const WORDS_PER_SEC = 2.5;

function assemble(hook: string, sections: ScriptSection[]): string {
  return [hook, ...sections.map((s) => s.narration)]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n\n");
}

function estSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words / WORDS_PER_SEC);
}

function styleGuidance(style?: string): string {
  switch (style) {
    case "crime":
      return "True-crime / mystery tone: open on an unsettling hook, build tension, withhold-then-reveal, vivid sensory detail.";
    case "shorts":
      return "Punchy short-form: a 1-line scroll-stopping hook, then 3-5 fast escalating beats, payoff at the end. Tight.";
    case "meditation":
      return "Calm guided tone: slow, soothing, second-person, long gentle sentences, generous pauses (use ellipses).";
    default:
      return (
        "Engaging video-essay tone: a curiosity hook, then clear narrative sections with a satisfying arc. " +
        "Occasionally (when it genuinely fits — not every video) draw the viewer in with an immersive " +
        "second-person hypothetical or short illustrative story, e.g. \"Imagine you are alone in a room…\", " +
        "to make an abstract idea concrete and felt before explaining it."
      );
  }
}

export async function synthScript(
  req: ScriptRequest,
  log: Logger = () => {},
): Promise<Script> {
  const maxSeconds = req.maxSeconds ?? 240;
  const wordBudget = Math.round(maxSeconds * WORDS_PER_SEC);

  if (!hasGeminiKey()) {
    log("scriptGen: no Gemini key — thin fallback script");
    const hook = `Today: ${req.topic}.`;
    const sections = [{ heading: "Overview", narration: `Here is an overview of ${req.topic}.` }];
    const narrationText = assemble(hook, sections);
    return { hook, sections, narrationText, estDurationSec: estSeconds(narrationText) };
  }

  const prompt = [
    `Write a YouTube narration script about: "${req.topic}".`,
    req.channelName ? `Channel: ${req.channelName}.` : "",
    req.persona ? `Channel voice/persona: ${req.persona}` : "",
    req.niche ? `Niche: ${req.niche}.` : "",
    styleGuidance(req.style),
    `Target length: about ${maxSeconds} seconds (~${wordBudget} words of narration total).`,
    req.endWithSummary === false
      ? ""
      : "End with a FINAL section (heading like \"In Summary\") that recaps the key takeaway in 2-3 sentences, so the video closes with a clear, memorable wrap-up.",
    "Return STRICT JSON only:",
    `{
  "hook": string (the spoken opening line(s), <= 2 sentences, grabs attention),
  "sections": [ { "heading": string (short label), "narration": string (the spoken words for this section) } ]
}`,
    "The narration must be spoken words only — no stage directions, no markdown, no '[music]' cues.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: { hook?: unknown; sections?: unknown };
  try {
    raw = await geminiJson({ prompt, maxTokens: 4000, temperature: 0.8 });
  } catch (e) {
    log(`scriptGen: Gemini failed (${e instanceof Error ? e.message : e}) — fallback`);
    const hook = `Today: ${req.topic}.`;
    const sections = [{ heading: "Overview", narration: `An overview of ${req.topic}.` }];
    const narrationText = assemble(hook, sections);
    return { hook, sections, narrationText, estDurationSec: estSeconds(narrationText) };
  }

  const hook = typeof raw.hook === "string" ? raw.hook.trim() : "";
  const sections: ScriptSection[] = Array.isArray(raw.sections)
    ? raw.sections
        .map((s) => {
          const o = s as { heading?: unknown; narration?: unknown };
          return {
            heading: typeof o.heading === "string" ? o.heading : "",
            narration: typeof o.narration === "string" ? o.narration.trim() : "",
          };
        })
        .filter((s) => s.narration.length > 0)
    : [];

  if (sections.length === 0) {
    throw new Error("scriptGen: model returned no usable narration sections");
  }
  const narrationText = assemble(hook, sections);
  const script: Script = {
    hook: hook || sections[0].narration.slice(0, 120),
    sections,
    narrationText,
    estDurationSec: estSeconds(narrationText),
  };
  log("scriptGen: script ready", {
    sections: sections.length,
    words: narrationText.split(/\s+/).length,
    estSec: script.estDurationSec,
  });
  return script;
}
