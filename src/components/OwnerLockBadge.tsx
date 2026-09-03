"use client";

/**
 * OWNER LOCK BADGE — the lock symbol shown next to a module or a channel.
 *
 * One shared store rather than a fetch per badge. The channels page renders a
 * badge for every channel, so a naive per-badge fetch would fire one request
 * per card on every render of that page.
 *
 * Locking is one click; UNLOCKING asks first. The whole point of the lock is
 * that removing it should be a deliberate act by the owner, and a bare toggle
 * next to a channel name is far too easy to hit by accident.
 */
import { useCallback, useSyncExternalStore } from "react";

import { LOCKABLE_MODULE_IDS, channelLockId } from "@/lib/ownerLockRegistry";

interface ModuleLockDto {
  id: string;
  label: string;
  locked: boolean;
  lockedAt: string | null;
}
interface ChannelLockDto {
  id: string;
  label: string;
  lockedAt: string;
}
interface LockSnapshot {
  modules: ModuleLockDto[];
  channelLocks: ChannelLockDto[];
}

let snapshot: LockSnapshot | null = null;
let inflight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

async function refresh(): Promise<void> {
  const res = await fetch("/api/module-locks", { cache: "no-store" });
  const data = await res.json() as Partial<LockSnapshot>;
  snapshot = { modules: data.modules ?? [], channelLocks: data.channelLocks ?? [] };
  notify();
}

function ensureLoaded(): void {
  if (snapshot || inflight) return;
  inflight = refresh()
    .catch(() => { snapshot = { modules: [], channelLocks: [] }; notify(); })
    .finally(() => { inflight = null; });
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  ensureLoaded();
  return () => { subscribers.delete(fn); };
}

const getSnapshot = () => snapshot;
// The server renders before any lock state is known. Returning the same value
// on both sides keeps the badge out of hydration mismatches; it fills in on
// the client once the single shared fetch resolves.
const getServerSnapshot = () => null;

export function OwnerLockBadge(props: {
  /** A lockable module id — the same string as the module's GOLDEN_MODULES key. */
  moduleId?: string;
  /** A channel name. Any channel is lockable; no registry entry is needed. */
  channelName?: string;
  /** Compact rendering for dense rows such as channel cards. */
  size?: "sm" | "md";
}) {
  const { moduleId, channelName, size = "md" } = props;
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const id = channelName ? channelLockId(channelName) : moduleId ?? "";
  const label = channelName ?? state?.modules.find((m) => m.id === id)?.label ?? moduleId ?? "";

  const locked = channelName
    ? Boolean(state?.channelLocks.some((lock) => lock.id === id))
    : Boolean(state?.modules.find((m) => m.id === id)?.locked);

  const toggle = useCallback(async () => {
    if (locked && !window.confirm(
      `Unlock “${label}”?\n\nAI workers will be able to change it again until you lock it back.`,
    )) return;
    const body = channelName
      ? { channelName, locked: !locked }
      : { id: moduleId, locked: !locked };
    try {
      const res = await fetch("/api/module-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch {
      window.alert(`Could not ${locked ? "unlock" : "lock"} “${label}”.`);
    }
  }, [channelName, label, locked, moduleId]);

  // A module with no declared paths has nothing to protect, so offering a lock
  // there would be decorative. Channels are always offered.
  if (!channelName && !LOCKABLE_MODULE_IDS.has(moduleId ?? "")) return null;

  const px = size === "sm" ? 6 : 8;
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={locked}
      aria-label={locked ? `${label} is locked — unlock` : `Lock ${label}`}
      title={locked
        ? `Locked by you. No AI worker can change ${label} until you unlock it here.`
        : `Lock ${label} so no AI worker can change it.`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        verticalAlign: "middle",
        cursor: "pointer",
        borderRadius: 999,
        border: `1px solid ${locked ? "#43c98a66" : "#ffffff1f"}`,
        background: locked ? "#43c98a1f" : "transparent",
        color: locked ? "#43c98a" : "#7d8798",
        padding: `${px - 3}px ${px}px`,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        lineHeight: 1,
        opacity: state ? 1 : 0.35,
      }}
    >
      <span aria-hidden="true">{locked ? "🔒" : "🔓"}</span>
      {locked ? <span>LOCKED</span> : null}
    </button>
  );
}
