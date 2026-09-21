import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";

type Row = Record<string, unknown>;
const binding = { version: "worker-a", projectId: "project-a", environmentId: "environment-a" };
const scope = { project: { id: binding.projectId }, environment: { id: binding.environmentId }, run: { version: "worker-b" } };
const receipt = {
  runId: "run-a", channelId: "channel-a", invocationSha256: "a".repeat(64),
  checkpointId: "checkpoint-a", checkpointFingerprint: "b".repeat(64),
  qualityReceiptFingerprint: "c".repeat(64), approvalFingerprint: "d".repeat(64),
  attempt: 0, retryAt: 2_000_000,
};
let mode = "serialized";
let transported: unknown;
let research = false;
let researchCalls = 0;
let networkCalls = 0;
let empty = false;
let failPreparation = false;
let failEnqueue = false;
let failAcknowledgement = false;
let invalidYuE2Preparation: "missing" | "oversized" | undefined;
let preparedYuE2: Row | undefined;
const queries: string[] = [];
const triggers: { task: string; payload: Row; options: Row }[] = [];
const keys: { seed: string; options?: Row }[] = [];
const mutations: string[] = [];
const fields = () => transported === undefined ? {} : { workerDeployment: transported };
class Convex {
  async query(ref: Parameters<typeof getFunctionName>[0]): Promise<unknown> {
    const name = getFunctionName(ref);
    queries.push(name);
    if (name === "channels:listChannels") return mode === "doctor" ? [] : [{
      _id: "channel-a", name: "Channel", slug: "channel", status: "active", family: "narrated_stock",
      identity: {}, casefileAutoResearchEnabled: research,
    }];
    if (name === "runs:listDueSerializedProgramEpisodeRetries") return [{ ...receipt, attempt: 1, ...fields() }];
    if (name === "factualReviewCheckpoints:listPendingResumes") return mode === "factual" ? [{ ...receipt, ...fields() }] : [];
    if (name === "musicAuditionCheckpoints:listPendingResumes") return mode === "music" ? [{ ...receipt, ...fields() }] : [];
    if (name === "runs:listAutomaticResumeCandidates") return [{ _id: receipt.runId, channelId: receipt.channelId,
      workerDeployment: { ...binding, version: "stale-candidate-version" } }];
    if (name === "runs:listPendingPublishContinuations") return [];
    throw new Error(`unexpected query ${name}`);
  }
  async mutation(ref: Parameters<typeof getFunctionName>[0], args: Row = {}): Promise<unknown> {
    const name = getFunctionName(ref);
    mutations.push(name);
    if (name.endsWith(":prepareResumeDispatch")) {
      if (failPreparation) throw new Error("fixture preparation unavailable");
      const selected = (mode === "music" && name.startsWith("musicAuditionCheckpoints:")) ||
        (mode === "factual" && name.startsWith("factualReviewCheckpoints:"));
      const music = name.startsWith("musicAuditionCheckpoints:");
      if (music) assert.equal(args.includeYuE2, true);
      return { recovery: { requeued: 0, blocked: 0 }, pending: empty || !selected ? [] : [{ ...receipt, ...fields() }],
        ...(music && invalidYuE2Preparation !== "missing" ? { yue2Pending: invalidYuE2Preparation === "oversized" ? Array(26).fill(receipt) : preparedYuE2 ? [preparedYuE2] : [] } : {}) };
    }
    if (name === "yue2Continuations:recordDispatch" && preparedYuE2) {
      assert.deepEqual(args.resume, preparedYuE2.yue2AuditionResume);
      assert.equal(args.attempt, 1); assert.equal(args.triggerRunId, "trigger-a");
      return null;
    }
    if (name.endsWith(":reapExpiredQueuedResumes") || name === "runs:reapExpiredQueuedPublishContinuations") return { requeued: 0, blocked: 0 };
    if (name === "contentPlan:claimNextPlanRun") return { state: "cadence", runId: receipt.runId, reused: true, ...fields() };
    if (name === "runs:claimAutomaticResume") return { state: "queued", attempts: 2, reused: true, ...fields() };
    if (failAcknowledgement && name.endsWith(":markResumeQueued")) throw new Error("fixture acknowledgement lost");
    if (name.endsWith(":markResumeQueued") || name.endsWith(":recordResumeEnqueueFailure") || name === "runs:recordAutomaticResumeDispatchFailure") return null;
    throw new Error(`unexpected mutation ${name}`);
  }
}
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalEnv = { url: process.env.NEXT_PUBLIC_CONVEX_URL, engagement: process.env.STUDIO_ENGAGEMENT_AUTOMATION, allow: process.env.STUDIO_AUTO_CHANNELS, owner: process.env.STUDIO_OWNER_ID };
process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.invalid";
process.env.STUDIO_ENGAGEMENT_AUTOMATION = "off";
process.env.STUDIO_AUTO_CHANNELS = "";
process.env.STUDIO_OWNER_ID = "owner-a";
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
console.log = () => {};
loader._load = function (id, ...args) {
  if (id === "@trigger.dev/sdk") return {
    task: (definition: unknown) => definition, schedules: { task: (definition: unknown) => definition },
    idempotencyKeys: { create: async (seed: string, options?: Row) => { keys.push({ seed, options }); return `key:${seed}`; } },
    tasks: { trigger: async (task: string, payload: Row, options: Row) => {
      triggers.push({ task, payload, options });
      if (failEnqueue) throw new Error("fixture enqueue failed");
      return { id: "trigger-a" };
    } },
  };
  if (id === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Convex };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
  if (id === "@/lib/automationGate") return { STUDIO_AUTOMATION_GATES: { autopilot: "autopilot" }, studioAutomationGate: () => ({ enabled: true }) };
  if (id === "@/lib/storage") return { putObject: async () => {} };
  if (id === "@/lib/goldenChannelSync") return { syncChannelPipelines: async () => ({ checked: 0, changed: 0, applied: 0, conflicts: 0, verified: false, verification: "skipped" }) };
  if (id === "@/lib/youtubeConnector") return { requireInternalQuerySecret: () => "test-secret" };
  if (id === "@/lib/creativeText") return { creativeTextJson: async () => { throw new Error("diagnosis provider forbidden"); } };
  if (id === "@/engine/dataStorySchedulerAdmission") return { sourceDataStorySchedulerAdmission: () => ({ automatic: true }) };
  if (id === "@/engine/automaticCreatorBriefAdmission") return { automaticCreatorBriefAdmission: () => ({ automatic: true }) };
  if (id === "@/engine/automaticFamilyExecutionReadiness") return { automaticFamilyExecutionReadinessAdmission: () => ({ automatic: true }) };
  if (id === "@/engine/productionRouteQualificationAdmission") return {
    productionRouteQualificationRequirement: () => ({ requiresReceipt: false }),
    productionRouteQualificationReceiptAdmission: () => ({ automatic: true }),
  };
  if (id === "@/engine/narrativeSeriesSchedulerAdmission") return { narrativeSeriesSchedulerRequirement: () => ({ status: "not_required" }) };
  if (id === "@/engine/casefileAutoResearchDispatch") return {
    casefileResearchDayKey: () => "2026-09-19", parseCasefileAutoResearchDailyLimit: () => 1,
    casefileAutoResearchRouteAdmission: () => ({ eligible: true }),
    dispatchCasefileAutoResearch: async (_input: unknown, deps: { triggerPipeline: (input: Row) => Promise<unknown> }) => {
      researchCalls++;
      await deps.triggerPipeline({ casefileSourcePacketInput: { fixture: true } });
      return { outcome: "researched_and_triggered" };
    },
  };
  return originalLoad.call(this, id, ...args);
};

