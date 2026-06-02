import { wordsToSrt, buildChapters, type Word } from "@/lib/assemblyai";

function assert(c: boolean, m: string) { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) process.exitCode = 1; }

// --- chapters: 5 sections over 200s narration, 5s intro offset ---
const sections = [
  { heading: "The wealthy ascetic", text: "x ".repeat(40) },
  { heading: "Rehearsing loss", text: "x ".repeat(60) },
  { heading: "Fortune cannot ambush", text: "x ".repeat(50) },
  { heading: "Comfort as a cage", text: "x ".repeat(30) },
  { heading: "The free man", text: "x ".repeat(20) },
];
const ch = buildChapters(sections, 200, 5);
console.log("chapters:\n" + ch.split("\n").map((l) => "    " + l).join("\n"));
const lines = ch.split("\n");
assert(lines.length >= 3, ">=3 chapters");
assert(lines[0].startsWith("0:00"), "first chapter at 0:00");
// ascending + >=10s gaps
const secs = lines.map((l) => { const [mm, ss] = l.split(" ")[0].split(":").map(Number); return mm * 60 + ss; });
let ok = true; for (let i = 1; i < secs.length; i++) if (secs[i] < secs[i - 1] + 10) ok = false;
assert(ok, "ascending, >=10s apart");

// --- SRT: synthetic words, 5000ms offset ---
const words: Word[] = [];
for (let i = 0; i < 20; i++) words.push({ text: `word${i}`, start: i * 400, end: i * 400 + 380 });
const srt = wordsToSrt(words, 5000, { maxWords: 6 });
console.log("\nSRT (head):\n" + srt.split("\n").slice(0, 8).map((l) => "    " + l).join("\n"));
assert(/^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(srt), "well-formed SRT cue");
assert(srt.includes("00:00:05,000"), "offset applied (first cue at +5s)");
assert(buildChapters([], 200, 5) === "", "empty sections → no chapters");
assert(wordsToSrt([], 0) === "", "no words → empty SRT");
console.log(process.exitCode ? "\nCAPTIONS BUILDERS TEST FAILED" : "\nCAPTIONS BUILDERS TEST PASSED");
