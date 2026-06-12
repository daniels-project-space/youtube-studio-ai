// PIPELINE VALIDATION: real synthScript (hookcraft gates + gentle-guide
// doctrine + latest-Pro narration) for an episodic channel — "7 Days of
// Gratitude", Day 4 of 7 — then real Fish TTS to one MP3.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { synthScript } from "../src/lib/scriptGen.ts";
import { synthNarration } from "../src/lib/tts.ts";

await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "FISH_AUDIO_API_KEY"] });

// V3=1: ElevenLabs v3 voice with performed audio tags (gentle-guide palette).
const V3 = process.env.V3 === "1";

const req = {
  topic:
    `7 Days of Gratitude — Day 4 of 7: "The People We Never Thanked". This is an EPISODIC series; ` +
    `Day 4 picks up exactly where Day 3 ended. Day 3's lesson was thanking the OBSTACLES — the ` +
    `difficulties that quietly shaped us. Day 4 turns from things to PEOPLE: the near ones whose care ` +
    `became invisible through familiarity, the web of strangers our ordinary morning rests on, and — ` +
    `carrying Day 3's thread forward — the difficult people who turned out to be teachers. The episode ` +
    `ends with a SMALL guided meditation and a soft bridge into Day 5.`,
  channelName: "Seven Quiet Days",
  persona:
    "a gentle, unhurried guide leading listeners through a 7-day gratitude journey; speaks to one " +
    "returning traveler like an old friend; philosophical but never academic",
  niche: "mindfulness meditation gratitude",
  style: "meditation",
  maxSeconds: 420,
  endWithSummary: false,
  sentenceGapSec: 0.6,
  ttsSpeed: 0.92,
  voiceTags: V3,
  narrative: {
    scriptStyle: "calm philosophical reflection that builds across a 7-day series",
    hookStyle: "a soft welcome-back that picks up the thread of yesterday's lesson",
    pacing: "slow, spacious",
    delivery: "soft, intimate, unhurried",
  },
  structure: {
    hook:
      "Welcome back for day four: yesterday we learned to thank the obstacles themselves; today we turn " +
      "to the people we never thanked",
    beats: [
      { name: "The thread from day three", note: "honor yesterday's lesson (thanking the obstacles) in a few lines and turn it toward people" },
      { name: "The ones we see every day", note: "the near ones whose care became invisible through familiarity — gratitude dulled by repetition" },
      { name: "The invisible web", note: "the strangers an ordinary morning rests on — growers, builders, menders we will never meet" },
      { name: "The difficult teachers", note: "carry day three forward: the hard people who shaped our patience and our boundaries" },
      { name: "A small practice for today", note: "one concrete act: thank ONE person today, specifically, naming what they did" },
      { name: "Closing meditation", note: "a SMALL guided meditation, 90-120 seconds spoken slowly: settle, breathe, hold one person in mind, silently thank them; generous pauses with ellipses; end on a soft bridge into day five" },
    ],
  },
};

const script = await synthScript(req, (m, x) => console.error(`[script] ${m}`, x ?? ""));
const dir = join(tmpdir(), V3 ? "gratitude_ep4_v3" : "gratitude_ep4");
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "day4_script.txt"), script.narrationText, "utf8");
console.error(`[script] ready: ${script.sections.length} sections, ~${script.estDurationSec}s`);

// TTS in paragraph chunks (<=1100 chars), then ffmpeg-concat to one MP3.
const paras = script.narrationText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
const chunks = [];
let cur = "";
for (const p of paras) {
  if ((cur + "\n\n" + p).length > 1100 && cur) { chunks.push(cur); cur = p; }
  else cur = cur ? cur + "\n\n" + p : p;
}
if (cur) chunks.push(cur);

const parts = [];
for (let i = 0; i < chunks.length; i++) {
  console.error(`[tts] chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
  const bytes = V3
    ? await synthNarration({ text: chunks[i], provider: "elevenlabs" })
    : await synthNarration({ text: chunks[i], voiceId: "psychological", speed: 0.92 });
  const f = join(dir, `part_${String(i).padStart(2, "0")}.mp3`);
  await writeFile(f, bytes);
  parts.push(f);
}
const listFile = join(dir, "list.txt");
await writeFile(listFile, parts.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
const out = join(dir, V3 ? "gratitude_day4_v3.mp3" : "gratitude_day4.mp3");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out]);
console.error(`[done] ${out}`);
console.log(JSON.stringify({ out, scriptTxt: join(dir, "day4_script.txt"), hook: script.hook, loop: script.hookLoop, sections: script.sections.map((s) => s.heading), estSec: script.estDurationSec }));
