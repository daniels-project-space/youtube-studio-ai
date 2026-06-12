// Anchor operator-loved FINANCE reference thumbnails (screenshots) into the
// Investory channel's Style DNA: Gemini vision-deconstructs each into an
// art-director brief; distillPlaybook weights these ABOVE scraped evidence.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { geminiVisionLocal, parseJsonLoose } from "../src/lib/gemini.ts";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY"] });

const REFS = process.argv.slice(2);
if (!REFS.length) throw new Error("usage: anchor-invest-refs.mjs <screenshot.png> ...");

const convex = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
const chs = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = chs.find((c) => c.name.includes("Investory"));
if (!ch) throw new Error(`Investory channel not found. Channels: ${chs.map((c) => c.name).join(", ")}`);

const notes = [];
for (const path of REFS) {
  const raw = await geminiVisionLocal({
    prompt:
      `Deconstruct this top-tier YouTube finance thumbnail for an art director: subject (who/what + expression/` +
      `action), how the scene TELLS THE TOPIC'S STORY, text treatment (color/plate/weight/placement), chart/icon ` +
      `motifs, palette, contrast strategy, composition. Return STRICT JSON {"brief":"<=80 words"}.`,
    imagePaths: [path],
    json: true,
    maxTokens: 400,
  });
  const brief = parseJsonLoose(raw).brief ?? "";
  if (brief) notes.push(brief);
  console.log(`deconstructed ${path.split("\\").pop()}: ${String(brief).slice(0, 100)}...`);
}
if (!notes.length) throw new Error("no briefs distilled");

const dna = ch.styleDNA ?? {};
await convex.mutation(api.channels.updateChannel, {
  channelId: ch._id,
  styleDNA: { ...dna, thumbnailAnchors: notes },
});
console.log(`DNA anchored: ${notes.length} operator reference briefs stored on ${ch.name}`);
