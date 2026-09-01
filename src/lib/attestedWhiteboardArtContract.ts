import { createHash } from "node:crypto";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import type { AttestedNovitaImageBytes } from "@/lib/novitaMedia";

/**
 * Renderer-facing receipt for Whiteboard art.
 *
 * Whiteboard owns the byte/geometry contract; the provider adapter owns the
 * GPU/model/billing attestation. Keeping those responsibilities separate lets
 * the renderer move from Z-Image to the accepted ERNIE lane without ever
 * weakening cache integrity or pretending one model is another.
 */
export const ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION =
  "attested-whiteboard-art/v1" as const;

export interface AttestedWhiteboardArtReceipt {
  contractVersion: typeof ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION;
  provider: "novita";
  model: string;
  route: "local-z-image-turbo";
  profileId: "draft" | "production" | "hero";
  width: number;
  height: number;
  sourceContentType: "image/png";
  costUsd: number;
  providerKey: string;
  providerJobId: string;
  providerRequestSha256: string;
  providerProfileSha256: string;
  providerManifestSha256: string;
  providerBillingReceiptSha256: string;
  responseSha256: string;
  createdAt: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function attestedWhiteboardArtReceiptFromNovita(
  rendered: AttestedNovitaImageBytes,
): AttestedWhiteboardArtReceipt {
  const dimensions = rasterImageDimensions(rendered.bytes);
  if (
    dimensions.contentType !== "image/png" ||
    dimensions.width !== rendered.width ||
    dimensions.height !== rendered.height
  ) {
    throw new Error(
      "Whiteboard art bytes do not match their attested Novita PNG geometry",
    );
  }
  return assertAttestedWhiteboardArtReceipt({
    contractVersion: ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION,
    provider: "novita",
    model: rendered.model,
    route: "local-z-image-turbo",
    profileId: rendered.profileId,
    width: dimensions.width,
    height: dimensions.height,
    sourceContentType: "image/png",
    costUsd: rendered.costUsd,
    providerKey: rendered.key,
    providerJobId: rendered.jobId,
    providerRequestSha256: rendered.requestSha256,
    providerProfileSha256: rendered.profileSha256,
    providerManifestSha256: rendered.manifestSha256,
    providerBillingReceiptSha256: rendered.billingReceiptSha256,
    responseSha256: sha256(rendered.bytes),
    createdAt: Date.now(),
  });
}

export function assertAttestedWhiteboardArtReceipt(
  value: unknown,
  contentSha256?: string,
): AttestedWhiteboardArtReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Whiteboard art is missing its attested provider receipt");
  }
  const receipt = value as Partial<AttestedWhiteboardArtReceipt>;
  if (
    receipt.contractVersion !== ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION ||
    receipt.provider !== "novita" ||
    receipt.route !== "local-z-image-turbo" ||
    typeof receipt.model !== "string" ||
    !receipt.model.trim() ||
    !["draft", "production", "hero"].includes(String(receipt.profileId)) ||
    !Number.isInteger(receipt.width) ||
    (receipt.width ?? 0) < 1 ||
    !Number.isInteger(receipt.height) ||
    (receipt.height ?? 0) < 1 ||
    receipt.sourceContentType !== "image/png" ||
    typeof receipt.costUsd !== "number" ||
    !Number.isFinite(receipt.costUsd) ||
    receipt.costUsd < 0 ||
    typeof receipt.providerKey !== "string" ||
    !receipt.providerKey.trim() ||
    typeof receipt.providerJobId !== "string" ||
    !receipt.providerJobId.trim() ||
    !isSha256(receipt.providerRequestSha256) ||
    !isSha256(receipt.providerProfileSha256) ||
    !isSha256(receipt.providerManifestSha256) ||
    !isSha256(receipt.providerBillingReceiptSha256) ||
    !isSha256(receipt.responseSha256) ||
    typeof receipt.createdAt !== "number" ||
    !Number.isFinite(receipt.createdAt) ||
    receipt.createdAt <= 0
  ) {
    throw new Error("Whiteboard art receipt is incomplete or outside its admitted Novita contract");
  }
  if (contentSha256 !== undefined && receipt.responseSha256 !== contentSha256) {
    throw new Error("Whiteboard art bytes do not match their attested provider receipt");
  }
  return receipt as AttestedWhiteboardArtReceipt;
}
