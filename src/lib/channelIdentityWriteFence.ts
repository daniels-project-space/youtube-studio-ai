import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Bind an identity edit to the complete identity it was based on. */
export function channelIdentityWriteFence(identity: unknown): string {
  return sha256Hex(canonicalJson(identity ?? {}));
}
