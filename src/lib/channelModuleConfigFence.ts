import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export function channelModuleConfigFence(config: unknown): string {
  return sha256Hex(canonicalJson(config ?? {}));
}
