// META DUEL: current production metadata (legacy prompt, flash, no gates) vs
// METACRAFT, across the nine channel themes — each grounded in the REAL cold
// opens the script engine produced today.
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJson } from "../src/lib/gemini.ts";
import { craftMetadata } from "../src/lib/metacraft.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });

const THEMES = [
  { channelName: "The Quiet Stoic", niche: "stoicism", persona: "calm, grounded modern stoic",
    topic: "Why Stoics never get angry — anger as self-destruction",
    coldOpen: "Your pulse thuds in your temples over a five-word email from your boss. You are actively harming yourself. The tension in your jaw right now is exactly what Marcus Aurelius warned about in his private journal. Writing from a freezing military tent in Carnuntum around one-seventy AD, the Roman emperor noted that the consequences of anger are always worse than its cause.",
    loop: "the Stoic mechanics of anger and the exact mental framework to stop handing your peace of mind to others" },
  { channelName: "Steel & Silk", niche: "samurai history", persona: "cinematic history narrator",
    topic: "The Onin War — the night Kyoto burned and the samurai age tore itself apart",
    coldOpen: "Ash falls like black snow on the roof of the Shokoku-ji temple. It is the autumn of 1467. Below the temple gates, eighty thousand samurai slaughter each other in the smoke. The Yamana and Hosokawa clans are fighting in the streets of Kyoto. It begins as a petty dispute over an heir. But by the time the fires finally burn out, the shogun's authority will be ash, and Japan will descend into a century of relentless bloodletting.",
    loop: "how a petty succession dispute burned the capital and started a century of war" },
  { channelName: "Empires at War", niche: "military history", persona: "authoritative military historian",
    topic: "The Fall of the Roman Empire — why the West actually fell, the myth of a single dramatic ending",
    coldOpen: "The Roman Empire did not fall in a fiery, apocalyptic battle against barbarian hordes. It bled out over two hundred years of self-inflicted wounds. By the time the teenage emperor Romulus Augustulus was quietly told to pack his bags in four seventy-six, the Empire was already a ghost. The legions hadn't been defeated. They had been replaced by the very Germanic tribes they were supposed to fight.",
    loop: "how an empire actually dies from the inside out — debased currency, outsourced defense, civil war",
    quote: "Empires do not fall to invaders; they outsource their own survival." },
  { channelName: "The Drawn Past", niche: "illustrated odd history", persona: "wry, curious narrator of strange true events",
    topic: "The Dancing Plague of 1518 — when Strasbourg danced itself to death",
    coldOpen: "Frau Troffea steps into a narrow Strasbourg street and begins to twitch. She will not stop for six days. By the end of the week, thirty-four other people have joined her. Within a month, the crowd swells to four hundred. Their feet are bleeding, their ribs are cracking, and they are crying out for help. The city council formulates a brilliant medical solution. It only makes the death toll rise.",
    loop: "what really caused the dancing plague and why the official cure made it worse" },
  { channelName: "The Last Reel", niche: "film retrospectives", persona: "film-literate essayist",
    topic: "Pirates of the Caribbean: The Curse of the Black Pearl — the blockbuster nobody believed in",
    coldOpen: "In 1995, Cutthroat Island lost 105 million dollars and bankrupted Carolco Pictures. Reviving the pirate genre was corporate suicide. Yet eight years later, Disney greenlit a 140 million dollar budget for a pirate movie based on a theme park ride. Studio chief Dick Cook was doubted, director Gore Verbinski lacked a finished third act, and the leading man showed up with permanent gold caps glued to his teeth.",
    loop: "how a guaranteed box-office bomb resurrected an entire genre" },
  { channelName: "Chrono Unit 7", niche: "speculative AI fiction", persona: "field-log narrator of a time-traveling AI unit",
    topic: "Mission log: an AI unit is inserted into ancient Rome, 44 BC — the week Caesar dies",
    coldOpen: "The assassination of Julius Caesar was not a secret conspiracy. It was a statistical inevitability broadcast across Rome. By March twelfth, chatter concerning the dictator's death had saturated fifty-eight percent of the city's market districts. Yet Caesar dismissed the augur Spurinna and ignored the data. Did he want to be terminated?",
    loop: "whether Caesar chose his own death — assessed by a machine that cannot stop calculating it" },
  { channelName: "The Takeover Log", niche: "AI risk analysis", persona: "calm analyst documenting machine power",
    topic: "The day AI wins won't look like war — it will look like a quarterly earnings call",
    coldOpen: "In May 2014, a Hong Kong venture capital firm appointed a machine to its board of directors. A piece of software was given a literal vote on financial survival. The system was named VITAL. Management did not just ask for its advice. They gave it veto power. They are not plotting to destroy us. They are simply acquiring fiduciary duty.",
    loop: "what happens when human survival becomes a drag on corporate profitability" },
  { channelName: "Spotlight Rot", niche: "celebrity media analysis", persona: "sharp media critic dissecting the fame machine",
    topic: "Why every celebrity meltdown follows the same script — the anatomy of a manufactured downfall",
    coldOpen: "In February 2007, sixty paparazzi received a text detailing Britney Spears' exact location at a Tarzana gas station. A spontaneous mental break does not come with a press itinerary. Managers, publicists, and media outlets quietly shift into a standardized extraction protocol. They monetize the descent. They choreograph the rock bottom. Then they package the million-dollar redemption interview.",
    loop: "the rigid five-stage playbook behind every public downfall" },
  { channelName: "Gilded Lies", niche: "billionaire exposé", persona: "forensic, receipts-first investigator",
    topic: "How billionaires launder their reputations through philanthropy",
    coldOpen: "In July 2019, workers at the Louvre museum quietly unbolted the Sackler name from the walls. The most effective reputation laundering campaign in modern history was unraveling. While their company ignited an opioid crisis, their charitable giving ensured they were treated as cultured aristocrats rather than cartel bosses. The philanthropy was not a byproduct of their success. It was the primary mechanism.",
    loop: "the calculated exchange rate between museum wings and institutional silence" },
];

