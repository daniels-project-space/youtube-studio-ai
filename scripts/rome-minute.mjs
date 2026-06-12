// Pipeline sample: history narration (narrator-teacher doctrine, grounded
// fact-check) — "The Fall of the Roman Empire", first ~minute, v3-voiced.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { synthScript } from "../src/lib/scriptGen.ts";
import { synthNarration } from "../src/lib/tts.ts";

await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

const script = await synthScript(
  {
    topic:
      "The Fall of the Roman Empire — not one collapse but a two-hundred-year unraveling: why the West " +
      "actually fell (debased currency, the third-century crisis, barbarian federates inside the army, " +
      "the sack of 410, the quiet end of 476) and the myth of a single dramatic ending",
    channelName: "Empires at War",
    niche: "military history",
    persona: "authoritative military historian with a storyteller's instinct",
    narrative: {
      scriptStyle: "campaign-level military narrative with human detail",
      delivery: "confident, driving",
      pacing: "measured, documentary",
    },
    style: "generic",
    maxSeconds: 420,
    voiceTags: true,
  },
  (m, x) => console.error(`[script] ${m}`, x ?? ""),
);

// First ~minute: cut narrationText at the sentence boundary nearest ~190 words.
const sentences = script.narrationText.split(/(?<=[.!?…])\s+/);
let minute = "";
for (const s of sentences) {
  if (minute.split(/\s+/).length + s.split(/\s+/).length > 195 && minute) break;
  minute = minute ? `${minute} ${s}` : s;
}

const dir = join(tmpdir(), "rome_minute");
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "rome_minute.txt"), minute, "utf8");
console.error(`[minute] ${minute.split(/\s+/).length} words`);

// One take, one request — no joints.
const bytes = await synthNarration({ text: minute, provider: "elevenlabs" });
await writeFile(join(dir, "rome_minute.mp3"), bytes);
console.error(`[done] mp3 ${bytes.length} bytes`);
console.log(JSON.stringify({ hook: script.hook, loop: script.hookLoop, quote: script.closingLine, sections: script.sections.map((s) => `${s.role}: ${s.heading}`), minuteWords: minute.split(/\s+/).length, minute }));
