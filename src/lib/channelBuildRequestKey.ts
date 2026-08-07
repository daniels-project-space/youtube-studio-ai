import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";

const REQUEST_KEY = /^[0-9a-f-]{36}_([a-f0-9]{64})$/i;

export function channelBuildIntentFingerprint(design: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(design), "utf8").digest("hex");
}

export function validateChannelBuildRequestKey(
  requestKey: string,
  design: Record<string, unknown>,
): boolean {
  const match = requestKey.match(REQUEST_KEY);
  return Boolean(match && match[1].toLowerCase() === channelBuildIntentFingerprint(design));
}
