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
import type { CSSProperties } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { configurableModules } from "@/engine/moduleRegistry";
import { ModuleConfigPanel, type ModuleConfigValue } from "./ModuleConfigPanel";

export type ModuleConfigMap = Record<string, ModuleConfigValue>;

const cardStyle: CSSProperties = {
  border: "1px solid var(--color-border)", borderRadius: 12,
  background: "var(--color-surface)", padding: "1rem 1.1rem", display: "grid", gap: "0.85rem",
};
const titleStyle: CSSProperties = { fontSize: "0.95rem", fontWeight: 600, letterSpacing: "-0.01em" };
const stageStyle: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.1em",
  textTransform: "uppercase", color: "var(--color-faint)",
};
const doesStyle: CSSProperties = { fontSize: "0.76rem", color: "var(--color-muted)", lineHeight: 1.4 };

/** One module card. Convex-backed when `channelId` is set, else controlled. */
function ModuleCard({
  blockId,
  title,
  stage,
  does,
  surface,
  value,
  onChange,
  channelId,
}: {
  blockId: string;
  title: string;
  stage: string;
  does?: string;
  surface: import("@/engine/customization").CustomizationSurface;
  value: ModuleConfigValue;
  onChange?: (blockId: string, next: ModuleConfigValue) => void;
  channelId?: Id<"channels">;
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
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <div>
          <span style={stageStyle}>{stage}</span>
          <div style={titleStyle}>{title}</div>
        </div>
        {busy && <span style={{ fontSize: "0.68rem", color: "var(--color-accent)" }}>Saving…</span>}
      </div>
      {does && <div style={doesStyle}>{does}</div>}
      <ModuleConfigPanel surface={surface} value={local} onChange={handle} disabled={busy} />
      {err && (
        <div style={{ fontSize: "0.72rem", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 8, padding: "0.4rem 0.6rem" }}>
          {err}
        </div>
      )}
    </div>
  );
}

export function ModuleConfigSection({
  channelId,
  moduleConfig,
  value,
  onChange,
}: {
  /** Settings mode: the channel to persist into. */
  channelId?: Id<"channels">;
  /** Settings mode: the channel's current persisted moduleConfig. */
  moduleConfig?: ModuleConfigMap;
  /** Onboarding mode: the in-progress map. */
  value?: ModuleConfigMap;
  /** Onboarding mode: receives the updated map on each change. */
  onChange?: (next: ModuleConfigMap) => void;
}) {
  const mods = configurableModules();
  const current = channelId ? (moduleConfig ?? {}) : (value ?? {});

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
      <div style={{ ...cardStyle, color: "var(--color-muted)", fontSize: "0.82rem" }}>
        No configurable modules registered yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.85rem" }}>
      {mods.map((m) => (
        <ModuleCard
          key={m.blockId}
          blockId={m.blockId}
          title={m.card.title}
          stage={m.card.stage}
          does={m.card.does}
          surface={m.surface}
          value={current[m.blockId] ?? {}}
          onChange={channelId ? undefined : handleControlled}
          channelId={channelId}
        />
      ))}
    </div>
  );
}
