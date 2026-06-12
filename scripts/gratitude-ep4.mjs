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

// TTS in LARGE paragraph chunks (<=2400 chars — fewer joints = fewer takes),
// SEQUENTIAL with full ElevenLabs stitching (previous/next text conditioning
// + chained request ids) so consecutive chunks keep ONE prosody, then a
// 0.5s breathing gap at each paragraph joint and a re-encode concat (the old
// -c copy butt-joint of independent takes was the jarring-voice-change bug).
const paras = script.narrationText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
const chunks = [];
let cur = "";
for (const p of paras) {
  if ((cur + "\n\n" + p).length > 2400 && cur) { chunks.push(cur); cur = p; }
  else cur = cur ? cur + "\n\n" + p : p;
}
if (cur) chunks.push(cur);

const silence = join(dir, "silence.mp3");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.5", "-c:a", "libmp3lame", "-q:a", "2", silence]);

const requestIds = [];
const parts = [];
for (let i = 0; i < chunks.length; i++) {
  console.error(`[tts] chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
  const stitch = {
    previousText: i > 0 ? chunks[i - 1] : undefined,
    nextText: i < chunks.length - 1 ? chunks[i + 1] : undefined,
    previousRequestIds: requestIds.slice(-3),
  };
  const bytes = V3
    ? await synthNarration({ text: chunks[i], provider: "elevenlabs", stitch, onRequestId: (id) => requestIds.push(id) })
    : await synthNarration({ text: chunks[i], voiceId: "psychological", speed: 0.92 });
  const f = join(dir, `part_${String(i).padStart(2, "0")}.mp3`);
  await writeFile(f, bytes);
  parts.push(f);
}
const listFile = join(dir, "list.txt");
const esc = (p) => p.replace(/\\/g, "/").replace(/'/g, "'\\''");
await writeFile(
  listFile,
  parts.flatMap((p, i) => (i < parts.length - 1 ? [`file '${esc(p)}'`, `file '${esc(silence)}'`] : [`file '${esc(p)}'`])).join("\n"),
  "utf8",
);
const out = join(dir, V3 ? "gratitude_day4_v3.mp3" : "gratitude_day4.mp3");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-af", "aresample=44100", "-c:a", "libmp3lame", "-q:a", "2", out]);
console.error(`[done] ${out}`);
console.log(JSON.stringify({ out, scriptTxt: join(dir, "day4_script.txt"), hook: script.hook, loop: script.hookLoop, sections: script.sections.map((s) => s.heading), estSec: script.estDurationSec }));
