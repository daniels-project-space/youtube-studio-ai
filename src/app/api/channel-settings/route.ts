import { NextResponse } from "next/server";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  channelPublishConfiguration,
  getChannelPublishPolicy,
  replaceChannelPublishPolicy,
  type ChannelPublishAction,
} from "@/lib/channelPublishPolicy";
import {
  requireStudioActor,
  StudioAuthError,
} from "@/lib/operatorSession";
import { hydrateEnv } from "@/lib/vault";
import { readBoundedRequestText, RequestBodyTooLarge } from "@/lib/readBoundedRequestText";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { channelScheduleWriteFence } from "@/lib/channelScheduleWriteFence";
import { assertLocalCrosspostAllowed, assertLocalPublicationAllowed, LocalPublicationDisabledError } from "@/lib/localPublicationPolicy";
import {
  assertCasefileAutoResearchLaneEligible,
  isValidChannelBudget,
  SettingsValidationError,
  validatedSchedule,
} from "@/lib/channelSettingsValidation";

export const runtime = "nodejs";

class ChannelSettingsConflict extends Error {}

function assertSettingsApplied(result: { state?: string; blockId?: string }): void {
  if (result.state === "channel_locked") throw new ChannelSettingsConflict("The channel was frozen before the settings change could be saved.");
  if (result.state === "module_locked") throw new ChannelSettingsConflict(`Module '${result.blockId ?? "unknown"}' is locked; the settings change was not saved.`);
}

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new ConvexHttpClient(url);
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message.includes("channel budget changed; reload")) {
    return NextResponse.json({ ok: false, error: "channel budget changed; reload to review the current value and retry" }, { status: 409 });
  }
  if (error instanceof ChannelSettingsConflict) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof LocalPublicationDisabledError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof StudioAuthError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof SettingsValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "settings update failed" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let input: unknown;
    try { input = JSON.parse(await readBoundedRequestText(request, 100_000)); }
    catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof RequestBodyTooLarge ? "settings request is too large" : "invalid settings request" }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ ok: false, error: "invalid settings request" }, { status: 400 });
    const body = input as {
      action?:
        | "publish_mode"
        | "crosspost_policy"
        | "schedule"
        | "status"
        | "budget"
        | "casefile_auto_research";
      channelId?: string;
      mode?: string;
      schedule?: Record<string, unknown>;
      expectedScheduleFence?: string;
      status?: string;
      budget?: number;
      expectedBudget?: number | null;
      approved?: boolean;
      enabled?: boolean;
    };
    if (!body.channelId || !body.action) {
      return NextResponse.json(
        { ok: false, error: "channelId and action are required" },
        { status: 400 },
      );
    }
    if (typeof body.channelId !== "string" || body.channelId.trim() !== body.channelId || body.channelId.length > 256) {
      return NextResponse.json({ ok: false, error: "invalid channelId" }, { status: 400 });
    }
    if (!["publish_mode", "crosspost_policy", "schedule", "status", "budget", "casefile_auto_research"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "unknown settings action" }, { status: 400 });
    }
    await hydrateEnv("youtube");
    const channelId = body.channelId as Id<"channels">;
    const convex = convexClient();
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel || channel.ownerId !== actor.ownerId) {
      return NextResponse.json(
        { ok: false, error: "channel not found" },
        { status: 404 },
      );
    }
    if (channel.locked === true) {
      return NextResponse.json(
        { ok: false, error: "channel is frozen; unlock it in Pipeline modules before changing settings" },
        { status: 409 },
      );
    }

    if (body.action === "publish_mode") {
      if (!body.mode || !["draft", "scheduled", "public"].includes(body.mode)) {
        return NextResponse.json(
          { ok: false, error: "mode must be draft, scheduled, or public" },
          { status: 400 },
        );
      }
      const mode = body.mode;
      if (!channel.pipeline.some((entry) => entry.block === "upload_draft")) {
        return NextResponse.json({ ok: false, error: "channel has no upload_draft module" }, { status: 409 });
      }
      if (mode === "public" || mode === "scheduled") {
        assertLocalPublicationAllowed({ privacyStatus: mode === "public" ? "public" : "private", ...(mode === "scheduled" ? { publishAt: "scheduled" } : {}) });
      }
      const currentPolicy = await getChannelPublishPolicy({
        ownerId: actor.ownerId,
        channelId,
        convex,
      });
      const currentConfiguration = channelPublishConfiguration(channel.pipeline);
      const configuredNow = new Set(currentConfiguration.actions);
      const retainedActions = ((currentPolicy?.status === "active"
        ? currentPolicy.allowedActions
        : []) as ChannelPublishAction[]).filter(
        (action) =>
          action !== "youtube_public" &&
          action !== "youtube_scheduled" &&
          configuredNow.has(action),
      );

      // Remove the old main-video capability before changing the public row.
      // If anything later fails, external publishing remains blocked.
      if (currentPolicy) {
        await replaceChannelPublishPolicy({
          ownerId: actor.ownerId,
          channelId,
          channel,
          allowedActions: retainedActions,
          actor: `${actor.authKind}:${actor.ownerId}`,
          evidence: `main-video publish mode changing to ${mode}`,
          convex,
        });
      }

      let foundUpload = false;
      const pipeline = channel.pipeline.map((entry) => {
        if (entry.block !== "upload_draft") return entry;
        foundUpload = true;
        const params = {
          ...((entry.params ?? {}) as Record<string, unknown>),
        };
        delete params.approvedForPublish;
        return {
          ...entry,
          params: {
            ...params,
            publishMode: mode,
            ...(mode === "draft" ? {} : { approvedForPublish: true }),
          },
        };
      });
      if (!foundUpload) {
        return NextResponse.json(
          { ok: false, error: "channel has no upload_draft module" },
          { status: 409 },
        );
      }
      const expectedPipelineFence = channelPipelineWriteFence(channel);
      let pipelineWrite;
      try {
        pipelineWrite = await convex.mutation(api.channels.updateChannel, { channelId, pipeline, expectedPipelineFence });
      } catch (error) {
        const latest = await convex.query(api.channels.getChannel, { channelId }).catch(() => null);
        if (latest && latest.ownerId === actor.ownerId && channelPipelineWriteFence(latest) !== expectedPipelineFence) {
          return NextResponse.json({ ok: false, error: "Channel settings changed while the publishing update was prepared. Review them and try again." }, { status: 409 });
        }
        throw error;
      }
      if ((pipelineWrite as { state?: string; blockId?: string }).state === "module_locked") {
        return NextResponse.json(
          {
            ok: false,
            error: `Module '${(pipelineWrite as { blockId?: string }).blockId ?? "unknown"}' is locked. Unlock it before changing publishing mode.`,
          },
          { status: 409 },
        );
      }
      if ((pipelineWrite as { state?: string }).state === "channel_locked") {
        return NextResponse.json(
          { ok: false, error: "channel was frozen while this settings change was being prepared" },
          { status: 409 },
        );
      }
      const nextChannel = { ...channel, pipeline };
      const nextConfigured = new Set(
        channelPublishConfiguration(pipeline).actions,
      );
      const desiredActions = retainedActions.filter((action) =>
        nextConfigured.has(action),
      );
      if (mode === "public") desiredActions.push("youtube_public");
      if (mode === "scheduled") desiredActions.push("youtube_scheduled");
      const policy = await replaceChannelPublishPolicy({
        ownerId: actor.ownerId,
        channelId,
        channel: nextChannel,
        allowedActions: desiredActions,
        actor: `${actor.authKind}:${actor.ownerId}`,
        evidence:
          mode === "draft"
            ? "operator returned main-video publishing to private draft"
            : `operator explicitly approved automatic ${mode} YouTube publishing`,
        convex,
      });
      return NextResponse.json({ ok: true, mode, policy });
    }

    if (body.action === "crosspost_policy") {
      if (body.approved === true) assertLocalCrosspostAllowed();
      const configuration = channelPublishConfiguration(channel.pipeline);
      if (body.approved === true && !configuration.actions.includes("crosspost")) {
        return NextResponse.json(
          { ok: false, error: "cross-posting is not configured in this pipeline" },
          { status: 409 },
        );
      }
      const currentPolicy = await getChannelPublishPolicy({
        ownerId: actor.ownerId,
        channelId,
        convex,
      });
      const configured = new Set(configuration.actions);
      const allowedActions = ((currentPolicy?.status === "active"
        ? currentPolicy.allowedActions
        : []) as ChannelPublishAction[]).filter(
        (action) => action !== "crosspost" && configured.has(action),
      );
      if (body.approved === true) allowedActions.push("crosspost");
      const policy = await replaceChannelPublishPolicy({
        ownerId: actor.ownerId,
        channelId,
        channel,
        allowedActions,
        actor: `${actor.authKind}:${actor.ownerId}`,
        evidence:
          body.approved === true
            ? "operator explicitly approved configured cross-posting"
            : "operator revoked configured cross-posting",
        convex,
      });
      return NextResponse.json({ ok: true, policy });
    }

    if (body.action === "schedule") {
      if (!body.schedule || typeof body.schedule !== "object") {
        return NextResponse.json(
          { ok: false, error: "schedule is required" },
          { status: 400 },
        );
      }
      if (typeof body.expectedScheduleFence !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedScheduleFence)) {
        return NextResponse.json({ ok: false, error: "previous schedule is required; reload and retry" }, { status: 400 });
      }
      if (body.expectedScheduleFence !== channelScheduleWriteFence(channel.schedule)) {
        return NextResponse.json({ ok: false, error: "The schedule changed while you were editing. Review it and try again." }, { status: 409 });
      }
      const schedule = validatedSchedule(
        (channel.schedule ?? {}) as Record<string, unknown>,
        body.schedule,
      );
      const expectedScheduleFence = body.expectedScheduleFence;
      try {
        assertSettingsApplied(await convex.mutation(api.channels.updateChannel, { channelId, schedule, expectedScheduleFence }));
      } catch (error) {
        const latest = await convex.query(api.channels.getChannel, { channelId }).catch(() => null);
        if (latest && latest.ownerId === actor.ownerId && channelScheduleWriteFence(latest.schedule) !== expectedScheduleFence) {
          return NextResponse.json({ ok: false, error: "The schedule changed while this update was prepared. Review it and try again." }, { status: 409 });
        }
        throw error;
      }
      return NextResponse.json({ ok: true, schedule });
    }

    if (body.action === "status") {
      if (body.status !== "active" && body.status !== "paused") {
        return NextResponse.json(
          { ok: false, error: "status must be active or paused" },
          { status: 400 },
        );
      }
      assertSettingsApplied(await convex.mutation(api.channels.updateChannel, {
        channelId,
        status: body.status,
      }));
      return NextResponse.json({ ok: true, status: body.status });
    }

    if (body.action === "budget") {
      const budget = body.budget;
      if (!isValidChannelBudget(budget)) {
        return NextResponse.json(
          { ok: false, error: "budget must be between 0 and 10000" },
          { status: 400 },
        );
      }
      if (body.expectedBudget === undefined) {
        return NextResponse.json({ ok: false, error: "previous budget is required; reload and retry" }, { status: 400 });
      }
      if (body.expectedBudget !== null && !isValidChannelBudget(body.expectedBudget)) {
        return NextResponse.json({ ok: false, error: "invalid previous budget" }, { status: 400 });
      }
      const expectedBudget = body.expectedBudget;
      if ((channel.budget ?? null) !== expectedBudget) {
        return NextResponse.json({ ok: false, error: "channel budget changed; reload to review the current value and retry" }, { status: 409 });
      }
      assertSettingsApplied(await convex.mutation(api.channels.updateChannel, { channelId, budget, expectedBudget }));
      return NextResponse.json({ ok: true, budget });
    }

    if (body.action === "casefile_auto_research") {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json(
          { ok: false, error: "enabled must be true or false" },
          { status: 400 },
        );
      }
      // Throws SettingsValidationError (→ 400) when the lane is wrong.
      assertCasefileAutoResearchLaneEligible(channel, body.enabled);
      assertSettingsApplied(await convex.mutation(api.channels.updateChannel, {
        channelId,
        casefileAutoResearchEnabled: body.enabled,
      }));
      return NextResponse.json({ ok: true, casefileAutoResearchEnabled: body.enabled });
    }

    return NextResponse.json(
      { ok: false, error: "unknown settings action" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
