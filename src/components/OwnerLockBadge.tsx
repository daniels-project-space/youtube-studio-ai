"use client";

/**
 * OWNER LOCK BADGE — the lock shown next to a module or a channel.
 *
 * State comes from Convex, not from a file. The first version of this wrote
 * marker files through an API route, which works locally and fails on every
 * click in production: the studio runs on Vercel, whose filesystem is
 * read-only. A lock the owner cannot set from the browser is not a lock.
 *
 * The two kinds are enforced in different places, and this component is
 * deliberately a thin surface over each rather than a third mechanism:
 *
 *   channel — convex/channels.ts lockChannel/unlockChannel, which every guarded
 *             channel mutation already respects, with its own audit trail
 *   module  — convex/ownerModuleLocks.ts, mirrored to the workstation where the
 *             pre-edit guard refuses writes to the module's files
 *
 * Locking is one click; UNLOCKING asks first. A toggle beside a channel name is
 * far too easy to hit by accident, and the point of a lock is that removing it
 * is deliberate.
 */
import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { CHANNEL_UNLOCK_CONFIRMATION } from "@/lib/channelLockContract";
import { LOCKABLE_MODULE_IDS, lockCoverage } from "@/lib/ownerLockRegistry";

type Props =
  | { kind: "module"; moduleId: string; label?: string; size?: "sm" | "md" }
  | { kind: "channel"; channelId: string; channelName: string; locked: boolean; size?: "sm" | "md" };

export function OwnerLockBadge(props: Props) {
  const ownerId = useOwnerId();
  const size = props.size ?? "md";
  const [busy, setBusy] = useState(false);

  // Only the module variant needs the fleet-wide lock list. Convex dedupes
  // identical subscriptions, so one query serves every badge on the page.
  const moduleLocks = useQuery(
    api.ownerModuleLocks.list,
    props.kind === "module" ? { ownerId } : "skip",
  );
  const setModuleLock = useMutation(api.ownerModuleLocks.setLock);
  const lockChannel = useMutation(api.channels.lockChannel);
  const unlockChannel = useMutation(api.channels.unlockChannel);

  const locked = props.kind === "channel"
    ? props.locked
    : Boolean(moduleLocks?.some((row) => row.moduleKey === props.moduleId));

  const label = props.kind === "channel" ? props.channelName : props.label ?? props.moduleId;
  const coverage = props.kind === "module" ? lockCoverage(props.moduleId) : null;
  const known = props.kind === "channel" || moduleLocks !== undefined;

  const toggle = useCallback(async () => {
    if (locked && !window.confirm(
      `Unlock “${label}”?\n\nAI workers will be able to change it again until you lock it back.`,
    )) return;
    setBusy(true);
    try {
      if (props.kind === "channel") {
        const channelId = props.channelId as Id<"channels">;
        if (locked) {
          await unlockChannel({ ownerId, channelId, confirmation: CHANNEL_UNLOCK_CONFIRMATION });
        } else {
          await lockChannel({ ownerId, channelId });
        }
      } else {
        await setModuleLock({ ownerId, moduleKey: props.moduleId, locked: !locked });
      }
    } catch (error) {
      window.alert(
        `Could not ${locked ? "unlock" : "lock"} “${label}”.\n\n` +
        (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }, [label, locked, lockChannel, ownerId, props, setModuleLock, unlockChannel]);

  // A module with no files resolved would be a lock the guard cannot enforce.
  if (props.kind === "module" && !LOCKABLE_MODULE_IDS.has(props.moduleId)) return null;

  const pad = size === "sm" ? 6 : 8;
  const title = locked
    ? `Locked by you. No AI worker can change ${label} until you unlock it here.`
    : coverage && !coverage.enforced
      ? `${label} has no source files of its own yet, so locking it records your intent but blocks no edits.`
      : `Lock ${label} so no AI worker can change it${coverage ? ` (${coverage.files} files)` : ""}.`;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={locked}
      aria-label={locked ? `${label} is locked — unlock` : `Lock ${label}`}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        verticalAlign: "middle",
        cursor: busy ? "wait" : "pointer",
        borderRadius: 999,
        border: `1px solid ${locked ? "#43c98a66" : "#ffffff1f"}`,
        background: locked ? "#43c98a1f" : "transparent",
        color: locked ? "#43c98a" : "#7d8798",
        padding: `${pad - 3}px ${pad}px`,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        lineHeight: 1,
        opacity: known ? 1 : 0.35,
      }}
    >
      <span aria-hidden="true">{locked ? "🔒" : "🔓"}</span>
      {locked ? <span>LOCKED</span> : null}
    </button>
  );
}
