export interface ChannelInceptionProbeArtifactReceipt {
  assetId: string;
  runId: string;
  byteLength: number;
}

export interface ChannelInceptionProbeArtifactCandidate {
  assetId: string;
  runId: string;
  r2Key: string;
}

export type ChannelBuildCompletionDisposition =
  | "plan-saved"
  | "output-ready"
  | "output-missing"
  | "blocked"
  | "pending";

/**
 * Accept only the unique final video asset indexed for this exact owner,
 * channel, and probe run. A completed Trigger task or QA stage alone is not
 * evidence that the channel Library can surface an output.
 */
export function channelInceptionProbeArtifactCandidate(
  assets: readonly unknown[],
  expected: { ownerId: string; channelId: string; runId: string },
): ChannelInceptionProbeArtifactCandidate | null {
  const matches = assets.filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const asset = candidate as Record<string, unknown>;
    return asset.ownerId === expected.ownerId &&
      String(asset.channelId) === expected.channelId &&
      String(asset.runId) === expected.runId &&
      asset.kind === "video" &&
      typeof asset.r2Key === "string" && asset.r2Key.trim().length > 0;
  });
  if (matches.length !== 1) return null;
  const asset = matches[0] as Record<string, unknown>;
  if (typeof asset._id !== "string" || asset._id.trim().length === 0) return null;
  return {
    assetId: asset._id,
    runId: expected.runId,
    r2Key: (asset.r2Key as string).trim(),
  };
}

/** A Library row counts as output only after its stored video object is found. */
export function channelInceptionProbeArtifactReceipt(
  candidate: ChannelInceptionProbeArtifactCandidate | null,
  objectMetadata: { contentLength?: unknown } | null,
): ChannelInceptionProbeArtifactReceipt | null {
  if (!candidate || !objectMetadata ||
      typeof objectMetadata.contentLength !== "number" ||
      !Number.isSafeInteger(objectMetadata.contentLength) ||
      objectMetadata.contentLength <= 0) return null;
  return {
    assetId: candidate.assetId,
    runId: candidate.runId,
    byteLength: objectMetadata.contentLength,
  };
}

export function isChannelInceptionProbeArtifactReceipt(
  value: unknown,
): value is ChannelInceptionProbeArtifactReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.assetId === "string" && receipt.assetId.trim().length > 0 &&
    typeof receipt.runId === "string" && receipt.runId.trim().length > 0 &&
    typeof receipt.byteLength === "number" && Number.isSafeInteger(receipt.byteLength) &&
    receipt.byteLength > 0;
}

export function channelBuildCompletionDisposition(progress: {
  inceptionStatus: "planned" | "running" | "complete" | "blocked";
  executionAuthorized: boolean;
  probeArtifact?: unknown;
}): ChannelBuildCompletionDisposition {
  if (progress.inceptionStatus === "planned" && !progress.executionAuthorized) return "plan-saved";
  if (progress.inceptionStatus === "complete") {
    return isChannelInceptionProbeArtifactReceipt(progress.probeArtifact)
      ? "output-ready"
      : "output-missing";
  }
  if (progress.inceptionStatus === "blocked") return "blocked";
  return "pending";
}