const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const themes = only.length ? THEMES.filter((t) => only.some((o) => t.channelName.toLowerCase().includes(o))) : THEMES;

const out = [];
for (const t of themes) {
  process.stderr.write(`${t.channelName}... `);
  // BEFORE — the legacy production prompt, verbatim shape (flash, one shot, no gates).
  let before = { title: "", description: "" };
  try {
    const b = await geminiJson({
      prompt:
        `Write YouTube SEO metadata for a video about "${t.topic}" on the channel "${t.channelName}".\n` +
        `NICHE: ${t.niche}\nPERSONA: ${t.persona}\n` +
        `SCRIPT EXCERPT:\n${t.coldOpen}\n` +
        `RULES:\n` +
        `- title: 60-90 characters (aim LONG — 70-100 char titles earn +10-14% CTR; no fluff). Front-load the ` +
        `PRIMARY KEYWORD in the first ~40 chars. Strongly prefer a NUMBER/LIST framing when the topic suits it ` +
        `(e.g. "9 Keys to …", "7 Daily Habits …"), put the NICHE in caps in parentheses near the end, and append ` +
        `"| <relevant figure>" when one fits. Use a CURIOSITY GAP (show the WHAT, hide the HOW — +CTR), address ` +
        `the viewer with "you" where natural, and lean on a proven high-CTR frame. ONE clear promise per title. ` +
        `NEVER promise something the video doesn't deliver. Do NOT include the channel name.\n` +
        `- description: SEO-RICH but NOT the script. Hook lines + ≤60-word paragraph + "Subscribe for more:" CTA + ` +
        `"Keywords: " line + hashtags line.\n- tags: 25-30 relevant tags.\n` +
        `Return STRICT JSON {"title":string,"description":string,"tags":string[]}.`,
      maxTokens: 1200,
      temperature: 0.8,
    });
    before = { title: (b.title ?? "").trim(), description: (b.description ?? "").trim() };
  } catch (e) { before = { title: `(failed: ${e.message})`, description: "" }; }

  // AFTER — metacraft.
  let after = null, err = "";
  try {
    after = await craftMetadata({
      topic: t.topic, channelName: t.channelName, niche: t.niche, persona: t.persona,
      scriptExcerpt: t.coldOpen, coldOpen: t.coldOpen, hookLoop: t.loop, quote: t.quote,
      log: (m) => process.stderr.write(`\n  ${m}`),
    });
  } catch (e) { err = e.message; }

  out.push({
    channel: t.channelName,
    before: before.title,
    after: after
      ? { title: after.title, frame: after.frame, clickScore: after.clickScore, alternate: after.titleAlternate, pinned: after.pinnedComment, suggests: after.suggests.slice(0, 4), description: after.description }
      : { error: err },
  });
  process.stderr.write(" done\n");
}
console.log(JSON.stringify(out, null, 1));
