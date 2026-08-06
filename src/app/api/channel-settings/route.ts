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

export const runtime = "nodejs";

class SettingsValidationError extends Error {}

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

function numberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new SettingsValidationError(
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return parsed;
}

function validatedSchedule(
  current: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const merged = { ...current, ...input };
  const frequency = String(merged.frequency ?? "weekly");
  if (!["daily", "weekly", "biweekly", "monthly"].includes(frequency)) {
    throw new SettingsValidationError("invalid schedule frequency");
  }
  const timezone = String(merged.timezone ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new SettingsValidationError(`invalid IANA timezone: ${timezone}`);
  }
  const localTime = String(merged.localTime ?? "09:00");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
    throw new SettingsValidationError("localTime must be HH:MM in 24-hour time");
  }
  const rawDays = Array.isArray(merged.days) ? merged.days : [];
  const days = [...new Set(rawDays.map(Number))].sort((a, b) => a - b);
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new SettingsValidationError(
      "schedule days must be integers from 0 to 6",
    );
  }
  const approvalMode = String(merged.approvalMode ?? "manual");
  if (approvalMode !== "manual" && approvalMode !== "private_auto") {
    throw new SettingsValidationError("invalid schedule approval mode");
  }
  return {
    frequency,
    days: frequency === "weekly" || frequency === "biweekly" ? days : undefined,
    timezone,
    localTime,
    enabled: merged.enabled !== false,
    approvalMode: approvalMode as "manual" | "private_auto",
    dailyQuota: numberInRange(merged.dailyQuota ?? 1, "dailyQuota", 1, 50),
    maxConcurrent: numberInRange(
      merged.maxConcurrent ?? 1,
      "maxConcurrent",
      1,
      10,
    ),
    retryMaxAttempts: numberInRange(
      merged.retryMaxAttempts ?? 5,
      "retryMaxAttempts",
      1,
      12,
    ),
    retryBaseMinutes: numberInRange(
      merged.retryBaseMinutes ?? 15,
      "retryBaseMinutes",
      1,
      1_440,
    ),
    madeForKids: merged.madeForKids === true,
  };
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
        | "budget";
      channelId?: string;
      mode?: string;
      schedule?: Record<string, unknown>;
      status?: string;
      budget?: number;
      approved?: boolean;
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
      await convex.mutation(api.channels.updateChannel, { channelId, pipeline });
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

    return NextResponse.json(
      { ok: false, error: "unknown settings action" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
