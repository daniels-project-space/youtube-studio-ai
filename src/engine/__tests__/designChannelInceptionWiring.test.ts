import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_INCEPTION_MODULE_KEYS } from "@/engine/channelInceptionContracts";

const root = process.cwd();
const entrypoint = readFileSync(join(root, "src/trigger/designChannel.ts"), "utf8");
const coordinator = readFileSync(join(root, "src/trigger/designChannelInception.ts"), "utf8");
const adapter = readFileSync(join(root, "src/trigger/channelInceptionLedgerAdapter.ts"), "utf8");
const mutations = readFileSync(join(root, "convex/channels.ts"), "utf8");
const schema = readFileSync(join(root, "convex/schema.ts"), "utf8");
const refreshShowBible = readFileSync(join(root, "src/trigger/refreshShowBible.ts"), "utf8");
const regroundChannel = readFileSync(join(root, "src/engine/creative/regroundChannel.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/build-channel/route.ts"), "utf8");
const newChannelUi = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const pipelineRunner = readFileSync(join(root, "src/trigger/runPipeline.ts"), "utf8");
const showProfileCodec = readFileSync(join(root, "src/engine/channelShowProfileCodec.ts"), "utf8");
const channelVoiceCasting = readFileSync(join(root, "src/lib/channelVoiceCasting.ts"), "utf8");

