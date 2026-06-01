/**
 * App-wide configuration. OWNER_ID was previously hardcoded across pages
 * (page.tsx line 7, run-lofi-m1.ts, etc.). It now resolves from env with the
 * single-operator default, and is surfaced through OwnerContext for components.
 */
export const OWNER_ID =
  process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

export const STATUS_COLOR: Record<string, string> = {
  ok: "var(--color-ok)",
  running: "var(--color-running)",
  queued: "var(--color-queued)",
  failed: "var(--color-failed)",
  canceled: "var(--color-canceled)",
};

/** Status → human label. */
export const STATUS_LABEL: Record<string, string> = {
  ok: "Done",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
  canceled: "Canceled",
};
