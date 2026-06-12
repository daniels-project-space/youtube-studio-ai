// Anchor operator-loved reference videos into the lofi channel's Style DNA:
// Gemini WATCHES them and distills the setting; girl+cat becomes canonical.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { geminiAnalyzeYouTube, parseJsonLoose } from "../src/lib/gemini.ts";

const REFS = ["https://www.youtube.com/watch?v=vIlzvUsB6H0", "https://www.youtube.com/watch?v=6Wurxv2x9cA"];
const convex = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
const chs = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = chs.find((c) => c.name.includes("Seaside"));

const notes = [];
for (const url of REFS) {
  try {
    const raw = await geminiAnalyzeYouTube(
      url,
      `Describe this lofi video's VISUAL SETTING in detail for an art director: characters (and their pose/activity), ` +
        `environment, lighting, palette, mood, framing. Return STRICT JSON {"setting":"<=70 words"}.`,
      { json: true, maxTokens: 400, windowSec: 45 },
    );
    notes.push(parseJsonLoose(raw).setting ?? "");
    console.log(`watched ${url.slice(-11)}: ${String(notes[notes.length - 1]).slice(0, 90)}…`);
  } catch (e) { console.log(`skip ${url}: ${e.message}`); }
}
const dna = ch.styleDNA ?? {};
const updated = {
  ...dna,
  recurringSubject:
    "A girl and her cat together in a cozy seaside scene (window seat, balcony, café table) — ALWAYS both present, " +
    "the emotional core of every frame. " + (dna.recurringSubject ?? ""),
  referenceAnchors: notes.filter(Boolean),
};
await convex.mutation(api.channels.updateChannel, { channelId: ch._id, styleDNA: updated });
console.log("DNA anchored: girl+cat canonical + reference settings stored");
