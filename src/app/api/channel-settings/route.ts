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
import {
  assertCasefileAutoResearchLaneEligible,
  SettingsValidationError,
  validatedSchedule,
} from "@/lib/channelSettingsValidation";

export const runtime = "nodejs";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new ConvexHttpClient(url);
}

function errorResponse(error: unknown) {
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
    await hydrateEnv("youtube");
    const body = (await request.json()) as {
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
      status?: string;
      budget?: number;
      approved?: boolean;
      enabled?: boolean;
    };
    if (!body.channelId || !body.action) {
      return NextResponse.json(
        { ok: false, error: "channelId and action are required" },
        { status: 400 },
      );
    }
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
      const pipelineWrite = await convex.mutation(api.channels.updateChannel, { channelId, pipeline });
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
      const schedule = validatedSchedule(
        (channel.schedule ?? {}) as Record<string, unknown>,
        body.schedule,
      );
      await convex.mutation(api.channels.updateChannel, { channelId, schedule });
      return NextResponse.json({ ok: true, schedule });
    }

    if (body.action === "status") {
      if (body.status !== "active" && body.status !== "paused") {
        return NextResponse.json(
          { ok: false, error: "status must be active or paused" },
          { status: 400 },
        );
      }
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        status: body.status,
      });
      return NextResponse.json({ ok: true, status: body.status });
    }

    if (body.action === "budget") {
      const budget = Number(body.budget);
      if (!Number.isFinite(budget) || budget < 0 || budget > 10_000) {
        return NextResponse.json(
          { ok: false, error: "budget must be between 0 and 10000" },
          { status: 400 },
        );
      }
      await convex.mutation(api.channels.updateChannel, { channelId, budget });
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
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        casefileAutoResearchEnabled: body.enabled,
      });
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
