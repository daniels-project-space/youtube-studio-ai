import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_INCEPTION_MODULE_KEYS } from "@/engine/channelInceptionContracts";

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
  coordinator.indexOf("if (!design.available || !design.productionReady)") <
    coordinator.indexOf('runStage("channel-inception-research"'),
  "unavailable or runtime-blocked families must stop before the first provider-capable stage",
);
assert.match(
  newChannelUi,
  /const selectable = f\.available && \(productionReady \|\| Boolean\(supervised\)\)/,
  "a production-blocked family may be selectable only for its explicitly supervised private-review intake",
);
assert.match(newChannelUi, /disabled=\{!selectable\}/);

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
  "selectDeterministicElevenVoice",
  "preflightNarrationPerformance",
  "generateChannelArt",
  "architectPipeline",
  "completePipelineForPolicy",
] as const) {
  assert(coordinator.includes(executor), `real executor ${executor} must remain wired`);
}
assert.match(coordinator, /familyPolicy\.voiceOwnership === "family-engine"/);
assert.match(coordinator, /makeVoiceProviderSelectionReceipt/);
assert.match(coordinator, /makeVoiceLocalColdOpenReceipt/);
assert.match(coordinator, /validateVoiceCastingReadinessReceipt/);
assert.match(coordinator, /validatePipelineVoiceWiring/);
assert.match(coordinator, /voiceColdOpenEvidence/);
assert.doesNotMatch(coordinator, /\{ castVoice, gateColdOpen \}/,
  "channel inception must not route voice casting through the retired Gemini audio judge");
