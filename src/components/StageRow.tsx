"use client";

/**
 * Expandable detail panel for a single pipeline block. Rendered inside
 * LivePipeline when a node is expanded. Shows the persisted inputs/outputs
 * (JSON) and the error text when the block failed. Values are pretty-printed
 * and large blobs are truncated so the panel stays readable.
 */

const MAX_JSON_CHARS = 4000;

/** Stable pretty-print of an arbitrary persisted JSON value, truncated. */
function prettyJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length > MAX_JSON_CHARS) {
    text =
      text.slice(0, MAX_JSON_CHARS) +
      `\n… (${text.length - MAX_JSON_CHARS} more chars truncated)`;
  }
  return text;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0)
    return true;
  return false;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: "0.68rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
          marginBottom: "0.35rem",
        }}
      >
        {label}
      </div>
      {isEmpty(value) ? (
        <div style={{ fontSize: "0.82rem", color: "var(--color-faint)" }}>—</div>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: "0.7rem 0.85rem",
            borderRadius: 10,
            background: "rgba(0,0,0,0.28)",
            border: "1px solid var(--color-border)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.74rem",
            lineHeight: 1.5,
            color: "var(--color-muted)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {prettyJson(value)}
        </pre>
      )}
    </div>
  );
}

export function StageRow({
  inputs,
  outputs,
  error,
}: {
  inputs?: unknown;
  outputs?: unknown;
  error?: string;
}) {
  const nothing = isEmpty(inputs) && isEmpty(outputs) && !error;

  return (
    <div
      style={{
        display: "grid",
        gap: "0.9rem",
        padding: "0.95rem 1.1rem 1.05rem",
      }}
    >
      {error && (
        <div
          style={{
            padding: "0.7rem 0.9rem",
            borderRadius: 10,
            border:
              "1px solid color-mix(in srgb, var(--color-failed) 35%, transparent)",
            background: "color-mix(in srgb, var(--color-failed) 10%, transparent)",
            color: "var(--color-failed)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.78rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}

      {nothing ? (
        <div style={{ fontSize: "0.82rem", color: "var(--color-faint)" }}>
          No inputs or outputs recorded for this block.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.9rem",
          }}
        >
          <JsonBlock label="Inputs" value={inputs} />
          <JsonBlock label="Outputs" value={outputs} />
        </div>
      )}
    </div>
  );
}
