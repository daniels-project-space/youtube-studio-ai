/**
 * Demonstrate speech-source discovery: pick a motivational topic, search
 * YouTube, and vision-verify candidates until one RAW (uncaptioned, no-effects)
 * source is found. Publishes the accepted sample frames for inspection.
 *
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/find-raw-source.ts
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { findRawSource, pickMotivationalTopic } from "../src/lib/speechSource";

const WEB = "/var/www/html/speech-tv";
const HTTP = "http://87.106.233.113/speech-tv";

async function main() {
  const topic = pickMotivationalTopic({ seedIndex: 1 });
  const src = await findRawSource({ topic, maxChecks: 5, log: (m) => console.log(m) });

  // publish the accepted frames so the choice is reviewable
  const urls: string[] = [];
  src.frames.forEach((f, i) => {
    const web = join(WEB, `raw_${i + 1}.jpg`);
    copyFileSync(f, web);
    urls.push(`${HTTP}/raw_${i + 1}.jpg`);
  });

  console.log("\n=== CHOSEN RAW SOURCE ===");
  console.log(JSON.stringify({
    topic: src.topic,
    id: src.id,
    url: src.url,
    title: src.title,
    durationMin: Math.round(src.durationSec / 60),
    verdict: src.verdict,
    frames: urls,
  }, null, 2));
}

main().catch((e) => {
  console.error("DISCOVERY FAILED:", e.message);
  process.exit(1);
});
