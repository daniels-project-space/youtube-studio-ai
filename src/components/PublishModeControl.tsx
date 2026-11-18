"use client";

import type { CSSProperties } from "react";

export function PublishModeControl({ hasUpload, mode, busy, onChange, selectStyle, buttonStyle }: {
  hasUpload: boolean;
  mode: string;
  busy: boolean;
  onChange: (mode: string) => void;
  selectStyle?: CSSProperties;
  buttonStyle?: CSSProperties;
}) {
  return <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
    <select aria-label="Auto-publish mode" value={hasUpload ? mode : "unavailable"} disabled={busy || !hasUpload} onChange={event => onChange(event.target.value)} style={selectStyle}>
      {!hasUpload && <option value="unavailable">Upload not configured</option>}
      <option value="draft">Private draft (you approve)</option>
      <option value="scheduled">Scheduled (drip)</option>
      <option value="public">Public immediately</option>
    </select>
    {hasUpload && mode !== "draft" && <button type="button" onClick={() => onChange(mode)} disabled={busy} style={buttonStyle}>Reapprove</button>}
  </div>;
}
