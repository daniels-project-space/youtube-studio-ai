// Render ALL playbook patterns for a channel as 3 candidates (subject-aware
// placement + completeness test active) and save to %TEMP%/thumbs3.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { renderCandidate } from "../src/lib/thumbnailLab.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const chs = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = chs.find((c) => c.name.toLowerCase().includes((process.env.CHANNEL ?? "investory").toLowerCase()));
const playbook = ch.thumbnailPlaybook;
if (!playbook?.patterns?.length) throw new Error("channel has no thumbnail playbook");
const plan = await convex.query(api.contentPlan.listPlan, { ownerId: ch.ownerId, channelId: ch._id }).catch(() => []);
const title = process.env.TITLE ?? plan[0]?.title ?? plan[0]?.topic ?? "Why the Market Always Recovers: 100 Years of Proof";
console.log(`rendering ${playbook.patterns.length} patterns for "${title}"`);

const tmp = join(tmpdir(), "thumbs3");
mkdirSync(tmp, { recursive: true });
for (let i = 0; i < Math.min(3, playbook.patterns.length); i++) {
  try {
    await renderCandidate({
      pattern: playbook.patterns[i],
      title,
      playbook,
      outJpg: join(tmp, `inv_${i + 1}.jpg`),
      tmpDir: tmp,
      idx: i,
      log: (m) => console.log(`  ${m}`),
    });
    console.log(`OK ${i + 1}: ${playbook.patterns[i].name}`);
  } catch (e) {
    console.log(`FAIL ${i + 1} (${playbook.patterns[i].name}): ${e.message}`);
  }
}