assert.match(coordinator, /positioningIdentityProjection/);
assert.match(coordinator, /seoIdentityProjection/);
assert.match(coordinator, /const voiceStage = channelInceptionStage\(plan, "channel-inception-voice"\)/);
assert.match(coordinator, /tasks\.triggerAndWait\(\s*"plan-week-ahead"/);
assert.match(coordinator, /const lengthSeconds = design\.episodeLengthSeconds/,
  "the coordinator must preserve a niche-preset duration resolved by the designer");
assert.doesNotMatch(coordinator, /payload\.lengthMinutes \? Math\.round\(payload\.lengthMinutes \* 60\) : 0/,
  "an omitted duration must never disable the final length law");
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
assert.match(coordinator, /maxProviderSpendUsd:\s*avatarStage\.maximumCostUsd/);
assert.match(coordinator, /maxProviderSpendUsd:\s*bannerStage\.maximumCostUsd/);
assert.match(coordinator, /blockId:\s*"channel-inception-avatar"/);
assert.match(coordinator, /blockId:\s*"channel-inception-banner"/);
assert.match(coordinator, /idempotencyKeys\.create\(\s*`\$\{probeStage\.idempotencyKey\}:\$\{probeRunId\}`/);
assert.match(coordinator, /api\.runs\.claimProbeDispatchEnvelope/);
assert.match(coordinator, /api\.runs\.createProbeRun/);
assert.match(coordinator, /const preclaimedEnvelope = preclaimedRun\?\.probeDispatchEnvelope/);
assert.match(coordinator, /await checkpointProbe\(true\)/);
assert.match(coordinator, /recover:\s*executeProbe/);
assert.match(coordinator, /committedSpendUsd:\s*spend\.committedSpendUsd/);
assert.match(coordinator, /channelInceptionProbeObservedSpend/);
assert.match(coordinator, /quality = assessChannelInceptionProbeQuality/);
assert.match(
  coordinator,
  /resolveChannelInceptionProbeHolisticReview\(qaReport\)/,
  "probe artifact projection must read the current qa_visual visualReview receipt",
);
assert.match(coordinator, /review = reviewProbeArtifacts/);
assert.match(coordinator, /missing explicit accepted golden QA evidence/);
assert(!coordinator.includes("nativeWatchRender"), "probe review must stay within admitted child QA spend");
assert.match(coordinator, /dialInAttempted = true/);
assert.match(coordinator, /"upload_draft"/);
assert.match(coordinator, /goldenQualified:\s*false/);
assert(!coordinator.includes("payload.autoYoutube !== false"));
assert.match(route, /approvedForYoutubeCreation = design\.autoYoutube === true/);
assert.match(route, /youtubeCreationApproval: approvedForYoutubeCreation/);
assert.match(route, /publishingApproval: approvedForPublish/);
assert.match(route, /formatPreflight\(family\.key/,
  "the server must re-run creator preflight rather than trusting a client-side format suggestion");
assert.match(route, /cinematic channel creation requires a specific concept/,
  "factual and fictional cinematic requests must be distinguished before any inception provider work");
assert.match(route, /privateReviewCapabilityOffers\(creatorPreflight\.creativeCapabilities\)/,
  "a Fern-style factual concept must resolve through the catalog-owned private-review admission");
const privateReviewAdmissionGate = route.indexOf("if (privateReviewOffers.length)");
const channelBuildCostAuthorityGate = route.indexOf("const costAuthority = channelBuildCostAuthority");
const channelBuildDispatch = route.indexOf("return tasks.trigger(");
assert(
  privateReviewAdmissionGate >= 0 &&
    privateReviewAdmissionGate < channelBuildCostAuthorityGate &&
    privateReviewAdmissionGate < channelBuildDispatch,
  "a private Casefile intake must return before it can reserve spend or dispatch a channel build",
);
assert.match(
  route.slice(privateReviewAdmissionGate, channelBuildCostAuthorityGate),
  /cannot start automatic channel creation[\s\S]*\{ status: 409 \}/,
  "a private Casefile intake must fail closed rather than silently becoming an automatic cinematic channel",
);
assert.match(route, /requires a supervised episode admission before automatic channel creation/,
  "future child-show readiness cannot bypass a required private child-editor admission");
assert.match(newChannelUi, /concept:\s*concept\.trim\(\) \|\| undefined/,
  "the server-side preflight must receive the exact concept the creator advised on");

for (const operation of ["claim", "complete", "checkpoint", "heartbeat", "fail"] as const) {
  assert(adapter.includes(`${operation}: async`), `Convex ledger adapter must implement ${operation}`);
}
// EVERY NEW CHANNEL MUST START LIFE WITH AN EXPLICIT FAMILY/LANE.
// Nine legacy channels worked only because `inferContentLane` happened to find
// exactly one visual producer in their stored pipeline; a later pipeline edit
// would have silently dropped them into `legacy_unclassified`. These assertions
// keep the creation path from ever minting another channel in that state.
assert.match(coordinator, /family:\s*payload\.family/,
  "createChannel must be handed an EXPLICIT family, never left to pipeline inference");
assert.match(coordinator, /contentLane:\s*design\.contentLane/,
  "createChannel must be handed the designed content lane");
assert.match(mutations, /const family = args\.family \?\? existing\?\.family/);
assert.match(mutations, /\n\s+family,\n\s+contentLane: lane,/,
  "createChannel must persist family + the verified lane on the channel doc");

// The `existingAtStart?._id ??` short-circuit skips createChannel on a resume,
// so a pre-`family` row would otherwise be carried through inception with an
// implicit lane. It must be stamped explicitly before the first stage runs.
assert.match(coordinator, /api\.channels\.backfillChannelFamily/,
  "a resumed family-less channel must be stamped explicitly, not inherited as-is");
assert(
  coordinator.indexOf("api.channels.backfillChannelFamily") <
    coordinator.indexOf('runStage("channel-inception-research"'),
  "the implicit-family stamp must land before any inception stage executes",
);
// The migration only ever fills a hole; it must never relabel a real channel.
assert.match(mutations, /if \(channel\.family !== undefined && channel\.family !== null\)/);
assert.match(mutations, /refusing backfill: family/);

// Style DNA / quality bar are the other field pair six legacy channels lack.
// Positioning is an unconditional stage, and both its resume readers demand the
// pair, so no channel can complete inception without them.
assert.match(coordinator, /const qualityBar = buildQualityBar\(payload\.family, styleDNA, now\)/);
assert.match(coordinator, /styleDNA,\n\s+qaRubric: qualityBar,/,
  "positioning must persist BOTH styleDNA and qaRubric on the channel");
assert.match(coordinator,
  /if \(!styleDNA \|\| styleDNA\.confidence < ESTABLISHED_CONFIDENCE \|\| styleDNA\.groundingGaps\.length\) return undefined;/,
  "a channel missing/weak styleDNA must never be adopted as completed positioning");
assert.match(coordinator, /if \(!qualityBar \|\| !identity\.creativeBrief\) return undefined;/);
assert(
  coordinator.includes("loadCompleted: loadPositioning") &&
    coordinator.includes("adoptExisting: loadPositioning"),
  "both positioning resume readers must enforce the styleDNA/qaRubric contract",
);

// The channel-creation path must not re-implement media behaviour that was
// fixed globally (vision token budget, audio looping, caption burn-in).
for (const bypass of ["ffmpeg", "drawtext", "selfLoopAudio", "aloop", "max_tokens"] as const) {
  assert(!coordinator.includes(bypass),
    `inception must not carry its own ${bypass} path around the global fix`);
}

assert.match(mutations, /identity\?\.role !== "service"/);
assert.match(mutations, /MAX_INCEPTION_OUTPUT_CHARS = 16_000/);
assert.match(mutations, /MAX_INCEPTION_STAGES = 10/);
assert.match(mutations, /leaseVersion: v\.number\(\)/);
assert.match(adapter, /leaseVersion: claim\.leaseVersion/);

console.log("design-channel real executor and inception ledger wiring tests passed");
