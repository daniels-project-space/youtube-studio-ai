import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Return the content address of a title decision receipt.
 *
 * The digest intentionally excludes the receipt's own `fingerprint` field so
 * the same function can be used both while sealing a receipt and while
 * checking one read from storage/browser state. Canonical JSON keeps the
 * digest stable when a transport or database changes object-key order.
 */
export function titleDecisionFingerprint(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { fingerprint: _fingerprint, ...body } = value as Record<string, unknown>;
    void _fingerprint;
    return sha256Hex(canonicalJson(body));
  }
  return sha256Hex(canonicalJson(value));
}

export function isTitleDecisionFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
