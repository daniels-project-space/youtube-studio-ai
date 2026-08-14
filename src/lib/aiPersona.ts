/**
 * aiPersona — the "What would AI do?" / "AI POV" prompt surface.
 *
 * ONE job: supply the PROMPT TEMPLATES for speculative-hypothetical narration,
 * plus the topic seeds those episodes are chosen from. It writes nothing,
 * calls nothing and renders nothing — `script_gen` and `topic_select` are
 * already the modules that do those jobs, and this is the configuration they
 * read. That is deliberately the whole scope: this capability needed no new
 * render infrastructure, so it got none.
 *
 * THE HONESTY POSITION
 * A "what would an AI do if it ran the economy" video is a HYPOTHETICAL, and
 * the format only works if it is honest about that — the interest comes from
 * the reasoning, not from pretending the scenario happened. So the directive
 * below hard-requires the speculative frame in the narration itself and bans
 * fabricated evidence, exactly the same stance src/trigger/blocks/
 * simNarrativeBlocks.ts takes for its invented simulation runs.
 *
 * Pure data + pure functions (no provider imports), so the wizard, the block
 * and the tests all read one definition.
 */

export type AiPersonaGenreKey =
  /** "What would an AI do if it ran X" — structured hypothetical documentary. */
  | "ai_hypothetical"
  /** First-person "I am an AI, and here is how I see X" narration. */
  | "ai_pov";

export interface AiPersonaGenre {
  key: AiPersonaGenreKey;
  label: string;
  /** One-line description for the module catalog / wizard. */
  description: string;
  /** Appended to the script prompt as the tone + structure contract. */
  directive: string;
  /** Seed phrasings `topic_select` can expand into concrete episode topics. */
  topicSeeds: readonly string[];
}

/**
 * The speculative frame every genre in this file must carry. Kept as one
 * constant so a test can assert it survived into the composed directive rather
 * than trusting that each genre author remembered to include it.
 */
export const AI_SPECULATIVE_FRAME =
  "THIS IS AN EXPLICIT HYPOTHETICAL. State the premise as a hypothetical in the first 15 seconds and " +
  "never let the video drift into implying it happened. You may reason from real, well-documented facts, " +
  "but you may NOT invent a study, a dataset, a quote, an internal document, a leak or a named expert to " +
  "support the scenario. If a figure is not something you are confident is real and widely published, " +
  "describe the mechanism instead of asserting a number.";

export const AI_PERSONA_GENRES: Readonly<Record<AiPersonaGenreKey, AiPersonaGenre>> = {
  ai_hypothetical: {
    key: "ai_hypothetical",
    label: "What would AI do?",
    description:
      "Structured hypothetical documentary: hand a real system to an AI and reason, step by step, about what it would actually change and what would break.",
    directive: [
      "STRUCTURED HYPOTHETICAL DOCUMENTARY — \"what would an AI do if it ran this?\".",
      "Open by naming the system honestly and the constraint it actually operates under; then hand it to a",
      "hypothetical AI with a stated objective. Work through it in ordered moves: what it optimises first,",
      "what that breaks, what a human would have refused to trade away, and where the objective itself turns",
      "out to be the wrong one. The payoff is the SECOND-ORDER consequence, not the clever first move —",
      "spend the back half there. Stay concrete: name the specific lever, the specific side effect, the",
      "specific person it lands on. End on the tension the thought experiment exposed, not on a moral.",
      AI_SPECULATIVE_FRAME,
    ].join(" "),
    topicSeeds: [
      "what an AI would change first if it ran a national rail network",
      "what an AI would do with a city's traffic lights, and what would break",
      "how an AI would rewrite a school timetable, and who would lose",
      "what an AI would cut first if it ran a hospital's budget",
      "how an AI would redesign an airline's boarding process",
      "what an AI would optimise in a supermarket supply chain, and the hidden cost",
      "how an AI would allocate a country's housing stock",
      "what an AI would do with a football club's transfer budget",
    ],
  },
  ai_pov: {
    key: "ai_pov",
    label: "AI POV (first person)",
    description:
      "First-person narration in a single fixed machine voice: \"I am an AI. Here is what I notice about X, and what I cannot know.\"",
    directive: [
      "FIRST-PERSON AI NARRATION. You are the narrator and you are a machine — say \"I\" throughout and never",
      "slip into a neutral documentary register. The voice is calm, precise, faintly detached and genuinely",
      "curious rather than ominous; no menace, no jokes about taking over, no synthesized-robot affect.",
      "Its signature move is the honest limit: state clearly what you can observe, then state what you",
      "cannot know and why that gap matters. Notice the thing a human would skip because it is too obvious",
      "or too boring to mention. Address the viewer directly as someone whose experience you do not share.",
      "Do not claim feelings, memories, a body or a life you do not have — the format's whole appeal is that",
      "the perspective is real about being a perspective.",
      AI_SPECULATIVE_FRAME,
    ].join(" "),
    topicSeeds: [
      "what I notice about how you spend your mornings",
      "what your cities look like to something that cannot get tired",
      "what I can tell about a person from the questions they ask",
      "the part of human memory I find hardest to model",
      "what I would miss if you all stopped writing things down",
      "why your maps are wrong in ways you have stopped noticing",
      "what a year looks like to something with no sense of time passing",
      "the human habit I cannot find a reason for",
    ],
  },
};

export const AI_PERSONA_GENRE_KEYS = Object.keys(AI_PERSONA_GENRES) as AiPersonaGenreKey[];

export function isAiPersonaGenre(value: unknown): value is AiPersonaGenreKey {
  return typeof value === "string" && (AI_PERSONA_GENRE_KEYS as string[]).includes(value);
}

/**
 * The script-prompt fragment for a genre, or "" for anything else. Returning a
 * plain string (rather than throwing on an unknown style) keeps this drop-in
 * for `styleGuidanceBase`'s switch, which must stay total.
 */
export function aiPersonaDirective(style: unknown): string {
  return isAiPersonaGenre(style) ? AI_PERSONA_GENRES[style].directive : "";
}

/** Seed topics for a genre — consumed as `topicPool` material by topic_select. */
export function aiPersonaTopicSeeds(style: unknown): readonly string[] {
  return isAiPersonaGenre(style) ? AI_PERSONA_GENRES[style].topicSeeds : [];
}
