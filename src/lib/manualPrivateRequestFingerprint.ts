import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export function manualPrivateRequestFingerprint(channel: unknown, maximumCostUsd: number): string {
  return sha256Hex(canonicalJson({ channel, maximumCostUsd }));
}
