import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Bind a partial schedule edit to the complete schedule it was merged with. */
export function channelScheduleWriteFence(schedule: unknown): string {
  return sha256Hex(canonicalJson(schedule ?? {}));
}
