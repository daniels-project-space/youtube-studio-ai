/**
 * Paid weekly script producer.
 *
 * `plan-week-ahead` freezes the editorial packet; this task authors the
 * episode script once, persists the exact normalized Script, and lets the
 * scheduled runner consume it without paying for a second creative-text pass.
 * The sidecar is immutable and replay-safe, and unpriced OpenRouter usage is
 * never presented as a successful automatic preparation.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import {
  assertPlanWeekPreparedScriptBinding,
  assertPlanWeekPreparationManifestBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedScriptKey,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedScript,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { parseChannelProgramRouteRunSeed, type ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes, putObject } from "@/lib/storage";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent as objectNotFound } from "@/lib/preparedMediaStorage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { createModelUsageScope } from "@/lib/modelUsage";
import { synthScript, type Script, type ScriptRequest } from "@/lib/scriptGen";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";

export interface PlanWeekPreparedScriptArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxSeconds?: number;
  language?: string;
  style?: string;
  maxCostUsd: number;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared script ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared script ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

export function assertPlanWeekPreparedScriptArgs(value: unknown): PlanWeekPreparedScriptArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared script payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) {
    throw new Error("weekly prepared script manifest key is not canonical");
  }
  const maxSeconds = raw.maxSeconds === undefined ? 240 : raw.maxSeconds;
  if (typeof maxSeconds !== "number" || !Number.isFinite(maxSeconds) || maxSeconds < 30 || maxSeconds > 1_800) {
    throw new Error("weekly prepared script maxSeconds must be between 30 and 1800");
  }
  const maxCostUsd = raw.maxCostUsd;
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("weekly prepared script maxCostUsd must be greater than zero and no more than 100");
  }
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256,
    maxSeconds,
    ...(typeof raw.language === "string" && raw.language.trim() ? { language: raw.language.trim() } : {}),
    ...(typeof raw.style === "string" && raw.style.trim() ? { style: raw.style.trim() } : {}),
    maxCostUsd,
  };
}

async function readPreparationManifest(payload: PlanWeekPreparedScriptArgs): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(payload.manifestKey, undefined, PREPARED_METADATA_READ);
  if (sha256BytesHex(bytes) !== payload.manifestSha256) throw new Error("weekly prepared script manifest digest mismatch");
  const manifest = normalizePlanWeekPreparationManifest(decodePreparedMetadata(bytes));
  return assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer: { version: PLAN_WEEK_PREPARATION_VERSION, manifestKey: payload.manifestKey, manifestSha256: payload.manifestSha256 },
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    batchId: payload.batchId,
    itemId: payload.itemId,
    itemKey: manifest.itemKey,
    requestKey: manifest.requestKey,
    channelSlug: payload.channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey: manifest.plan.thumbnailKey,
    thumbnailSource: manifest.plan.thumbnailSource,
  });
}

async function readSidecar(key: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedScript | null> {
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(key, undefined, PREPARED_METADATA_READ); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedScriptBinding({ prepared: decodePreparedMetadata(bytes), manifest });
  return prepared;
}

function seedRecord(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const value = manifest.execution.seedStore;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared script seed store is invalid");
  return value;
}

function routeSeed(manifest: PlanWeekPreparationManifest): ChannelProgramRouteRunSeed | undefined {
  const value = seedRecord(manifest).channelProgramRoute;
  return value === undefined ? undefined : parseChannelProgramRouteRunSeed(value);
}

function scriptRequest(manifest: PlanWeekPreparationManifest, payload: PlanWeekPreparedScriptArgs): ScriptRequest {
  const seed = seedRecord(manifest);
  const route = routeSeed(manifest);
  const moduleConfig = manifest.execution.moduleConfig;
  const scriptConfig = moduleConfig.script_gen ?? {};
  const narrative = seed.styleDNA && typeof seed.styleDNA === "object" && !Array.isArray(seed.styleDNA)
    ? (seed.styleDNA as Record<string, unknown>).narrative
    : undefined;
  return {
    topic: manifest.plan.topic,
    channelName: typeof seed.channelName === "string" ? seed.channelName : undefined,
    persona: typeof seed.persona === "string" ? seed.persona : undefined,
    niche: typeof seed.niche === "string" ? seed.niche : undefined,
    style: payload.style ?? (typeof scriptConfig.style === "string" ? scriptConfig.style : undefined),
    qualityProfile: "production",
    language: payload.language ?? (typeof scriptConfig.language === "string" ? scriptConfig.language : undefined),
    maxSeconds: payload.maxSeconds,
    endWithSummary: scriptConfig.endWithSummary === false ? false : true,
    sentenceGapSec: typeof scriptConfig.sentenceGapSec === "number" ? scriptConfig.sentenceGapSec : undefined,
    ttsSpeed: typeof scriptConfig.ttsSpeed === "number" ? scriptConfig.ttsSpeed : undefined,
    voiceTags: scriptConfig.voiceTags === true,
    dataRich: scriptConfig.dataRich === true,
    sourceAttributionRequired: scriptConfig.sourceAttributionRequired === true,
    weeklyPreparationBrief: manifest.prompts.script,
    programRoute: route,
    narrative: narrative && typeof narrative === "object" && !Array.isArray(narrative)
      ? narrative as ScriptRequest["narrative"]
      : undefined,
    playbook: seed.scriptPlaybook as ScriptRequest["playbook"],
    openingDeviceIdx: [...manifest.requestKey].reduce((sum, char) => sum + char.charCodeAt(0), 0),
  };
}

async function persistCreateOnly(key: string, body: Uint8Array): Promise<boolean> {
  try {
    await putObject(key, body, {
      contentType: "application/json",
      metadata: { "plan-week-prepared-script": "v1", sha256: sha256BytesHex(body) },
      ifNoneMatch: "*",
    });
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
    return false;
  }
}

async function dispatchPreparedNarration(manifest: PlanWeekPreparationManifest, payload: PlanWeekPreparedScriptArgs): Promise<string> {
  const maxCostUsd = Number(process.env.PLAN_WEEK_PREPARED_NARRATION_MAX_COST_USD ?? "3");
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("weekly prepared narration dispatch has an invalid cost ceiling");
  }
  const narrationPayload = {
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    channelSlug: payload.channelSlug,
    batchId: payload.batchId,
    itemId: payload.itemId,
    manifestKey: payload.manifestKey,
    manifestSha256: payload.manifestSha256,
    maxCostUsd,
  };
  const idempotencyKey = await idempotencyKeys.create(
    `plan-week-narration:${payload.ownerId}:${payload.manifestSha256}`,
    { scope: "global" },
  );
  const handle = await tasks.trigger("plan-week-prepared-narration", narrationPayload, {
    concurrencyKey: `plan-week-narration:${manifest.ownerId}:${manifest.channelId}`,
    idempotencyKey,
  });
  return handle.id;
}

export const planWeekPreparedScriptTask = task({
  id: "plan-week-prepared-script",
  maxDuration: 1_800,
  // A transient model/R2 failure must not strand the weekly slate. The
  // producer is create-only and the sidecar is content-addressed, so a retry
  // after a completed write reuses the exact script without another model
  // call; the bounded two-attempt policy keeps failures and spend visible.
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 120_000, factor: 2 },
  queue: { concurrencyLimit: 2 },
  run: async (rawPayload: PlanWeekPreparedScriptArgs) => {
    const payload = assertPlanWeekPreparedScriptArgs(rawPayload);
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "openrouter"],
      required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "OPENROUTER_API_KEY"],
    });
    const manifest = await readPreparationManifest(payload);
    assertWeeklyPreparationVersionsSupported(manifest.execution.pipeline, "plan-week-prepared-script");
    const sidecarKey = planWeekPreparedScriptKey({
      ownerId: payload.ownerId,
      channelSlug: payload.channelSlug,
      batchId: payload.batchId,
      itemId: payload.itemId,
    });
    const prior = await readSidecar(sidecarKey, manifest);
    if (prior) {
      const narrationTriggerRunId = await dispatchPreparedNarration(manifest, payload);
      return { ok: true, reused: true, sidecarKey, narrationTriggerRunId, costUsd: 0, scriptSha256: prior.scriptSha256 };
    }

    const usage = createModelUsageScope();
    let script: Script;
    await usage.run(async () => {
      script = await synthScript(scriptRequest(manifest, payload));
    });
    const modelUsage = usage.snapshot();
    if (modelUsage.unpricedCalls > 0) {
      throw new Error("weekly prepared script usage is unpriced; refusing an automatic success");
    }
    if (!Number.isFinite(modelUsage.costUsd) || modelUsage.costUsd > payload.maxCostUsd) {
      throw new Error(`weekly prepared script cost ${modelUsage.costUsd} exceeds its ${payload.maxCostUsd} USD ceiling`);
    }
    const prepared: PlanWeekPreparedScript = {
      version: "plan-week-prepared-script/v1",
      manifestSha256: planWeekPreparationManifestSha256(manifest),
      ownerId: manifest.ownerId,
      channelId: manifest.channelId,
      batchId: manifest.batchId,
      itemId: manifest.itemId,
      requestKey: manifest.requestKey,
      topic: manifest.plan.topic,
      script: script!,
      scriptSha256: sha256Hex(canonicalJson(script!)),
      createdAt: Date.now(),
    };
    assertPlanWeekPreparedScriptBinding({ prepared, manifest });
    const body = new TextEncoder().encode(canonicalJson(prepared));
    const created = await persistCreateOnly(sidecarKey, body);
    if (!created) {
      const winner = await readSidecar(sidecarKey, manifest);
      if (!winner) throw new Error("weekly prepared script sidecar was lost after create-only collision");
      const narrationTriggerRunId = await dispatchPreparedNarration(manifest, payload);
      return { ok: true, reused: true, sidecarKey, narrationTriggerRunId, costUsd: 0, scriptSha256: winner.scriptSha256 };
    }
    const narrationTriggerRunId = await dispatchPreparedNarration(manifest, payload);
    return { ok: true, reused: false, sidecarKey, narrationTriggerRunId, costUsd: modelUsage.costUsd, scriptSha256: prepared.scriptSha256 };
  },
});
