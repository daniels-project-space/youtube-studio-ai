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
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { configurableModules } from "@/engine/moduleRegistry";
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
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setModuleConfig = useMutation(api.channels.setModuleConfig);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<ModuleConfigValue>(value);

  const handle = async (next: ModuleConfigValue) => {
    setLocal(next);
    onChange?.(blockId, next); // controlled (onboarding) path
    if (!channelId) return;
    // Convex-backed (settings) path — persist + validate on each change.
    setBusy(true);
    setErr(null);
    try {
      await setModuleConfig({ channelId, blockId, config: next });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
      setLocal(value); // revert optimistic change on rejection
    } finally {
      setBusy(false);
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
        {busy ? <span className={styles.saving}>Saving…</span> : <span className={styles.chevron} aria-hidden="true">+</span>}
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
          <ModuleConfigPanel surface={surface} value={local} onChange={handle} disabled={busy} />
          {err && <div className={styles.error} role="alert">{err}</div>}
        </div>
      </div>
    </details>
  );
}

export function ModuleConfigSection({
  channelId,
  moduleConfig,
  value,
  onChange,
  activeBlockIds,
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
}) {
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
          index={index}
          open={visibleOpenBlockId === m.blockId}
          onOpenChange={(nextOpen) => setOpenBlockId(nextOpen ? m.blockId : null)}
        />
      ))}
    </div>
  );
}
