/**
 * Live end-to-end proof of the upgraded raw-source discovery for ONE speaker.
 *   SPEAKER="Denzel Washington" THEME="not giving up" node --env-file=.env.local --import tsx scripts/find-one.ts
 * Resolves original-event queries → metadata-scores (speaker-presence filtered) →
 * downloads spanning frames → OCR pre-filter → vision gate → prints the winner and
 * copies its frames to the web dir for visual confirmation.
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { findRawSource } from "../src/lib/speechSource";

const SPEAKER = process.env.SPEAKER || "Denzel Washington";
const THEME = process.env.THEME || "not giving up";
const WEB = "/var/www/html/speech-tv";
const PUB = "http://87.106.233.113/speech-tv";

async function main() {
  const src = await findRawSource({ speaker: SPEAKER, theme: THEME, maxChecks: 8, log: (m) => console.log(m) });
  console.log("\n==== CHOSEN RAW SOURCE ====");
  console.log("speaker :", SPEAKER);
  console.log("title   :", src.title);
  console.log("channel :", src.channel);
  console.log("id      :", src.id, `(${Math.round(src.durationSec / 60)}m)`);
  console.log("ocr     :", JSON.stringify(src.ocr));
  console.log("verdict :", JSON.stringify(src.verdict));
  src.frames.slice(0, 4).forEach((f, i) => {
    const dst = join(WEB, `find_${i}.jpg`);
    try { copyFileSync(f, dst); console.log(`frame ${i}: ${PUB}/find_${i}.jpg`); } catch {}
  });
}
main().catch((e) => { console.error("FIND FAILED:", e.message); process.exit(1); });
