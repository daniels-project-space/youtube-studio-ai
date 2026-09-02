import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ChannelModuleLock } from "../src/lib/channelModuleLock";

/** Reserved audit subject for a whole-channel lock rather than one module. */
export const CHANNEL_LOCK_AUDIT_BLOCK_ID = "__channel__";

export async function channelMutationAuditActor(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
): Promise<string> {
  const identity = (await ctx.auth.getUserIdentity()) as
    | { role?: unknown; subject?: unknown }
    | null;
  const role = typeof identity?.role === "string" ? identity.role : "unknown";
  const subject = typeof identity?.subject === "string" ? identity.subject : "unknown";
  return `${role}:${subject}`.slice(0, 220);
}

/**
 * Append-only provenance for whole-channel and module hard-lock decisions.
 * The table name is retained for the already-shipped module-lock migration;
 * blockId makes the subject unambiguous.
 */
export async function recordChannelLockAudit(
  ctx: MutationCtx,
  input: {
    ownerId: string;
    channelId: Doc<"channels">["_id"];
    blockId: string;
    event: "locked" | "unlocked" | "mutation_rejected";
    operation: string;
    actor: string;
    reason?: string;
    lock?: ChannelModuleLock | null;
  },
): Promise<void> {
  await ctx.db.insert("channelModuleLockAudits", {
    ...input,
    lock: input.lock ?? undefined,
    createdAt: Date.now(),
  });
}
