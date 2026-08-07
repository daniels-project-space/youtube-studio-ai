/**
 * Deterministic JSON encoding for request identities and durable fingerprints.
 * It preserves JSON.stringify semantics while sorting every object key.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : canonicalJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalJsonValue(record[key])]),
    );
  }
  return value;
}
