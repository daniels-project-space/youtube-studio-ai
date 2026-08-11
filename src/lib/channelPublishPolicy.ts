import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { stableJson } from "@/lib/publishingPolicy";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";

export const CHANNEL_PUBLISH_ACTIONS = [
  "youtube_public",
  "youtube_scheduled",
  "youtube_short_public",
  "crosspost",
] as const;

export type ChannelPublishAction = (typeof CHANNEL_PUBLISH_ACTIONS)[number];

type PipelineEntryLike = {
  block?: unknown;
  params?: unknown;
};

type ChannelLike = {
  ownerId?: unknown;
  pipeline?: unknown;
};

export interface ChannelPublishConfiguration {
  actions: ChannelPublishAction[];
  fingerprint: string;
}

function paramsOf(entry: PipelineEntryLike): Record<string, unknown> {
  return entry.params && typeof entry.params === "object" && !Array.isArray(entry.params)
    ? (entry.params as Record<string, unknown>)
    : {};
}

/**
 * Canonicalize only modules capable of an external publish side effect. The
 * protected policy row stores this digest, so editing a public Convex channel
 * document cannot silently alter an already-approved publishing configuration.
 */
export function channelPublishConfiguration(
  pipeline: unknown,
): ChannelPublishConfiguration {
  const entries = Array.isArray(pipeline)
    ? pipeline.filter(
        (entry): entry is PipelineEntryLike =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const externalBlocks: Array<{ block: string; params: Record<string, unknown> }> = [];
  const actions = new Set<ChannelPublishAction>();

  for (const entry of entries) {
    if (typeof entry.block !== "string") continue;
    if (!["upload_draft", "shorts_spinoff", "crosspost"].includes(entry.block)) {
      continue;
    }
    const params = paramsOf(entry);
    externalBlocks.push({ block: entry.block, params });
    if (entry.block === "upload_draft") {
      if (params["publishMode"] === "public") actions.add("youtube_public");
      if (params["publishMode"] === "scheduled") actions.add("youtube_scheduled");
    } else if (entry.block === "shorts_spinoff") {
      if (params["publishShort"] === "public") actions.add("youtube_short_public");
      if (params["crosspostShort"] === true) actions.add("crosspost");
    } else {
      actions.add("crosspost");
    }
  }

  const fingerprint = createHash("sha256")
    .update(
      stableJson({
        schema: "channel-publish-configuration/v1",
        externalBlocks,
      }),
    )
    .digest("hex");
  return {
    actions: [...actions].sort() as ChannelPublishAction[],
    fingerprint,
  };
}

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new ConvexHttpClient(url);
}

export async function getChannelPublishPolicy(args: {
  ownerId: string;
  channelId: Id<"channels">;
  convex?: ConvexHttpClient;
}) {
  const convex = args.convex ?? convexClient();
  return await convex.query(api.channelPublishPolicies.getForOwner, {
    secret: requireInternalQuerySecret(),
    ownerId: args.ownerId,
    channelId: args.channelId,
  });
}

export async function replaceChannelPublishPolicy(args: {
  ownerId: string;
  channelId: Id<"channels">;
  channel: ChannelLike;
  allowedActions: ChannelPublishAction[];
  actor: string;
  evidence: string;
  now?: number;
  convex?: ConvexHttpClient;
}) {
  if (args.channel.ownerId !== args.ownerId) {
    throw new Error("channel publish policy owner mismatch");
  }
  const configuration = channelPublishConfiguration(args.channel.pipeline);
  const configured = new Set(configuration.actions);
  for (const action of args.allowedActions) {
    if (!configured.has(action)) {
      throw new Error(`cannot approve unconfigured channel publish action: ${action}`);
    }
  }
  const convex = args.convex ?? convexClient();
  return await convex.mutation(api.channelPublishPolicies.replace, {
    secret: requireInternalQuerySecret(),
    ownerId: args.ownerId,
    channelId: args.channelId,
    allowedActions: [...new Set(args.allowedActions)],
    pipelineFingerprint: configuration.fingerprint,
    actor: args.actor.trim(),
    evidence: args.evidence.trim(),
    changedAt: args.now ?? Date.now(),
  });
}

export interface ChannelPublishDecision {
  authorized: boolean;
  reason:
    | "authorized"
    | "channel_missing"
    | "tenant_mismatch"
    | "channel_not_active"
    | "action_not_configured"
    | "policy_missing"
    | "policy_revoked"
    | "action_not_approved"
    | "configuration_changed";
  policyVersion?: number;
  approvedBy?: string;
  approvalEvidence?: string;
  pipelineFingerprint?: string;
}

export async function evaluateChannelPublishAction(args: {
  ownerId: string;
  channelId: Id<"channels">;
  action: ChannelPublishAction;
  channel?: ChannelLike | null;
  convex?: ConvexHttpClient;
}): Promise<ChannelPublishDecision> {
  const convex = args.convex ?? convexClient();
  const channel =
    args.channel === undefined
      ? await convex.query(api.channels.getChannel, { channelId: args.channelId })
      : args.channel;
  if (!channel) return { authorized: false, reason: "channel_missing" };
  if (channel.ownerId !== args.ownerId) {
    return { authorized: false, reason: "tenant_mismatch" };
  }
  const configuration = channelPublishConfiguration(channel.pipeline);
  if (!configuration.actions.includes(args.action)) {
    return { authorized: false, reason: "action_not_configured" };
  }
  return await convex.query(api.channelPublishPolicies.authorize, {
    secret: requireInternalQuerySecret(),
    ownerId: args.ownerId,
    channelId: args.channelId,
    action: args.action,
    pipelineFingerprint: configuration.fingerprint,
  });
}

export async function requireChannelPublishAction(
  args: Parameters<typeof evaluateChannelPublishAction>[0],
): Promise<ChannelPublishDecision & { authorized: true }> {
  const decision = await evaluateChannelPublishAction(args);
  if (!decision.authorized) {
    throw new Error(
      `external publish action ${args.action} is not authorized (${decision.reason})`,
    );
  }
  return decision as ChannelPublishDecision & { authorized: true };
}
