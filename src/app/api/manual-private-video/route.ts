import { NextResponse } from "next/server";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { resolveContentLane } from "@/engine/contentLane";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertChannelInceptionProbeAttempt, freezeChannelInceptionProbeContext,
  freezeChannelInceptionProbeInput, prepareChannelInceptionProbeAttempt,
  type ChannelInceptionProbeAttemptCheckpoint,
} from "@/lib/channelInceptionProbe";
import { MAX_CHANNEL_INCEPTION_PROBE_COST_USD } from "@/lib/channelInceptionProbeContract";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { privatePipelineConfigurationPreflight } from "@/lib/privateBenchmarkPreflight";
import { privateTriggerRequestOptions } from "@/lib/privateTriggerTarget";
import { readBoundedRequestText, RequestBodyTooLarge } from "@/lib/readBoundedRequestText";
import { buildManualPrivateVideoPipeline } from "@/lib/manualPrivateVideoPipeline";
import { manualPrivateRequestFingerprint as fingerprintManualRequest } from "@/lib/manualPrivateRequestFingerprint";
import { sha256Hex } from "@/lib/sha256";
import { issueStudioActionApproval, pipelineProbeApprovalSubject } from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_CAPABILITY_UNVERIFIED = "The deployed worker's support for the saved duration has not been verified. This configuration check cannot confirm the private video is ready.";

function privateTriggerTarget() {
  try { return privateTriggerRequestOptions(process.env); } catch { return undefined; }
}

function assertManualEnvelope(envelope: ChannelInceptionProbeAttemptCheckpoint, ownerId: string, channelId: string, runId: string, maximumCostUsd: number) {
  assertChannelInceptionProbeAttempt(envelope);
  if (envelope.ownerId !== ownerId || envelope.channelId !== channelId || envelope.runId !== runId || envelope.maximumCostUsd !== maximumCostUsd || envelope.input.invocationContext.invocationKind !== "manual_private_video") throw new Error("Existing private request does not match its original authorization");
}

function configurationBlocker(channel: Parameters<typeof privatePipelineConfigurationPreflight>[0], maximumCostUsd: number): string | undefined {
  const preflight = privatePipelineConfigurationPreflight(channel, maximumCostUsd);
  if (preflight.blockers.length) return preflight.blockers[0];
  const family = resolveContentLane({ stored: channel.contentLane, family: channel.family, pipeline: channel.pipeline }).family;
  if (!family || !(FAMILY_KEYS as readonly string[]).includes(family)) return "The channel's video format must be resolved before a private run.";
  if (typeof channel.budget !== "number" || !Number.isFinite(channel.budget) || channel.budget <= 0) return "Set a positive channel budget before starting a private video.";
}

