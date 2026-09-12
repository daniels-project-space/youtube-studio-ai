import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pipeline = readFileSync(join(root, "src/trigger/runPipeline.ts"), "utf8");
const checkpoint = readFileSync(join(root, "convex/musicAuditionCheckpoints.ts"), "utf8");

assert.match(pipeline, /entry\.block === "music" && entry\.params\?\.provider === "minimax_music3"/u);
assert.match(pipeline, /stopAfterBlockId: "music"/u);
assert.match(pipeline, /createMusicAuditionCheckpoint\([\s\S]*musicNativeWavKey: nativeWavKey/u);
assert.match(pipeline, /musicAuditionCheckpointsApi\.createAwaiting/u);
assert.match(checkpoint, /assertRunExecutionWriteFence\(/u);
assert.match(checkpoint, /music audition checkpoint no longer matches the current music stage/u);
assert.match(checkpoint, /status: "awaiting_music_audition"/u);

console.log("MUSIC AUDITION CHECKPOINT WIRING PASS — MiniMax stops after music and persists a lease-fenced native-WAV receipt");
