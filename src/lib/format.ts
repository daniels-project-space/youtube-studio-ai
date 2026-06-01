/** Formatting helpers shared across the UI. */

export function fmtDateTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtUsd(n?: number): string {
  if (n === undefined || n === null) return "$0.00";
  return `$${n.toFixed(2)}`;
}

/** Compact human duration between two epoch-ms timestamps. */
export function fmtDuration(fromMs?: number, toMs?: number): string {
  if (!fromMs) return "—";
  const end = toMs ?? Date.now();
  let s = Math.max(0, Math.floor((end - fromMs) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
