/** Runtime-neutral canonical form shared by Node issuance and Convex verification. */
export const STUDIO_ACTION_APPROVAL_MAX_TTL_MS = 15 * 60 * 1_000;
export const STUDIO_ACTION_APPROVAL_MAX_CLOCK_SKEW_MS = 30_000;

/**
 * Canonical JSON is part of the signed approval format. Keep this completely
 * free of Node APIs so the same bytes are available inside Convex mutations.
 */
export function studioActionApprovalCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("approval values must be finite");
    return JSON.stringify(value);
  }
  if (value === undefined) return '"$undefined"';
  if (Array.isArray(value)) return `[${value.map(studioActionApprovalCanonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("unsupported approval value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${studioActionApprovalCanonicalJson(record[key])}`).join(",")}}`;
}
