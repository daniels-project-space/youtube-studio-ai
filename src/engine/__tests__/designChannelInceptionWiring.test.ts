import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_INCEPTION_MODULE_KEYS } from "@/engine/channelInceptionContracts";
import { isYoutubeChannelCreationApproved } from "@/lib/youtubeChannelCreationPolicy";

const root = process.cwd();
const entrypoint = readFileSync(join(root, "src/trigger/designChannel.ts"), "utf8");
const coordinator = readFileSync(join(root, "src/trigger/designChannelInception.ts"), "utf8");
const adapter = readFileSync(join(root, "src/trigger/channelInceptionLedgerAdapter.ts"), "utf8");
const mutations = readFileSync(join(root, "convex/channels.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/build-channel/route.ts"), "utf8");
const newChannelUi = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");

assert.match(entrypoint, /executeDesignChannel\(payload/);
assert.match(entrypoint, /maxAttempts:\s*3/);
assert(!entrypoint.includes("generateChannelArt"), "the Trigger entrypoint must remain a thin retry shell");
assert(
  coordinator.indexOf("if (!design.available)") <
    coordinator.indexOf('runStage("channel-inception-research"'),
  "unavailable families must stop before the first provider-capable stage",
);
assert.match(newChannelUi, /disabled=\{!f\.available\}/);

const wiredStages = new Set(
  [...coordinator.matchAll(/runStage\("(channel-inception-[a-z-]+)"/g)].map((match) => match[1]),
);
assert.deepEqual(
  [...wiredStages].sort(),
  [...CHANNEL_INCEPTION_MODULE_KEYS].sort(),
  "every Channel Inception contract must be instrumented by the real coordinator",
);

for (const executor of [
  "refreshNicheResearchCore",
  "synthChannelConcept",
  "synthStyleDNA",
  "synthShowBible",
  "optimizeTopics",
  "castVoice",
  "gateColdOpen",
  "generateChannelArt",
  "architectPipeline",
  "completePipelineForPolicy",
] as const) {
  assert(coordinator.includes(executor), `real executor ${executor} must remain wired`);
}
assert.match(coordinator, /familyPolicy\.voiceOwnership === "family-engine"/);
assert.match(coordinator, /makeVoiceColdOpenReceipt/);
assert.match(coordinator, /validateVoiceCastingReadinessReceipt/);
assert.match(coordinator, /validatePipelineVoiceWiring/);
assert.match(coordinator, /voiceColdOpenEvidence/);
assert.match(coordinator, /positioningIdentityProjection/);
assert.match(coordinator, /seoIdentityProjection/);
assert.match(coordinator, /const voiceStage = channelInceptionStage\(plan, "channel-inception-voice"\)/);
assert.match(coordinator, /tasks\.triggerAndWait\(\s*"plan-week-ahead"/);
assert.match(coordinator, /requestKey:\s*thumbnailStage\.idempotencyKey/);
assert.match(coordinator, /budgetCapUsd:\s*thumbnailStage\.maximumCostUsd/);
assert.match(coordinator, /api\.contentPlan\.listProvenReadyPlanPage/);
assert.match(coordinator, /count:\s*dispatch\.missingCount/);
assert.match(coordinator, /phase:\s*"starter-plan-child-finished"/);
assert.match(coordinator, /artifact_repair_required/);
assert(!coordinator.includes("count: thumbnailStage.params.previews.missingCount"),
  "starter render count must be recomputed from the current live receipt set");
assert.match(coordinator,
  /`\$\{thumbnailStage\.idempotencyKey\}:plan-week-ahead:\$\{runtime\.runId\}:attempt-\$\{runtime\.attempt\}`[\s\S]*scope:\s*"global"/);
assert.match(coordinator, /plan-week-ahead:\$\{runtime\.runId\}:attempt-\$\{runtime\.attempt\}/);
assert(
  coordinator.indexOf("assertStarterPlanChildSucceeded(childResult)") <
    coordinator.indexOf('phase: "starter-plan-child-finished"',
      coordinator.indexOf("assertStarterPlanChildSucceeded(childResult)")),
  "a failed child result must throw before the child-finished checkpoint is persisted",
);
assert.match(coordinator, /providerStart:\s*"explicit"[\s\S]*recover:\s*async/);
assert.equal(
  [...coordinator.matchAll(/await generateChannelArtAsset\(/g)].length,
  2,
  "avatar and banner must execute under independent durable stage leases",
);
assert(!coordinator.includes("sharedArt"), "one art stage must never hide another stage's spend");
assert.match(coordinator, /idempotencyKeys\.create\(\s*`\$\{probeStage\.idempotencyKey\}:\$\{probeRunId\}`/);
assert.match(coordinator, /api\.runs\.claimProbeDispatchEnvelope/);
assert.match(coordinator, /api\.runs\.createProbeRun/);
assert.match(coordinator, /const preclaimedEnvelope = preclaimedRun\?\.probeDispatchEnvelope/);
assert.match(coordinator, /await checkpointProbe\(true\)/);
assert.match(coordinator, /recover:\s*executeProbe/);
assert.match(coordinator, /committedSpendUsd:\s*spend\.committedSpendUsd/);
assert.match(coordinator, /channelInceptionProbeObservedSpend/);
assert.match(coordinator, /quality = assessChannelInceptionProbeQuality/);
assert.match(coordinator, /review = reviewProbeArtifacts/);
assert.match(coordinator, /missing explicit accepted golden QA evidence/);
assert(!coordinator.includes("nativeWatchRender"), "probe review must stay within admitted child QA spend");
assert.match(coordinator, /dialInAttempted = true/);
assert.match(coordinator, /"upload_draft"/);
assert.match(coordinator, /goldenQualified:\s*false/);
assert(!coordinator.includes("payload.autoYoutube !== false"));
assert.equal(isYoutubeChannelCreationApproved({}), false);
assert.equal(isYoutubeChannelCreationApproved({ autoYoutube: true }), false);
assert.equal(isYoutubeChannelCreationApproved({
  autoYoutube: true,
  youtubeCreationActor: "spoofed-user",
  youtubeCreationEvidence: "clicked a checkbox",
}), false);
assert.equal(isYoutubeChannelCreationApproved({
  autoYoutube: true,
  youtubeCreationActor: "authenticated-operator:owner_daniel",
  youtubeCreationEvidence: "explicit YouTube channel creation confirmation in channel creation wizard",
}), true);
assert.equal(isYoutubeChannelCreationApproved({
  autoYoutube: false,
  youtubeCreationActor: "authenticated-operator:owner_daniel",
  youtubeCreationEvidence: "explicit YouTube channel creation confirmation in channel creation wizard",
}), false, "publishing or stale evidence cannot opt into channel creation");
assert.match(route, /approvedForYoutubeCreation = design\.autoYoutube === true/);
assert.match(route, /youtubeCreationApproval: approvedForYoutubeCreation/);
assert.match(route, /publishingApproval: approvedForPublish/);

for (const operation of ["claim", "complete", "checkpoint", "heartbeat", "fail"] as const) {
  assert(adapter.includes(`${operation}: async`), `Convex ledger adapter must implement ${operation}`);
}
assert.match(mutations, /identity\?\.role !== "service"/);
assert.match(mutations, /MAX_INCEPTION_OUTPUT_CHARS = 16_000/);
assert.match(mutations, /MAX_INCEPTION_STAGES = 10/);
assert.match(mutations, /leaseVersion: v\.number\(\)/);
assert.match(adapter, /leaseVersion: claim\.leaseVersion/);

console.log("design-channel real executor and inception ledger wiring tests passed");
