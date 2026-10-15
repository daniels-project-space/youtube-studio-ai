import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pipeline = readFileSync(join(root, "src/trigger/runPipeline.ts"), "utf8");
const checkpoint = readFileSync(join(root, "convex/musicAuditionCheckpoints.ts"), "utf8");
const dispatcher = readFileSync(join(root, "src/trigger/musicAuditionContinuationDispatcher.ts"), "utf8");
const approvalRoute = readFileSync(join(root, "src/app/api/music-audition-checkpoints/route.ts"), "utf8");
const auditionPanel = readFileSync(join(root, "src/components/MusicAuditionPanel.tsx"), "utf8");

assert.match(pipeline, /\["minimax_music3", "mureka", "suno"\]\.includes/u);
assert.match(pipeline, /stopAfterBlockId: "music"/u);
assert.match(pipeline, /createMusicAuditionCheckpoint\([\s\S]*musicNativeWavKey: nativeWavKey/u);
assert.match(pipeline, /createMusicAuditionCheckpointV2\([\s\S]*expectedMusicKey: musicKey/u);
assert.match(pipeline, /musicAuditionCheckpointsApi\.createAwaiting/u);
assert.match(checkpoint, /assertRunExecutionWriteFence\(/u);
assert.match(checkpoint, /await assertMusicStageIntegrity\(ctx, args\.runId, checkpoint\)/u);
assert.match(checkpoint, /status: "awaiting_music_audition"/u);
assert.match(checkpoint, /musicAuditionResumeState: "pending"/u);
assert.match(checkpoint, /assertApprovedMusicAuditionResume/u);
assert.match(checkpoint, /music audition continuation no longer matches the sealed music stage/u);
assert.match(checkpoint, /musicAuditionSourceKey === checkpoint\.musicProviderAuditionSourceKey/u);
assert.match(pipeline, /musicAuditionResume[\s\S]*musicQualityReceiptKey/u);
assert.match(pipeline, /getObjectBytes\(approved\.qualityReceiptKey\)[\s\S]*MusicProgramQualityReceiptSchema\.parse/u);
assert.match(pipeline, /music audition fence: refusing self-heal/u);
assert.match(dispatcher, /musicAuditionResumeSchedule[\s\S]*idempotencyKeys\.create\(request\.idempotencySeed,[\s\S]*scope: "global"/u);
assert.match(dispatcher, /prepareResumeDispatch[\s\S]*musicAuditionResumeSchedule[\s\S]*deliveryAttempt: receipt\.attempt \+ 1/u);
assert.match(
  approvalRoute,
  /assertPinnedMiniMaxMusic3Receipt\(runtime, program\)[\s\S]*?assertMusicAuditionNativeBytes\([\s\S]*?auditionWavBytes/u,
  "MiniMax approval must bind the qualified worker receipt and every approval path must bind the exact retained WAV before a decision becomes durable",
);
assert.match(
  approvalRoute,
  /assertMusicAuditionNativeBytes\([\s\S]*?measureNativeMusicQuality\([\s\S]*?measurements: nativeQuality\.measurements/u,
  "approval must derive technical QC from the exact retained native WAV, never a browser measurement payload",
);
assert.doesNotMatch(
  approvalRoute,
  /submission\.measurements/u,
  "an owner cannot type technical QC values for a different take",
);
assert.match(auditionPanel, /Native WAV QC \(measured from this take\)/u);
assert.match(auditionPanel, /audioLabel \?\? "Native worker WAV"/u);
assert.match(auditionPanel, /nativeQuality\?\.measurements/u);
assert.match(auditionPanel, /<p[^>]*>\{section\.instruction\}<\/p>/u, "each human section score must be shown alongside its sealed listening criterion");
assert.doesNotMatch(auditionPanel, /setMeasurements/u, "the audition UI must not offer editable technical measurements");

console.log("MUSIC AUDITION CHECKPOINT WIRING PASS — MiniMax stops after music and persists a lease-fenced native-WAV receipt");
