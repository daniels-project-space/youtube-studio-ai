import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";
import {
  mutation as baseMutation,
  query as baseQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";

type StudioCtx = QueryCtx | MutationCtx;
type StudioArgs = Record<string, unknown>;
type TableName = TableNames;
type StudioOperation = "query" | "mutation";

type StudioAuthCtx = Pick<StudioCtx, "auth">;

const RESOURCE_KEYS = {
  channelId: "channels",
  targetChannelId: "channels",
  runId: "runs",
  folderId: "channelFolders",
  connectorId: "youtubeAuth",
  intentId: "publishIntents",
  recommendationId: "learningRecommendations",
  experimentId: "contentExperiments",
  ingestionId: "analyticsIngestions",
  id: "contentPlan",
} satisfies Record<string, TableName>;

function identityScope(identity: UserIdentity | null) {
  if (!identity) throw new Error("Studio authentication required");
  const role = identity.role;
  const ownerId = identity.owner_id;
  if (
    (role !== "viewer" && role !== "owner" && role !== "service") ||
    typeof ownerId !== "string"
  ) {
    throw new Error("Invalid studio identity");
  }
  if (role === "owner" && identity.subject !== ownerId) {
    throw new Error("Invalid studio owner identity");
  }
  if (role === "viewer" && identity.subject !== `viewer:${ownerId}`) {
    throw new Error("Invalid studio viewer identity");
  }
  return { role, ownerId } as const;
}

/**
 * Require the short-lived server JWT, additionally bound to the requested
 * owner. Public owner sessions must never be able to manufacture provider or
 * accounting evidence that downstream readiness checks treat as trusted.
 */
export async function requireStudioServiceIdentity(
  ctx: StudioAuthCtx,
  ownerId: string,
  purpose = "Studio service operation",
): Promise<void> {
  const identity = identityScope(await ctx.auth.getUserIdentity());
  if (identity.role !== "service" || identity.ownerId !== ownerId) {
    throw new Error(`${purpose} requires the bound studio service identity`);
  }
}

async function assertOwnedRecord(
  ctx: StudioCtx,
  table: TableName,
  value: unknown,
  ownerId: string,
) {
  if (typeof value !== "string") return false;
  const normalized = ctx.db.normalizeId(table, value);
  if (!normalized) throw new Error("Studio resource not found");
  const row = await ctx.db.get(normalized as GenericId<TableName>);
  if (!row || (row as { ownerId?: unknown }).ownerId !== ownerId) {
    throw new Error("Studio resource access denied");
  }
  return true;
}

async function authorizeStudioCall(
  ctx: StudioCtx,
  args: StudioArgs,
  operation: StudioOperation = "query",
) {
  const identity = identityScope(await ctx.auth.getUserIdentity());
  if (identity.role === "viewer" && operation === "mutation") {
    throw new Error("Studio viewer mutations are not permitted");
  }
  if (identity.role === "viewer" && Object.hasOwn(args, "secret")) {
    throw new Error("Studio viewer privileged query denied");
  }
  let scoped = false;

  if (typeof args.ownerId === "string") {
    if (args.ownerId !== identity.ownerId) {
      throw new Error("Studio owner access denied");
    }
    scoped = true;
  }

  for (const [key, table] of Object.entries(RESOURCE_KEYS)) {
    const value = args[key];
    if (value !== undefined && value !== null) {
      scoped = (await assertOwnedRecord(ctx, table, value, identity.ownerId)) || scoped;
    }
  }

  if (Array.isArray(args.ids)) {
    for (const id of args.ids) {
      await assertOwnedRecord(ctx, "contentPlan", id, identity.ownerId);
    }
    scoped = args.ids.length > 0 || scoped;
  }
  if (Array.isArray(args.runIds)) {
    for (const runId of args.runIds) {
      await assertOwnedRecord(ctx, "runs", runId, identity.ownerId);
    }
    scoped = args.runIds.length > 0 || scoped;
  }

  if (typeof args.groupId === "string") {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId as string))
      .collect();
    if (
      channels.length === 0 ||
      channels.some((channel) => channel.ownerId !== identity.ownerId)
    ) {
      throw new Error("Studio group access denied");
    }
    scoped = true;
  }

  // Service-only fleet scans (for example publish-intent due work) may not have
  // an owner or document argument. Owner and viewer calls must always be scoped.
  if (!scoped && identity.role !== "service") {
    throw new Error("Studio call is not owner scoped");
  }
}

type PublicDefinition = {
  handler: (ctx: StudioCtx, args: StudioArgs) => unknown;
  [key: string]: unknown;
};

function authenticatedBuilder(
  builder: typeof baseQuery,
  operation: StudioOperation,
): typeof baseQuery;
function authenticatedBuilder(
  builder: typeof baseMutation,
  operation: StudioOperation,
): typeof baseMutation;
function authenticatedBuilder(
  builder: typeof baseQuery | typeof baseMutation,
  operation: StudioOperation,
): typeof baseQuery | typeof baseMutation {
  return ((definition: PublicDefinition) =>
    builder({
      ...definition,
      handler: async (ctx: StudioCtx, args: StudioArgs) => {
        await authorizeStudioCall(ctx, args, operation);
        return definition.handler(ctx, args);
      },
    } as never)) as typeof baseQuery | typeof baseMutation;
}

export const query = authenticatedBuilder(baseQuery, "query");
export const mutation = authenticatedBuilder(baseMutation, "mutation");

export const studioAuthorizationForTests = {
  identityScope,
  authorizeStudioCall,
  requireStudioServiceIdentity,
};