/** Owner-scoped, no-write check before allocating a request key. */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") return NextResponse.json({ error: "Private Automation mode is required." }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const channelId = params.get("channelId"), rawCeiling = params.get("maximumCostUsd");
    const ceiling = rawCeiling === null || !rawCeiling.trim() ? NaN : Number(rawCeiling);
    if (!channelId || channelId.length > 300 || !Number.isFinite(ceiling) || ceiling <= 0 || ceiling > MAX_CHANNEL_INCEPTION_PROBE_COST_USD) return NextResponse.json({ error: "Choose a valid channel and cost ceiling." }, { status: 400 });
    if (!privateTriggerTarget()) return NextResponse.json({ ok: false, error: "Private Automation requires an explicit loopback Trigger API origin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const channel = await new StudioConvexHttpClient(url).query(api.channels.getChannel, { channelId: channelId as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    const blocker = configurationBlocker(channel, ceiling);
    if (blocker) return NextResponse.json({ ok: false, error: blocker }, { status: 422, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true, warning: WORKER_CAPABILITY_UNVERIFIED, workerCapabilityChecked: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not check the private video configuration." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

/** Owner-confirmed, no-delivery execution of the saved full-length pipeline. */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") return NextResponse.json({ error: "Private Automation mode is required." }, { status: 403 });
    let body: Record<string, unknown>;
    try { body = JSON.parse(await readBoundedRequestText(request, 100_000)); }
    catch (error) {
      const tooLarge = error instanceof RequestBodyTooLarge;
      return NextResponse.json({ error: tooLarge ? "Private video request is too large." : "Invalid private video request." }, { status: tooLarge ? 413 : 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["channelId", "requestKey", "maximumCostUsd", "confirmPrivateVideo"].includes(key)) ||
        typeof body.channelId !== "string" || !body.channelId || body.channelId.length > 300 ||
        typeof body.requestKey !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestKey) ||
        typeof body.maximumCostUsd !== "number" || !Number.isFinite(body.maximumCostUsd) || body.maximumCostUsd <= 0 || body.maximumCostUsd > MAX_CHANNEL_INCEPTION_PROBE_COST_USD || body.confirmPrivateVideo !== true) {
      return NextResponse.json({ error: "Confirm a private video, channel, request key and valid cost ceiling." }, { status: 400 });
    }
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const convex = new StudioConvexHttpClient(url);
    const channelId = body.channelId as Id<"channels">;
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel || channel.ownerId !== actor.ownerId) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    const dispatchKey = `manual-private-video:${body.requestKey}`;
    const existing = await convex.query(api.runs.getProbeRunByDispatchKey, { ownerId: actor.ownerId, channelId, dispatchKey });
    if (existing?.status === "canceled" && existing.error === "Manual request canceled before sealing because channel settings or spending ceiling changed.") {
      return NextResponse.json({ error: "The previous unstarted request was canceled; start a new one.", restartAllowed: true }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (existing?.probeDispatchEnvelope && ["running", "ok", "failed", "canceled"].includes(existing.status)) {
      if (existing.ownerId !== actor.ownerId || existing.channelId !== channelId) throw new Error("Private run identity mismatch");
      assertManualEnvelope(existing.probeDispatchEnvelope as ChannelInceptionProbeAttemptCheckpoint, actor.ownerId, String(channelId), String(existing._id), body.maximumCostUsd);
      return NextResponse.json({ ok: true, state: existing.status, runId: String(existing._id), privateOnly: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const triggerOptions = privateTriggerTarget();
    if (!triggerOptions) return NextResponse.json({ error: "Private Automation requires an explicit loopback Trigger API origin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const manualRequestFingerprint = fingerprintManualRequest(channel, body.maximumCostUsd);
    if (existing && !existing.probeDispatchEnvelope && existing.manualPrivateRequestFingerprint !== manualRequestFingerprint) {
      const canceled = await convex.mutation(api.runs.cancelUnsealedManualPrivateRun, { ownerId: actor.ownerId, channelId, runId: existing._id, currentFingerprint: manualRequestFingerprint });
      if (canceled) return NextResponse.json({ error: "Channel settings or the spending ceiling changed before the previous request was sealed. That unstarted request was canceled; start a new one.", restartAllowed: true }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ error: "The previous private request may have started. Check its run before trying again.", runId: String(existing._id) }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (!existing?.probeDispatchEnvelope) {
      const blocker = configurationBlocker(channel, body.maximumCostUsd);
      if (blocker) return NextResponse.json({ error: blocker }, { status: 422 });
    }
    const runId = await convex.mutation(api.runs.createProbeRun, {
      ownerId: actor.ownerId, channelId, dispatchKey,
      manualRequestFingerprint, manualMaximumCostUsd: body.maximumCostUsd,
    });
    const run = await convex.query(api.runs.getRun, { runId });
    if (!run || run.ownerId !== actor.ownerId || run.channelId !== channelId) throw new Error("Private run could not be reloaded");
    let envelope = run.probeDispatchEnvelope as ChannelInceptionProbeAttemptCheckpoint | undefined;
    if (!envelope) {
      const pipeline = buildManualPrivateVideoPipeline(channel.pipeline);
      const family = resolveContentLane({ stored: channel.contentLane, family: channel.family, pipeline: channel.pipeline }).family;
      if (!family || !(FAMILY_KEYS as readonly string[]).includes(family)) return NextResponse.json({ error: "The channel's video format must be resolved before a private run." }, { status: 422 });
      const context = freezeChannelInceptionProbeContext({ ownerId: actor.ownerId, family: family as FamilyKey, channel, thumbnailMode: "deferred_mvp" });
      if (context.channelBudgetUsd <= 0) return NextResponse.json({ error: "Set a positive channel budget before starting a private video." }, { status: 422 });
      const moduleConfigOverride = structuredClone((channel.moduleConfig ?? {}) as Record<string, Record<string, unknown>>);
      const input = freezeChannelInceptionProbeInput({
        pipelineOverride: pipeline, moduleConfigOverride,
        invocationContext: { ...context, invocationKind: "manual_private_video", probeMaximumCostUsd: MAX_CHANNEL_INCEPTION_PROBE_COST_USD },
        productionFingerprint: sha256Hex(canonicalJson({ pipeline: channel.pipeline, moduleConfig: channel.moduleConfig ?? {} })),
      });
      const subject = pipelineProbeApprovalSubject({ ownerId: actor.ownerId, channelId: String(channelId), runId: String(runId), pipelineOverrideFingerprint: input.overrideFingerprint, maximumCostUsd: body.maximumCostUsd });
      const approval = issueStudioActionApproval({ action: "channel-inception-probe", ownerId: actor.ownerId, subject, actor: `authenticated-operator:${actor.ownerId}`, evidence: `Owner confirmed private full-length video request ${body.requestKey}`, maxCostUsd: body.maximumCostUsd });
      const prepared = prepareChannelInceptionProbeAttempt({ attempt: 1, ownerId: actor.ownerId, channelId: String(channelId), runId: String(runId), input, maximumCostUsd: body.maximumCostUsd, approval });
      const claim = await convex.mutation(api.runs.claimProbeDispatchEnvelope, { ownerId: actor.ownerId, channelId, runId, envelope: prepared, fingerprint: prepared.dispatchEnvelopeFingerprint });
      envelope = claim.envelope as ChannelInceptionProbeAttemptCheckpoint;
    }
    assertManualEnvelope(envelope, actor.ownerId, String(channelId), String(runId), body.maximumCostUsd);
    if (["ok", "failed", "canceled"].includes(run.status)) return NextResponse.json({ ok: true, state: run.status, runId: String(runId), privateOnly: true });
    const key = await idempotencyKeys.create(`manual-private-video:${runId}`, { scope: "global" });
    const handle = await tasks.trigger("run-pipeline", {
      channelId: String(channelId), runId: String(runId), pipelineOverride: envelope.input.pipelineOverride,
      moduleConfigOverride: envelope.input.moduleConfigOverride, probeInvocationContext: envelope.input.invocationContext,
      probeAdmission: { maximumCostUsd: envelope.maximumCostUsd, approval: envelope.approval, dispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint },
    }, { concurrencyKey: String(channelId), idempotencyKey: key }, triggerOptions);
    return NextResponse.json({ ok: true, state: "queued", runId: String(runId), taskRunId: handle.id, privateOnly: true, thumbnailDeferred: true, workerCapabilityChecked: false, effectiveCeilingUsd: Math.min(envelope.input.invocationContext.channelBudgetUsd, envelope.maximumCostUsd) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The private request could not be started or confirmed. Retry the same request to avoid a duplicate." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
