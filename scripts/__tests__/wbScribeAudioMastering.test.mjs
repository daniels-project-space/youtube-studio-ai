import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "scripts", "wb_scribe_sync.py"), "utf8");

assert.match(
  source,
  /adelay=\{pre_ms\}\|\{pre_ms\},apad,loudnorm=I=-16:LRA=11:TP=-1\.5\[a\]/,
  "whiteboard final mux must master narration to the delivery loudness target after its intentional pre-roll",
);
assert.match(source, /"-map", "0:v", "-map", "\[a\]"/, "whiteboard mux must retain both rendered video and mastered audio");
assert.match(source, /"-c:a", "aac", "-ar", "48000", "-b:a", "160k"/, "whiteboard delivery audio must remain at the standard 48 kHz rate");

console.log("wb scribe audio mastering: PASS");