async function main() {
  // Load only after installing the CommonJS boundary mocks above.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const tasks = {
    serialized: require("../serializedProgramEpisodeRetryDispatcher").serializedProgramEpisodeRetryDispatcher,
    factual: require("../factualReviewContinuationDispatcher").factualReviewContinuationDispatcher,
    music: require("../musicAuditionContinuationDispatcher").musicAuditionContinuationDispatcher,
    scheduler: require("../scheduler").generationScheduler,
    doctor: require("../pipelineDoctor").pipelineDoctorTask,
  } as Record<string, { run: (payload?: Row, options?: Row) => Promise<unknown> }>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const invoke = async (kind: string, context?: Row) => {
    triggers.length = 0; keys.length = 0; mutations.length = 0; queries.length = 0; researchCalls = 0;
    try { await tasks[kind].run({}, context === undefined ? undefined : { ctx: context }); }
    catch (error) {
      assert.match(String(error), /worker deployment|verified dispatch project\/environment/);
    }
  };
  for (const kind of ["music", "factual"]) {
    mode = kind;
    empty = true;
    await invoke(kind);
    assert.equal(mutations.length, 1, "idle recovery prepares both music checkpoint stores in one Convex call");
    assert.match(mutations[0], /:prepareResumeDispatch$/);
    assert.deepEqual(queries, []);
    assert.deepEqual(triggers, []);
    assert.deepEqual(keys, []);
    failPreparation = true;
    await assert.rejects(tasks[kind].run(), /fixture preparation unavailable/);
    assert.deepEqual(triggers, [], "failed preparation cannot authorize delivery");
    failPreparation = false;
    empty = false;
    failAcknowledgement = true;
    await invoke(kind);
    assert.equal(triggers.length, 1);
    assert.equal(mutations.length, 2);
    assert.match(mutations[1], /:markResumeQueued$/);
    assert.deepEqual(queries, []);
    failAcknowledgement = false;
    failEnqueue = true;
    await invoke(kind);
    assert.equal(triggers.length, 1);
    assert.equal(mutations.length, 2);
    assert.match(mutations[1], /:recordResumeEnqueueFailure$/);
    failEnqueue = false;
  }
  mode = "music";
  for (const malformed of ["missing", "oversized"] as const) {
    invalidYuE2Preparation = malformed;
    triggers.length = 0; mutations.length = 0; keys.length = 0;
    await assert.rejects(tasks.music.run({}, { ctx: scope }), /bounded YuE2 preparation evidence/);
    assert.equal(mutations.length, 1); assert.deepEqual(triggers, []); assert.deepEqual(keys, []);
  }
  invalidYuE2Preparation = undefined;
  empty = true;
  preparedYuE2 = { channelId: receipt.channelId, runId: receipt.runId, invocationSha256: receipt.invocationSha256,
    attempt: 1, workerDeployment: binding, yue2AuditionResume: {
      checkpointId: "yue2-checkpoint", checkpointFingerprint: receipt.checkpointFingerprint,
      approvalFingerprint: receipt.approvalFingerprint, invocationSha256: receipt.invocationSha256,
    } };
  await invoke("music", scope);
  assert.equal(triggers.length, 1);
  assert.deepEqual(triggers[0].payload.yue2AuditionResume, preparedYuE2.yue2AuditionResume);
  assert.equal(triggers[0].options.version, binding.version);
  assert.match(keys[0].seed, /^yue2-audition-resume\/v1:/);
  assert.deepEqual(mutations, ["musicAuditionCheckpoints:prepareResumeDispatch", "yue2Continuations:recordDispatch"]);
  preparedYuE2 = undefined; empty = false;
  for (const kind of Object.keys(tasks)) {
    mode = kind;
    for (const casefile of kind === "scheduler" ? [false, true] : [false]) {
      research = casefile;
      transported = undefined;
      await invoke(kind);
      assert.equal(triggers.length, 1, `${kind}: historical fixture without SDK context still dispatches`);
      const historical = structuredClone(triggers[0]);
      const historicalKeys = structuredClone(keys);
      assert.equal(Object.hasOwn(historical.options, "version"), false);
      transported = binding;
      await invoke(kind, scope);
      assert.equal(triggers.length, 1, `${kind}: dispatcher B must resume pinned worker A`);
      assert.deepEqual(triggers[0], { ...historical, options: { ...historical.options, version: binding.version } });
      assert.deepEqual(keys, historicalKeys, `${kind}: preserve idempotency seed and scope exactly`);
      if (kind !== "scheduler") assert.deepEqual(keys[0].options, { scope: "global" });
      else assert.equal(keys[0].options, undefined, "scheduler scope stays unchanged");
      if (kind === "doctor") assert.equal(keys[0].seed, "automatic-resume:owner-a:run-a:attempt:2");
      if (kind === "serialized") assert.equal(keys[0].seed, "serialized-program-episode-busy:run-a:attempt:1:at:2000000");
      for (const context of [undefined, { ...scope, project: { id: "foreign-project" } }, { ...scope, environment: { id: "foreign-environment" } }]) {
        await invoke(kind, context);
        assert.equal(triggers.length, 0, `${kind}: reject unavailable/foreign dispatch scope`);
        assert.equal(researchCalls, 0, "scheduler must reject before entering research");
      }
      transported = { ...binding, version: " " };
      await invoke(kind, scope);
      assert.equal(triggers.length, 0, `${kind}: malformed binding must not fall back to latest`);
      assert.equal(researchCalls, 0);
    }
  }
  assert.equal(networkCalls, 0);
  originalLog("SAME-RUN WORKER DISPATCH PASS: five real task dispatch paths, worker B pins A, historical absence, unchanged keys/scopes, malformed/foreign/missing-context rejection, pre-research scheduler fence");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch; console.log = originalLog;
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_CONVEX_URL: originalEnv.url, STUDIO_ENGAGEMENT_AUTOMATION: originalEnv.engagement, STUDIO_AUTO_CHANNELS: originalEnv.allow, STUDIO_OWNER_ID: originalEnv.owner })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
