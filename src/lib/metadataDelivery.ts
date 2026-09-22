import { z } from "zod";
import { numericMentions } from "./numericClaims";

export const DELIVERY_METADATA_VERSION = "2.0.0-delivery-aware";
export const MetadataDeliverySchema = z.object({
  basis: z.enum(["planned", "measured"]),
  durationSec: z.number().finite().positive().max(86400),
}).strict();
export type MetadataDelivery = z.infer<typeof MetadataDeliverySchema>;

/** Bound timestamp-leading chapter lines without treating inline clocks as chapters. */
export function filterDeliveryTimestamps(description: string, delivery: MetadataDelivery,
  onDrop: (reason: string) => void): string {
  const timing = MetadataDeliverySchema.parse(delivery);
  return description.split(/\r?\n/u).filter(line => {
    const match = line.match(/^\s*(?:[-*]\s+)?(?:\[(\d{1,4}:\d{2}(?::\d{2})?)\]|(\d{1,4}:\d{2}(?::\d{2})?))(?=\s|$)/u);
    if (!match) return true;
    const label = match[1] ?? match[2];
    const parts = label.split(":").map(Number);
    const validUnits = parts.slice(1).every(part => part < 60);
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (validUnits && seconds < timing.durationSec) return true;
    onDrop(`metadata: dropped chapter timestamp ${label}: ${validUnits
      ? `outside ${timing.basis} delivery (${timing.durationSec}s)` : "invalid time units"}`);
    return false;
  }).join("\n").replace(/\n{3,}/gu, "\n\n");
}

/** Music-format duration labels are delivery claims, not facts spoken in a script. */
export function musicDeliveryClaims(title: string, delivery: MetadataDelivery) {
  const text = title.normalize("NFKC");
  const matches = new Map<number, { start: number; end: number; seconds: number }>();
  const numericText = text.replace(/(\d)(?=(?:h|mins?|secs?|s)(?!\p{L}))/giu, "$1 ");
  for (const mention of numericMentions(numericText)) {
    if (mention.plotValue === null) continue;
    const quantity = mention.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}.,])${quantity}\\s*[-–]?\\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)(?![\\p{L}])`, "giu");
    for (const match of text.matchAll(pattern)) {
      const unit = match[1].toLowerCase();
      const scale = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
      matches.set(match.index, { start: match.index, end: match.index + match[0].length, seconds: mention.plotValue * scale });
    }
  }
  const groups: { start: number; end: number; seconds: number }[] = [];
  for (const match of [...matches.values()].sort((a, b) => a.start - b.start)) {
    const last = groups.at(-1);
    if (last && match.start < last.end) continue;
    if (last && /^\s*(?:and\s*)?$/iu.test(text.slice(last.end, match.start))) {
      last.end = match.end; last.seconds += match.seconds;
    } else groups.push({ ...match });
  }
  const issues: string[] = [];
  let sourceClaimTitle = text;
  for (const claim of groups.reverse()) {
    if (Math.abs(claim.seconds - delivery.durationSec) > 0.1) {
      issues.push(`duration claim "${text.slice(claim.start, claim.end)}" differs from ${delivery.basis} delivery (${delivery.durationSec}s)`);
    } else {
      // Remove only the authorized duration phrase from narrative number lint.
      // Its numeric value must not authorize an unrelated title claim.
      sourceClaimTitle = sourceClaimTitle.slice(0, claim.start) + " " + sourceClaimTitle.slice(claim.end);
    }
  }
  return { issues, sourceClaimTitle };
}
