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
  minHeight: 44, padding: "0.42rem 0.6rem", fontSize: "0.84rem", cursor: "pointer", minWidth: 150,
};
const numInput: CSSProperties = { ...selStyle, width: 74, cursor: "text", minWidth: 0 };

function humanLabel(value: string): string {
  const known: Record<string, string> = {
    minimax_music3: "MiniMax-Music3 · qualification gated",
    mureka: "Mureka",
    suno: "Suno",
    lufs: "LUFS",
  };
  if (known[value]) return known[value];
  const spaced = value
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value;
}

function Row({ knob, children }: { knob: Knob; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={labelStyle}>{humanLabel(knob.id)}</div>
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
  const providerKnob = surface.knobs.find((knob) => knob.id === "provider");
  const selectedProvider = value.provider ??
    (preset ? surface.presets[preset]?.provider : undefined) ??
    providerKnob?.default;
  const showMiniMaxMusic3Attribution = selectedProvider === "minimax_music3";

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
      {showMiniMaxMusic3Attribution && (
        <aside
          aria-label="MiniMax-Music3 attribution and generation disclosure"
          style={{
            display: "grid",
            gap: "0.38rem",
            padding: "0.85rem 0.95rem",
            borderRadius: 12,
            border: "1px solid color-mix(in srgb, var(--color-accent) 42%, var(--color-border))",
            background:
              "linear-gradient(120deg, color-mix(in srgb, var(--color-accent) 12%, transparent), var(--color-bg-elev, #16161a) 62%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
            <span
              aria-hidden="true"
              style={{ width: 9, height: 9, borderRadius: 999, background: "var(--color-accent)", boxShadow: "0 0 0 5px color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
            />
            <strong style={{ fontSize: "0.86rem", letterSpacing: "0.01em" }}>MiniMax-Music3</strong>
            <span style={{ fontSize: "0.68rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              AI-generated score
            </span>
          </div>
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: "0.75rem", lineHeight: 1.45 }}>
            Music generated with MiniMax-Music3. Rendering stays closed before spend until the pinned two-GPU worker,
            listened quality receipt, commercial attribution, disclosure, safeguards, and operator license attestation all pass.
          </p>
        </aside>
      )}
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
              <option key={p} value={p}>{humanLabel(p)}</option>
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
                  <option key={opt} value={opt}>{humanLabel(opt)}</option>
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
                  width: 56, height: 44, borderRadius: 999, position: "relative",
                  cursor: disabled ? "default" : "pointer",
                  border: "1px solid var(--color-border)",
                  background: on ? "rgba(124,124,255,0.35)" : "rgba(148,148,148,0.15)",
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 7, left: on ? 25 : 3, width: 28, height: 28,
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
              style={{ width: 130, minHeight: 44, accentColor: "var(--color-accent)" }}
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
