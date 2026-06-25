"use client";

/**
 * ModuleConfigPanel — a PURE, reusable renderer for one module's
 * CustomizationSurface. Given a surface + the current operator value
 * (`{ preset?, ...knobValues }`) + an onChange, it renders:
 *   - a preset <select> (from surface.presets)
 *   - each knob by type: enum → <select> (knob.values), boolean → toggle,
 *     number → slider + number input (knob.range), with knob.describes as
 *     helper text.
 * No data fetching, no Convex — the parent (ModuleConfigSection) owns I/O.
 * Same style vocabulary as the rest of the app (glass / var(--color-*)).
 */
import type { CSSProperties } from "react";
import type { CustomizationSurface, Knob, KnobValue } from "@/engine/customization";

/** The persisted shape for one module: a preset name + knob overrides. */
export type ModuleConfigValue = { preset?: string } & Record<string, KnobValue>;

const labelStyle: CSSProperties = { fontSize: "0.84rem", fontWeight: 600, color: "var(--color-fg)" };
const hintStyle: CSSProperties = { fontSize: "0.72rem", color: "var(--color-muted)", marginTop: 2, lineHeight: 1.35 };
const selStyle: CSSProperties = {
  background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg)",
  border: "1px solid var(--color-border)", borderRadius: 8,
  padding: "0.42rem 0.6rem", fontSize: "0.84rem", cursor: "pointer", minWidth: 150,
};
const numInput: CSSProperties = { ...selStyle, width: 74, cursor: "text", minWidth: 0 };

function Row({ knob, children }: { knob: Knob; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={labelStyle}>{knob.id}</div>
        <div style={hintStyle}>{knob.describes}</div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.55rem" }}>{children}</div>
    </div>
  );
}

export function ModuleConfigPanel({
  surface,
  value,
  onChange,
  disabled = false,
}: {
  surface: CustomizationSurface;
  value: ModuleConfigValue;
  onChange: (next: ModuleConfigValue) => void;
  disabled?: boolean;
}) {
  const presetNames = Object.keys(surface.presets);
  const preset = typeof value.preset === "string" ? value.preset : "";

  const setKnob = (id: string, v: KnobValue | undefined) => {
    const next: ModuleConfigValue = { ...value };
    if (v === undefined) delete next[id];
    else next[id] = v;
    onChange(next);
  };
  const setPreset = (p: string) => {
    const next: ModuleConfigValue = { ...value };
    if (p) next.preset = p;
    else delete next.preset;
    onChange(next);
  };

  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      {presetNames.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={labelStyle}>preset</div>
            <div style={hintStyle}>Starting config — knobs below override it.</div>
          </div>
          <select
            value={preset}
            disabled={disabled}
            onChange={(e) => setPreset(e.target.value)}
            style={selStyle}
            aria-label="module preset"
          >
            <option value="">Default</option>
            {presetNames.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      )}

      {surface.knobs.map((knob) => {
        // The effective current value: explicit override → preset value → default.
        const presetVal = preset ? surface.presets[preset]?.[knob.id] : undefined;
        const current = (value[knob.id] ?? presetVal ?? knob.default) as KnobValue;

        if (knob.type === "enum") {
          return (
            <Row key={knob.id} knob={knob}>
              <select
                value={String(current)}
                disabled={disabled}
                onChange={(e) => setKnob(knob.id, e.target.value)}
                style={selStyle}
                aria-label={knob.id}
              >
                {(knob.values ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Row>
          );
        }

        if (knob.type === "boolean") {
          const on = current === true;
          return (
            <Row key={knob.id} knob={knob}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={knob.id}
                disabled={disabled}
                onClick={() => setKnob(knob.id, !on)}
                style={{
                  width: 52, height: 28, borderRadius: 999, position: "relative",
                  cursor: disabled ? "default" : "pointer",
                  border: "1px solid var(--color-border)",
                  background: on ? "rgba(124,124,255,0.35)" : "rgba(148,148,148,0.15)",
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 2, left: on ? 26 : 2, width: 22, height: 22,
                    borderRadius: 999, background: on ? "var(--color-accent)" : "var(--color-muted)",
                    transition: "left 0.15s",
                  }}
                />
              </button>
            </Row>
          );
        }

        // number → slider + bound input
        const [min, max] = knob.range ?? [0, 100];
        const step = (max - min) <= 5 ? 0.1 : 1;
        const num = typeof current === "number" ? current : Number(knob.default);
        return (
          <Row key={knob.id} knob={knob}>
            <input
              type="range" min={min} max={max} step={step} value={num} disabled={disabled}
              onChange={(e) => setKnob(knob.id, Number(e.target.value))}
              aria-label={`${knob.id} slider`}
              style={{ width: 130, accentColor: "var(--color-accent)" }}
            />
            <input
              type="number" min={min} max={max} step={step} value={num} disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setKnob(knob.id, Math.min(max, Math.max(min, n)));
              }}
              aria-label={knob.id}
              style={numInput}
            />
          </Row>
        );
      })}
    </div>
  );
}
