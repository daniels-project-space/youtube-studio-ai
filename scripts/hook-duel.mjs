// HOOK DUEL: current production hook gen vs the new hookcraft engine,
// across the nine channel themes from the banana thumbnail set.
// CURRENT = the exact pre-hookcraft production prompt (HOOK_RULES + style
// guidance, default flash model, no gate) lifted verbatim from scriptGen.
// NEW = craftHook (latest Gemini Pro, device candidates, lint + judge gate).
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJson } from "../src/lib/gemini.ts";
import { craftHook, lintHook } from "../src/lib/hookcraft.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });

// Verbatim from the deleted golden.ts HOOK_RULES + scriptGen head call.
const OLD_HOOK_RULES =
  "Write a scroll-stopping HOOK that lands in the first ~7 seconds: open a curiosity gap, " +
  "make a bold or contrarian claim, or address the viewer directly with \"you\". No preamble, " +
  "no \"in this video\", no restating the title — drop the viewer straight into tension or intrigue.";
const OLD_ESSAY_TONE =
  "Engaging video-essay tone: a curiosity hook, then clear narrative sections with a satisfying arc.";
const OLD_CRIME_TONE =
  "True-crime / mystery tone: open on an unsettling hook, build tension, withhold-then-reveal, vivid sensory detail.";

const THEMES = [
  { channelName: "The Quiet Stoic", niche: "stoicism", style: "generic", tone: OLD_ESSAY_TONE,
    persona: "calm, grounded modern stoic — quiet authority, never preachy",
    narrative: { scriptStyle: "measured philosophical essay with concrete modern stakes", delivery: "low, steady, intimate" },
    topic: "Why Stoics never get angry — anger as self-destruction" },
  { channelName: "Steel & Silk", niche: "samurai history", style: "generic", tone: OLD_ESSAY_TONE,
    persona: "cinematic history narrator, restrained and vivid",
    narrative: { scriptStyle: "cinematic narrative history, sensory and precise", delivery: "measured, weighty" },
    topic: "The Onin War — the night Kyoto burned and the samurai age tore itself apart" },
  { channelName: "Empires at War", niche: "military history", style: "generic", tone: OLD_ESSAY_TONE,
    persona: "authoritative military historian with a storyteller's instinct",
    narrative: { scriptStyle: "campaign-level military narrative with human detail", delivery: "confident, driving" },
    topic: "Hannibal crosses the Alps — 37 elephants against the Roman Republic" },
  { channelName: "The Drawn Past", niche: "illustrated odd history", style: "generic", tone: OLD_ESSAY_TONE,
    persona: "wry, curious narrator of history's strangest true events",
    narrative: { scriptStyle: "storybook-narrated true oddity, playful but factual", delivery: "warm, amused, precise" },
    topic: "The Dancing Plague of 1518 — when Strasbourg danced itself to death" },
  { channelName: "The Last Reel", niche: "film retrospectives", style: "generic", tone: OLD_ESSAY_TONE,
    persona: "film-literate essayist who loves the craft, allergic to hot takes",
    narrative: { scriptStyle: "behind-the-scenes craft essay with affection and verdicts", delivery: "conversational, sharp" },
    topic: "Pirates of the Caribbean: The Curse of the Black Pearl — the blockbuster nobody believed in" },
  { channelName: "Chrono Unit 7", niche: "speculative AI fiction", style: "crime", tone: OLD_CRIME_TONE,
    persona: "field-log narrator of a time-traveling AI unit — clinical voice, human questions",
    narrative: { scriptStyle: "mission-log speculative fiction grounded in real history", delivery: "clinical, escalating" },
    topic: "Mission log: an AI unit is inserted into ancient Rome, 44 BC — the week Caesar dies" },
  { channelName: "The Takeover Log", niche: "AI risk analysis", style: "crime", tone: OLD_CRIME_TONE,
    persona: "calm analyst documenting how machine systems accumulate power",
    narrative: { scriptStyle: "documentary dread built from real, sourced events", delivery: "flat, factual, unsettling" },
    topic: "The day AI wins won't look like war — it will look like a quarterly earnings call" },
  { channelName: "Spotlight Rot", niche: "celebrity media analysis", style: "crime", tone: OLD_CRIME_TONE,
    persona: "sharp media critic dissecting the fame machine, not the victim",
    narrative: { scriptStyle: "receipts-driven media autopsy", delivery: "cutting, controlled" },
    topic: "Why every celebrity meltdown follows the same script — the anatomy of a manufactured downfall" },
  { channelName: "Gilded Lies", niche: "billionaire exposé", style: "crime", tone: OLD_CRIME_TONE,
    persona: "forensic, receipts-first investigator of wealth and image",
    narrative: { scriptStyle: "investigative exposé with named sources and numbers", delivery: "dry, damning" },
    topic: "How billionaires launder their reputations through philanthropy" },
];

const out = [];
for (const t of THEMES) {
  process.stderr.write(`${t.channelName}... `);
  // CURRENT (verbatim old production head call: default model, no gate)
  let current = "";
  try {
    const head = await geminiJson({
      prompt:
        `For a long video about "${t.topic}"${t.niche ? ` (${t.niche})` : ""}: write a curiosity HOOK (1-2 spoken sentences) ` +
        `and a closing_line (<=10 words). ${OLD_HOOK_RULES} ${t.tone}\nReturn STRICT JSON {"hook":string,"closing_line":string}.`,
      maxTokens: 500,
      temperature: 0.85,
    });
    current = typeof head.hook === "string" ? head.hook.trim() : "";
  } catch (e) { current = `(generation failed: ${e.message})`; }

  // NEW (hookcraft engine)
  let crafted = null, err = "";
  try {
    crafted = await craftHook({
      topic: t.topic, channelName: t.channelName, niche: t.niche, persona: t.persona,
      narrative: t.narrative, style: t.style === "crime" ? "crime" : "generic",
      log: (m) => process.stderr.write(`\n  ${m}`),
    });
  } catch (e) { err = e.message; }

  const curLint = lintHook(current, "", {});
  out.push({
    channel: t.channelName, topic: t.topic,
    current, currentLintIssues: curLint.issues,
    crafted: crafted ? { device: crafted.device, hook: crafted.hook, opening: crafted.opening, verdict: { punch: crafted.verdict.punch, specificity: crafted.verdict.specificity, curiosity: crafted.verdict.curiosity, voiceMatch: crafted.verdict.voiceMatch } } : { error: err },
  });
  process.stderr.write(" done\n");
}
console.log(JSON.stringify(out, null, 1));
