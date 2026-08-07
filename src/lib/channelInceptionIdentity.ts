import { createHash } from "node:crypto";

/** Stable app-channel identity for an operator-confirmed inception request. */
export function channelInceptionSlug(name: string, requestKey: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = createHash("sha256").update(requestKey, "utf8").digest("hex").slice(0, 10);
  return `${base || "channel"}-${suffix}`;
}
