import { STATUS_COLOR, STATUS_LABEL } from "@/lib/config";

/**
 * Status pill used for run + stage status. Colors come from the shared
 * STATUS_COLOR map (the same values the original page.tsx used). A pulsing dot
 * signals an in-flight ("running") status.
 */
export function StageBadge({
  status,
  size = "md",
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const color = STATUS_COLOR[status] ?? "var(--color-queued)";
  const label = STATUS_LABEL[status] ?? status;
  const pad = size === "sm" ? "0.15rem 0.5rem" : "0.25rem 0.65rem";
  const font = size === "sm" ? "0.7rem" : "0.78rem";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: pad,
        fontSize: font,
        fontWeight: 500,
        borderRadius: 999,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        className={status === "running" ? "studio-pulse" : undefined}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