assert.match(entrypoint, /executeDesignChannel\(payload/);
assert.match(entrypoint, /maxAttempts:\s*3/);
assert(!entrypoint.includes("generateChannelArt"), "the Trigger entrypoint must remain a thin retry shell");
const canonicalProgramBriefGate = coordinator.indexOf(
  "const programBrief = assertCanonicalChannelProgramBrief(payload.programBrief)",
);
const canonicalProgramRouteGate = coordinator.indexOf("resolvedProgramRoute = resolveChannelProgramRoute(programBrief)");
const creatorIntentDiagnosisGate = coordinator.indexOf("deriveCreatorIntentDiagnosis({ programBrief, programRoute: resolvedProgramRoute })");
const staticCertifiedGate = coordinator.indexOf("const certifiedAdmission = certifiedFamilyAdmission(payload.family);");
const ownerAdmissionGate = coordinator.indexOf("const ownerId = admitProviderTaskOwner({");
const reviewedRuntimeGate = coordinator.indexOf("resolveOwnerReviewedLtxRuntime({ client: convex, ownerId })");
const directPreflightGate = coordinator.indexOf("formatPreflight(");
const directCreatorAdmissionGate = coordinator.indexOf("!creatorPreflight.creatorAdmission.autonomous");
const directCapabilityIntentGate = coordinator.indexOf("const programCapabilityIntent");
const directReadinessGate = coordinator.indexOf("familyProductionReadiness(payload.family, reviewedLtxRuntime.runtime)");
const runtimeCertifiedGate = coordinator.indexOf(
  "const runtimeCertifiedAdmission = certifiedFamilyAdmission(payload.family, reviewedLtxRuntime.runtime);",
);
const directConvexGate = coordinator.indexOf("new ConvexHttpClient(url)");
assert(
  canonicalProgramBriefGate >= 0 &&
    canonicalProgramRouteGate > canonicalProgramBriefGate &&
    creatorIntentDiagnosisGate > canonicalProgramRouteGate &&
    staticCertifiedGate > creatorIntentDiagnosisGate &&
    staticCertifiedGate < ownerAdmissionGate &&
    ownerAdmissionGate < directConvexGate &&
    directConvexGate < reviewedRuntimeGate &&
    reviewedRuntimeGate < directPreflightGate &&
    directCreatorAdmissionGate > directPreflightGate &&
    directCreatorAdmissionGate < directCapabilityIntentGate &&
    directCapabilityIntentGate > directPreflightGate &&
    directCapabilityIntentGate < directReadinessGate &&
    directReadinessGate < runtimeCertifiedGate &&
    runtimeCertifiedGate > directPreflightGate,
  "a direct Trigger execution must reject incomplete static admission before owner/Convex work, then use only reviewed runtime evidence for the final dynamic admission",
);
assert.match(coordinator, /assertChannelProgramRouteBinding\(\{\s*route: resolvedProgramRoute,\s*programBrief,/,
  "a direct Trigger execution must bind its route to the canonical brief before compiler or persistence work");
assert.match(coordinator, /assertCreatorIntentDiagnosisBinding\(\{[\s\S]*?diagnosis: payload\.creatorIntentDiagnosis,[\s\S]*?programRoute: resolvedProgramRoute/,
  "a direct Trigger execution must bind a submitted diagnosis to the canonical brief and route before preflight");
assert.match(coordinator, /programRouteForCompile\s*\?\s*\{\s*programRoute: programRouteForCompile\s*\}\s*:\s*\{\}\),[\s\S]*?!isRouteLessLegacyRetry && submittedCreatorIntentDiagnosis[\s\S]*?creatorIntentDiagnosis: submittedCreatorIntentDiagnosis/,
  "the shared designer must pair a route-derived diagnosis with the sealed route, while route-less historical retries remain isolated from current-route admission");
assert.match(coordinator, /new channel admission requires a sealed creator intent diagnosis/,
  "a fresh direct Trigger payload cannot create a channel without the server-derived semantic receipt");
assert.match(coordinator, /programRouteForCompile \? \{ programRoute: programRouteForCompile \} : \{\}/,
  "the show profile must retain the sealed route beside the compiled baseline, while route-less historical retries stay isolated");
assert.match(coordinator, /programRoute: structuredClone\(resolvedProgramRoute!\)/,
  "a newly created channel identity must retain the route rather than rebuild it from task fields");
assert.match(coordinator, /creatorIntentDiagnosis: structuredClone\(requestCreatorIntentDiagnosis!\)/,
  "a newly created channel identity must retain the sealed diagnosis rather than recalculate it during a retry");
assert.match(coordinator, /syntheticScenario: routeSyntheticScenario \?\? payload\.syntheticScenario/,
  "the compiler may retain a historical route-less scenario only while the later exact-snapshot legacy gate is satisfied");
assert.match(coordinator, /quizProfile: programRouteForCompile\?\.quizProfile \?\? payload\.quizProfile/,
  "the compiler may retain a historical route-less QuizYear profile only while the later exact-snapshot legacy gate is satisfied");
assert.match(
  coordinator,
  /if \(resolvedProgramRoute\) \{[\s\S]*?payload\.quizProfile !== undefined[\s\S]*?payload\.quizProfile !== resolvedProgramRoute\.quizProfile[\s\S]*?payload\.syntheticScenario !== undefined[\s\S]*?payload\.syntheticScenario\.profile !== resolvedProgramRoute\.syntheticScenarioProfile/,
  "a route-bearing admission must reject payload siblings that differ from the canonical route",
);
const legacyIdentityLookup = coordinator.indexOf("const existingAtStart = await convex.query(api.channels.getChannelBySlug");
const serializedSeriesGate = coordinator.indexOf("const payloadSuppliesSeries");
const baselineCompile = coordinator.indexOf("const design = designPipeline(");
assert(
  legacyIdentityLookup >= 0 &&
    serializedSeriesGate > legacyIdentityLookup &&
    baselineCompile > serializedSeriesGate,
  "the executor must inspect a durable identity before deciding whether legacy series fields may reach compilation",
);
assert.match(
  coordinator,
  /const programRouteForCompile = isRouteLessLegacyRetry \? undefined : resolvedProgramRoute/,
  "a resolvable contemporary route must not be attached while replaying a route-less historical identity",
);
assert.match(
  coordinator,
  /if \(payloadSuppliesSeries && !isRouteLessLegacyRetry\) \{[\s\S]*?sealedSerializedProgram[\s\S]*?must match the sealed serialized program route/,
  "new and route-bearing inputs must fail closed unless their raw series echo the sealed route",
);
assert.match(
  coordinator,
  /isRouteLessLegacyRetry && payload\.seriesTitle[\s\S]*?seriesCount: payload\.seriesCount/,
  "only a durable route-less identity may feed legacy series fields into the historical compiler path",
);
assert.match(
  coordinator,
  /programRouteForCompile \? \{ programRoute: programRouteForCompile \} : \{\}/,
  "the compiler must derive all non-legacy series settings from the sealed route rather than raw executor input",
);
assert.match(coordinator, /formatPreflight\(\s*programBrief\.family/);
assert.match(coordinator, /briefToFormatSelectionInput\(programBrief/);
assert.match(coordinator, /resolveUnhostedSupervisedCreativeCapabilityIntents\(/);
assert.match(coordinator, /validateCreativeCapabilitySelections\(/);
assert.match(coordinator, /assessCreativeCapabilityAutomaticBuildAdmission\(/);
assert.match(coordinator, /export interface DesignChannelArgs extends Omit<DesignOptions, "family" \| "programBrief">/);
assert.match(coordinator, /programBrief: ChannelProgramBrief/);
assert.match(coordinator, /const showProfile = createChannelShowProfile\(/,
  "new channel inception must seal a profile from the admitted program and resolved baseline pipeline");
assert.match(coordinator, /showProfile: persistedChannelShowProfile\(showProfile\)/,
  "the durable channel identity must retain the sealed composition receipt");
assert.match(coordinator, /positioningStage\.params\.programBrief/,
  "positioning must use the sealed plan-stage brief rather than mutable task payload text");
assert.match(coordinator, /nicheKey:\s*programBrief\.nicheKey/);
assert.match(coordinator, /function identityResearchNiche\(/);
assert.match(coordinator, /identity\.programBrief\?\.nicheKey \?\? identity\.nicheKey \?\? identity\.niche/,
  "SEO/storage reads must let the canonical program brief own the catalog key");
assert.match(refreshShowBible, /programBrief\?\.nicheKey \?\? identity\.nicheKey \?\? identity\.niche/,
  "Show Bible refresh must research the canonical brief's catalog key");
assert.match(regroundChannel, /programBrief\?\.nicheKey \?\? identity\.nicheKey \?\? identity\.niche/,
  "reground must research the canonical brief's catalog key");
assert.match(refreshShowBible, /assertPersistedProgramBriefIdentity\(identity/,
  "Show Bible refresh must validate a persisted brief before research or synthesis");
assert.match(regroundChannel, /assertPersistedProgramBriefIdentity\(identity/,
  "reground must validate a persisted brief before research or synthesis");
assert(
  refreshShowBible.indexOf("assertPersistedProgramBriefIdentity(identity") < refreshShowBible.indexOf("const researchNiche") &&
    refreshShowBible.indexOf("assertPersistedProgramBriefIdentity(identity") < refreshShowBible.indexOf("await synthShowBible"),
  "Show Bible refresh must fail closed before research or LLM synthesis",
);
assert(
  regroundChannel.indexOf("assertPersistedProgramBriefIdentity(identity") < regroundChannel.indexOf("await deps.loadGrounding") &&
    regroundChannel.indexOf("assertPersistedProgramBriefIdentity(identity") < regroundChannel.indexOf("await deps.synth"),
  "reground must fail closed before research or Style DNA synthesis",
);
assert.doesNotMatch(coordinator, /groundingSignals\(convex, ownerId, identity\.niche\)/,
  "Educational must query as educational, never its display label");
assert.match(mutations, /assertProgramBriefIdentityMutation\(/);
assert.match(mutations, /channel program brief is immutable once stored/);
assert.match(mutations, /channel program route is immutable once stored/);
assert.match(mutations, /creator intent diagnosis is immutable once stored/);
assert.match(mutations, /requires a sealed creator intent diagnosis/);
assert.match(mutations, /requires a sealed channel program route/);
assert.match(mutations, /channel show profile is immutable once stored/);
assert.match(mutations, /assertChannelShowProfileReceiptPipelineCompatibility\(/,
  "Convex persistence must retain selected capability obligations without importing renderer code");
assert.match(mutations, /assertChannelShowProfileReceiptExactComposition\(/,
  "a first channel admission must bind the receipt to its exact compiler baseline");
assert.match(mutations, /requires the effective pipeline being persisted/,
  "a profile-bearing mutation cannot bypass the write-time graph validation");
assert.match(mutations, /channel pipeline upgrade identity/,
  "the atomic compiler-upgrade mutation must retain the same profile compatibility gate");
assert.match(showProfileCodec, /channel show profile does not match the canonical channel program brief/);
assert.doesNotMatch(showProfileCodec, /from\s+["']@\/engine\/creative\/creativeCapabilityCatalog["']/,
  "the Convex receipt codec must not re-import the renderer-coupled rich catalog");
assert.match(schema, /programBrief:\s*v\.optional\(/);
assert.match(schema, /programRoute:\s*v\.optional\(v\.any\(\)\)/);
assert.match(schema, /creatorIntentDiagnosis:\s*v\.optional\(v\.any\(\)\)/);
assert.match(schema, /showProfile:\s*v\.optional\(/);
assert.match(schema, /catalogFingerprint:\s*v\.string\(\)/);
for (const [label, source] of [
  ["create/update mutation identity validator", mutations],
  ["durable channels schema", schema],
] as const) {
  assert.match(
    source,
    /composition:\s*v\.optional\(\s*v\.object\(\s*\{[\s\S]*?definitionFingerprint:\s*v\.string\(\)[\s\S]*?qualityFocus:\s*v\.array\(v\.string\(\)\)[\s\S]*?fingerprint:\s*v\.string\(\)/,
    `${label} must admit the optional sealed composition receipt rather than reject a newly admitted data-story profile`,
  );
  assert.match(
    source,
    /compositionBinding:\s*v\.optional\(v\.any\(\)\)/,
    `${label} must retain a capability-plan binding rather than rejecting the new modular profile authority at persistence`,
  );
}
assert(
  coordinator.indexOf("if (!design.available || !design.productionReady)") <
    coordinator.indexOf('runStage("channel-inception-research"'),
  "unavailable or runtime-blocked families must stop before the first provider-capable stage",
);
assert.match(
  newChannelUi,
  /const selectable = f\.available && !runtimeUnavailable && \(productionReady \|\| Boolean\(supervised\)\)/,
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
  "selectDeterministicQwenVoice",
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
assert.match(coordinator, /synthQwenNarration/);
assert.match(coordinator, /providerRenderReceipt/);
assert.match(coordinator, /localColdOpenReceipt \?\? qualifiedCast\.coldOpenReceipt/);
assert.match(channelVoiceCasting, /runtime config must|configured\["ttsProvider"\] \?\? params\["ttsProvider"\]/);
assert.match(channelVoiceCasting, /Qwen3 channel inception requires an explicit CustomVoice speaker/);
assert.match(channelVoiceCasting, /audioSha256 === cast\.localColdOpenReceipt\.audioFingerprint/);
assert.match(coordinator, /validateVoiceCastingReadinessReceipt/);
assert.match(coordinator, /validatePipelineVoiceWiring/);
assert.match(coordinator, /voiceColdOpenEvidence/);
assert.doesNotMatch(coordinator, /\{ castVoice, gateColdOpen \}/,
  "channel inception must not route voice casting through the retired Gemini audio judge");
assert.match(coordinator, /positioningIdentityProjection/);
assert.match(coordinator, /seoIdentityProjection/);
assert.match(coordinator, /channelArtIdentityFromSource\(/,
  "channel artwork must use the shared identity derivation instead of duplicating a generic niche prompt");
assert.match(coordinator, /styleDNA:\s*positioning\.styleDNA/,
  "channel banners must receive the frozen Style DNA world through the shared identity derivation");
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
assert.match(coordinator, /version:\s*\{ avatar: avatarStage\.inputFingerprint\.slice\(0, 20\) \}/);
assert.match(coordinator, /version:\s*\{ banner: bannerStage\.inputFingerprint\.slice\(0, 20\) \}/);
assert.doesNotMatch(coordinator, /providerLifecycle/,
  "Fal banner and avatar transports own their durable idempotency context; a retired direct-worker lifecycle must not survive");
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
const privateReviewAdmissionGate = route.indexOf(
  "if (!reviewedDataStoryIntake && privateReviewOffers.length)",
);
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
assert.match(newChannelUi, /const programBrief = createChannelProgramBrief\(\{[\s\S]*?concept,[\s\S]*?\}\);/,
  "the recoverable build request must bind the exact creator concept into its canonical program brief");

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

// A legacy row at the idempotency key is not a resumable shell. It must carry
// the exact sealed brief before the coordinator can mutate it or enter a stage.
const existingProgramBriefGate = coordinator.indexOf(
  "assertPersistedProgramBriefIdentity(existingAtStart.identity",
);
const existingFamilyBackfill = coordinator.indexOf("api.channels.backfillChannelFamily");
const researchStage = coordinator.indexOf('runStage("channel-inception-research"');
assert(
  existingProgramBriefGate > coordinator.indexOf("const existingAtStart =") &&
    existingProgramBriefGate < existingFamilyBackfill &&
    existingProgramBriefGate < researchStage,
  "an existing row without the exact canonical brief must fail before Convex stage mutations or research",
);
assert.match(
  coordinator,
  /expectedProgramBrief: programBrief/,
  "an existing retry must bind exactly to the submitted canonical program brief",
);
assert.match(
  coordinator,
  /requireProgramBrief: true/,
  "a partial legacy row with the brief missing must not resume into research",
);
const existingShowProfileGate = coordinator.indexOf("existingChannelInceptionRetryShowProfile({");
assert(
  existingShowProfileGate > coordinator.indexOf("const existingAtStart =") &&
    existingShowProfileGate < existingFamilyBackfill &&
    existingShowProfileGate < researchStage,
  "an existing retry must prove the exact sealed composition before it can mutate or research",
);
const routeLessLegacySnapshotGate = coordinator.indexOf("routeLessLegacyInceptionCanResume({");
assert(
  routeLessLegacySnapshotGate > existingShowProfileGate &&
    routeLessLegacySnapshotGate < existingFamilyBackfill &&
    routeLessLegacySnapshotGate < researchStage,
  "a route-less historical retry must prove its exact snapshot before any mutation or inception work",
);
assert.match(coordinator, /showProfileFingerprint: channelShowProfileFingerprint\(args\.showProfile\)/,
  "pipeline certification must carry the composition receipt fingerprint");
assert.match(coordinator, /channelInceptionSnapshotCanResume\(\{[\s\S]*?showProfile: requestShowProfile/,
  "an immutable inception snapshot cannot be reused for another profile");
assert.match(coordinator, /channelInceptionSnapshotCanResume\(\{[\s\S]*?programRoute: requestProgramRoute/,
  "an immutable inception snapshot cannot be reused for another route");
assert.match(coordinator, /channelInceptionSnapshotCanResume\(\{[\s\S]*?creatorIntentDiagnosis: requestCreatorIntentDiagnosis/,
  "an immutable inception snapshot cannot be reused under a different creator-intent diagnosis");
assert.match(route, /deriveCreatorIntentDiagnosis\(\{[\s\S]*?programBrief,[\s\S]*?programRoute,/,
  "the authenticated build route must derive the diagnosis server-side before approvals and Trigger dispatch");
assert.match(route, /creator intent diagnoses are server-derived/,
  "the authenticated build route must reject browser-supplied diagnosis receipts");
assert.match(coordinator, /new channel inception requires a sealed channel show profile/);
assert.match(coordinator, /a route-less historical channel may only resume its exact already-durable route-less snapshot/,
  "legacy retries must prove their old snapshot rather than synthesizing a current route");

const pipelineProfileGate = pipelineRunner.indexOf("assertChannelShowProfilePipelineCompatibility({");
const pipelineRuntimeGate = pipelineRunner.indexOf("assertPipelineVideoRuntimeReady(entries, reviewedLtxRuntime?.runtime)");
assert(
  pipelineProfileGate >= 0 && pipelineProfileGate < pipelineRuntimeGate,
  "frozen pipeline execution must validate the sealed composition before runtime/provider preflight",
);
assert.match(pipelineRunner, /frozen pipeline invocation channel show profile does not match current channel composition/);
assert.match(pipelineRunner, /showProfileFingerprint/);

// Style DNA / quality bar are the other field pair six legacy channels lack.
// Positioning is an unconditional stage, and both its resume readers demand the
// pair, so no channel can complete inception without them.
assert.match(coordinator, /const qualityBar = buildQualityBar\(positioningStage\.params\.family, styleDNA, now\)/);
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
