import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pipeline = readFileSync(join(root, "src/trigger/runPipeline.ts"), "utf8");
const checkpoint = readFileSync(join(root, "convex/musicAuditionCheckpoints.ts"), "utf8");
const dispatcher = readFileSync(join(root, "src/trigger/musicAuditionContinuationDispatcher.ts"), "utf8");

assert.match(pipeline, /entry\.block === "music" && entry\.params\?\.provider === "minimax_music3"/u);
assert.match(pipeline, /stopAfterBlockId: "music"/u);
assert.match(pipeline, /createMusicAuditionCheckpoint\([\s\S]*musicNativeWavKey: nativeWavKey/u);
assert.match(pipeline, /musicAuditionCheckpointsApi\.createAwaiting/u);
assert.match(checkpoint, /assertRunExecutionWriteFence\(/u);
assert.match(checkpoint, /music audition checkpoint no longer matches the current music stage/u);
assert.match(checkpoint, /status: "awaiting_music_audition"/u);
assert.match(checkpoint, /musicAuditionResumeState: "pending"/u);
assert.match(checkpoint, /assertApprovedMusicAuditionResume/u);
assert.match(checkpoint, /music audition continuation no longer matches the sealed music stage/u);
assert.match(pipeline, /musicAuditionResume[\s\S]*musicQualityReceiptKey/u);
assert.match(pipeline, /getObjectBytes\(approved\.qualityReceiptKey\)[\s\S]*MusicProgramQualityReceiptSchema\.parse/u);
assert.match(pipeline, /music audition fence: refusing self-heal/u);
assert.match(dispatcher, /musicAuditionResumeSchedule[\s\S]*idempotencyKeys\.create\(request\.idempotencySeed,[\s\S]*scope: "global"/u);
assert.match(dispatcher, /reapExpiredQueuedResumes[\s\S]*musicAuditionResumeSchedule[\s\S]*deliveryAttempt: receipt\.attempt \+ 1/u);

console.log("MUSIC AUDITION CHECKPOINT WIRING PASS — MiniMax stops after music and persists a lease-fenced native-WAV receipt");
