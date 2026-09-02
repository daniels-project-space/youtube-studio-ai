"use client";

/**
 * ModuleConfigSection — lists every configurable base module
 * (configurableModules() from the MODULE_REGISTRY) and renders a
 * ModuleConfigPanel for each. ONE component, two modes:
 *
 *  - Convex-backed (Settings): pass `channelId` + `moduleConfig`. Each panel
 *    saves on change via `channels.setModuleConfig` ("toggle captions with a
 *    click"). Validation lives in the mutation (illegal → rejected).
 *
 *  - Controlled (onboarding wizard): pass `value` + `onChange` (no channel yet).
 *    The collected map is later written into the new channel's moduleConfig.
 *
 * Generic over the registry: register a module → its knobs auto-appear here.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { configurableModules } from "@/engine/moduleRegistry";
import {
  channelModuleUnlockConfirmation,
  type ChannelModuleLock,
} from "@/lib/channelModuleLock";
import { CHANNEL_UNLOCK_CONFIRMATION } from "@/lib/channelLockContract";
import { useOwnerId } from "@/lib/owner-context";
import { ModuleConfigPanel, type ModuleConfigValue } from "./ModuleConfigPanel";
import styles from "./ModuleConfigSection.module.css";

export type ModuleConfigMap = Record<string, ModuleConfigValue>;

/** One module card. Convex-backed when `channelId` is set, else controlled. */
function ModuleCard({
  blockId,
  title,
  stage,
  does,
  capabilities,
  surface,
  value,
  onChange,
  channelId,
  ownerId,
  lock,
  channelLocked = false,
  index,
  open,
  onOpenChange,
}: {
  blockId: string;
  title: string;
  stage: string;
  does?: string;
  capabilities: readonly string[];
  surface: import("@/engine/customization").CustomizationSurface;
  value: ModuleConfigValue;
  onChange?: (blockId: string, next: ModuleConfigValue) => void;
  channelId?: Id<"channels">;
  ownerId?: string;
  lock?: ChannelModuleLock;
  channelLocked?: boolean;
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setModuleConfig = useMutation(api.channels.setModuleConfig);
  const lockModule = useMutation(api.channels.lockModule);
  const unlockModule = useMutation(api.channels.unlockModule);
  const [busy, setBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<ModuleConfigValue>(value);
  const moduleLocked = Boolean(lock);
  const locked = channelLocked || moduleLocked;

  const handle = async (next: ModuleConfigValue) => {
    setLocal(next);
    onChange?.(blockId, next); // controlled (onboarding) path
    if (!channelId) return;
    // Convex-backed (settings) path — persist + validate on each change.
    setBusy(true);
    setErr(null);
    try {
      const outcome = await setModuleConfig({ channelId, blockId, config: next });
      if ((outcome as { state?: string }).state === "module_locked") {
        throw new Error(`\"${title}\" is locked. Unlock this exact module before changing its controls.`);
      }
      if ((outcome as { state?: string }).state === "channel_locked") {
        throw new Error("This channel is frozen. Unlock the channel before changing any module.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
      setLocal(value); // revert optimistic change on rejection
    } finally {
      setBusy(false);
    }
  };

  const changeLock = async () => {
    if (!channelId || !ownerId || lockBusy || channelLocked) return;
    setLockBusy(true);
    setErr(null);
    try {
      if (locked) {
        const confirmation = window.prompt(
          `Unlock ${title}? Type the exact confirmation to allow future changes to this module.`,
          "",
        );
        if (confirmation === null) return;
        await unlockModule({
          ownerId,
          channelId,
          blockId,
          confirmation,
        });
      } else {
        const confirmed = window.confirm(
          `Lock ${title}? Its saved controls and pipeline entry will reject changes until you explicitly unlock it.`,
        );
        if (!confirmed) return;
        await lockModule({ ownerId, channelId, blockId });
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not change the module lock");
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <details
      className={styles.module}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onOpenChange(event.currentTarget.open);
      }}
    >
      <summary className={styles.summary}>
        <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
        <div className={styles.identity}>
          <span className={styles.stage}>{stage}</span>
          <div className={styles.title}>{title}</div>
        </div>
        {busy || lockBusy
          ? <span className={styles.saving}>{busy ? "Saving…" : "Securing…"}</span>
          : locked
            ? <span className={styles.saving} data-locked="true">Locked</span>
            : <span className={styles.chevron} aria-hidden="true">+</span>}
      </summary>
      <div className={styles.body}>
        <div className={styles.brief}>
          {does && <p className={styles.does}>{does}</p>}
          {capabilities.length > 0 && (
            <ul className={styles.capabilities} aria-label={`${title} capabilities`}>
              {capabilities.slice(0, 5).map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
          )}
        </div>
        <div className={styles.controls}>
          {channelId && ownerId && (
            <div className={styles.lockRow}>
              <span>
                {channelLocked
                  ? "Channel frozen"
                  : moduleLocked
                  ? `Locked · ${new Date(lock!.lockedAt).toLocaleDateString()}`
                  : "Editable module"}
              </span>
              {!channelLocked && <button
                type="button"
                className={styles.lockButton}
                data-locked={moduleLocked || undefined}
                disabled={busy || lockBusy}
                onClick={changeLock}
                title={moduleLocked
                  ? `Type '${channelModuleUnlockConfirmation(blockId)}' to unlock`
                  : "Freeze this module's saved controls and pipeline entry"}
              >
                {lockBusy ? "Working…" : moduleLocked ? "Unlock module" : "Lock module"}
              </button>
              }
            </div>
          )}
          <ModuleConfigPanel surface={surface} value={local} onChange={handle} disabled={busy || lockBusy || locked} />
          {err && <div className={styles.error} role="alert">{err}</div>}
        </div>
      </div>
    </details>
  );
}

function ChannelLockControl({
  channelId,
  ownerId,
  locked,
  lockedAt,
}: {
  channelId: Id<"channels">;
  ownerId: string;
  locked: boolean;
  lockedAt?: number;
}) {
  const lockChannel = useMutation(api.channels.lockChannel);
  const unlockChannel = useMutation(api.channels.unlockChannel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeLock = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (locked) {
        const confirmation = window.prompt(
          "Unlock this channel? Type the exact confirmation to re-enable changes.",
          "",
        );
        if (confirmation === null) return;
        await unlockChannel({ ownerId, channelId, confirmation });
      } else {
        const confirmed = window.confirm(
          "Freeze this channel? All future config, pipeline, schedule, and creative changes will be rejected until you explicitly unlock it.",
        );
        if (!confirmed) return;
        await lockChannel({ ownerId, channelId });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the channel lock");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.channelLock} data-locked={locked || undefined}>
      <div>
        <strong>{locked ? "Channel frozen" : "Channel editable"}</strong>
        <span>{locked && lockedAt ? `Since ${new Date(lockedAt).toLocaleDateString()}` : "Owner control"}</span>
      </div>
      <button
        type="button"
        className={styles.lockButton}
        data-locked={locked || undefined}
        disabled={busy}
        onClick={changeLock}
        title={locked ? `Type '${CHANNEL_UNLOCK_CONFIRMATION}' to unlock` : "Freeze all future channel changes"}
      >
        {busy ? "Working…" : locked ? "Unlock channel" : "Lock channel"}
      </button>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </div>
  );
}

export function ModuleConfigSection({
  channelId,
  moduleConfig,
  value,
  onChange,
  activeBlockIds,
  moduleLocks,
  channelLocked = false,
  channelLockedAt,
}: {
  /** Settings mode: the channel to persist into. */
  channelId?: Id<"channels">;
  /** Settings mode: the channel's current persisted moduleConfig. */
  moduleConfig?: ModuleConfigMap;
  /** Onboarding mode: the in-progress map. */
  value?: ModuleConfigMap;
  /** Onboarding mode: receives the updated map on each change. */
  onChange?: (next: ModuleConfigMap) => void;
  /** Only show modules actually selected in this channel's designed pipeline. */
  activeBlockIds?: readonly string[];
  /** Per-module hard locks; only the channel detail settings surface receives these. */
  moduleLocks?: Record<string, ChannelModuleLock>;
  /** Whole-channel owner lock; it overrides all per-module controls. */
  channelLocked?: boolean;
  channelLockedAt?: number;
}) {
  const ownerId = useOwnerId();
  const lockAudits = useQuery(
    api.channels.listModuleLockAudits,
    channelId && ownerId ? { ownerId, channelId, limit: 4 } : "skip",
  );
  const mods = configurableModules(activeBlockIds);
  const current = channelId ? (moduleConfig ?? {}) : (value ?? {});
  const [openBlockId, setOpenBlockId] = useState<string | null | undefined>(undefined);
  const visibleOpenBlockId = openBlockId === undefined || (
    openBlockId !== null && !mods.some((module) => module.blockId === openBlockId)
  )
    ? mods[0]?.blockId ?? null
    : openBlockId;

  const handleControlled = (blockId: string, next: ModuleConfigValue) => {
    if (!onChange) return;
    const map: ModuleConfigMap = { ...(value ?? {}) };
    // Drop empty entries so the stored map stays minimal.
    if (Object.keys(next).length === 0) delete map[blockId];
    else map[blockId] = next;
    onChange(map);
  };

  if (mods.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>No adjustable stages</strong>
        This pipeline has no operator-facing module controls.
      </div>
    );
  }

  return (
    <div className={styles.rack}>
      {channelId && ownerId && (
        <ChannelLockControl
          channelId={channelId}
          ownerId={ownerId}
          locked={channelLocked}
          lockedAt={channelLockedAt}
        />
      )}
      {mods.map((m, index) => (
        <ModuleCard
          key={m.blockId}
          blockId={m.blockId}
          title={m.card.title}
          stage={m.card.stage}
          does={m.card.does}
          capabilities={m.surface.capabilities}
          surface={m.surface}
          value={current[m.blockId] ?? {}}
          onChange={channelId ? undefined : handleControlled}
          channelId={channelId}
          ownerId={channelId ? ownerId : undefined}
          lock={moduleLocks?.[m.blockId]}
          channelLocked={channelLocked}
          index={index}
          open={visibleOpenBlockId === m.blockId}
          onOpenChange={(nextOpen) => setOpenBlockId(nextOpen ? m.blockId : null)}
        />
      ))}
      {lockAudits && lockAudits.length > 0 && (
        <details className={styles.lockAudit}>
          <summary>Recent lock activity</summary>
          <ol>
            {lockAudits.map((audit) => (
              <li key={audit._id}>
                <span>{audit.blockId === "__channel__" ? "channel" : audit.blockId}</span>
                <span>{audit.event === "mutation_rejected" ? "blocked change" : audit.event}</span>
                <time dateTime={new Date(audit.createdAt).toISOString()}>
                  {new Date(audit.createdAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
