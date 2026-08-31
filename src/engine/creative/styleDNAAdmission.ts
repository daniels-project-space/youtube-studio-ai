/**
 * Prevent a channel's durable Style DNA from becoming an unreviewed copy of a
 * reference video.  Style DNA is an original, machine-readable production
 * specification; attributed reference sources and human-reviewed mechanics
 * belong in their own contracts, not in this mutable-looking payload.
 *
 * This is intentionally a narrow admission guard.  It is called only when a
 * caller supplies `channels.styleDNA`, so historic rows are never rewritten
 * merely because they predate this boundary.  In particular, it does not
 * inspect ReferenceQualityContract or ReferenceMechanicsPacket records, whose
 * source URLs are separately validated and editorially reviewed.
 */

export interface StyleDNAAdmissionOptions {
  /** Names the mutation boundary in a deterministic, operator-actionable error. */
  readonly context?: string;
}

interface StyleDNAAdmissionViolation {
  readonly path: string;
  readonly reason: string;
}

const URL_LIKE = /(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i;

function normalizeFieldName(field: string): string {
  return field.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function prohibitedFieldReason(field: string): string | undefined {
  const normalized = normalizeFieldName(field);

  // There is no legitimate reference-derived field in the StyleDNA contract.
  // Keep this broad enough to reject common renames of the retired anchoring
  // payload (for example referenceAnchors, referenceClipNotes, or
  // referenceVideoAnalysis), rather than relying on one historic key.
  if (normalized.includes("reference")) {
    return "reference-derived input field";
  }
  if (["url", "urls", "link", "links"].includes(normalized)) {
    return "raw URL field";
  }
  if (
    normalized.includes("automated") &&
    /(?:video|clip|analysis|watch|transcript|frame|audio)/.test(normalized)
  ) {
    return "automated video-analysis field";
  }
  if (normalized.startsWith("example") && /(?:video|clip|watch)/.test(normalized)) {
    return "example-video input field";
  }
  return undefined;
}

function findStyleDNAAdmissionViolation(
  value: unknown,
  path: string,
  visited: WeakSet<object>,
): StyleDNAAdmissionViolation | undefined {
  if (typeof value === "string") {
    return URL_LIKE.test(value)
      ? { path, reason: "raw reference URL" }
      : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (visited.has(value)) return undefined;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const violation = findStyleDNAAdmissionViolation(item, `${path}[${index}]`, visited);
      if (violation) return violation;
    }
    return undefined;
  }

  for (const [field, item] of Object.entries(value)) {
    const fieldPath = `${path}.${field}`;
    const fieldReason = prohibitedFieldReason(field);
    if (fieldReason) return { path: fieldPath, reason: fieldReason };
    const violation = findStyleDNAAdmissionViolation(item, fieldPath, visited);
    if (violation) return violation;
  }
  return undefined;
}

/**
 * Reject raw reference-video material before it can become durable Style DNA.
 * Human-reviewed mechanics packets and attributed source evidence remain
 * supported through their dedicated contracts; callers must not nest either
 * payload inside Style DNA.
 */
export function assertStyleDNAAdmissionSafety(
  styleDNA: unknown,
  options: StyleDNAAdmissionOptions = {},
): void {
  const violation = findStyleDNAAdmissionViolation(styleDNA, "styleDNA", new WeakSet<object>());
  if (!violation) return;

  const context = options.context ?? "channel styleDNA";
  throw new Error(
    `${context} must not contain raw reference-video material (${violation.reason} at ${violation.path}). ` +
      "Use an attributed, human-reviewed ReferenceMechanicsPacket or ReferenceQualityContract outside Style DNA.",
  );
}
