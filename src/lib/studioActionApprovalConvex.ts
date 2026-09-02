/**
 * Web-Crypto verifier for Convex queries and mutations.
 *
 * Convex's default runtime intentionally has no Node `crypto` module, but it
 * does provide deterministic Web Crypto. Issuance remains server-side Node
 * code; this module verifies the byte-identical HMAC without moving the
 * database mutation into a Node action (which would break its transaction).
 */
import type {
  StudioAction,
  StudioActionApprovalReceipt,
} from "@/lib/studioActionApprovalContract";
import {
  STUDIO_ACTION_APPROVAL_MAX_CLOCK_SKEW_MS,
  STUDIO_ACTION_APPROVAL_MAX_TTL_MS,
  studioActionApprovalCanonicalJson,
} from "@/lib/studioActionApprovalCanonical";

const encoder = new TextEncoder();

type VerificationExpectation = {
  action: StudioAction;
  ownerId: string;
  subject: string;
  now?: number;
  maximumCostUsd?: number;
  persistedReceiptFingerprint?: string;
};

function signingMaterial(): Uint8Array {
  const privateKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  if (!privateKey) throw new Error("STUDIO_CONVEX_JWT_PRIVATE_KEY is required for action approvals");
  return encoder.encode(`youtube-studio-ai/action-approval/v1\0${privateKey}`);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

async function digestSha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlBytes(value: string): Uint8Array | null {
  // HMAC-SHA256 encoded as unpadded base64url is always exactly 43 chars.
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  try {
    const binary = atob(`${value.replace(/-/g, "+").replace(/_/g, "/")}=`);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(await digestSha256(signingMaterial())),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function receiptShapeIsValid(
  value: unknown,
  expected: VerificationExpectation,
): value is StudioActionApprovalReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<StudioActionApprovalReceipt>;
  return receipt.version === "studio-action-approval/v1" &&
    receipt.action === expected.action &&
    receipt.ownerId === expected.ownerId &&
    receipt.subject === expected.subject &&
    receipt.actor?.startsWith("authenticated-operator:") === true &&
    Boolean(receipt.evidence?.trim()) &&
    typeof receipt.issuedAt === "number" &&
    Number.isFinite(receipt.issuedAt) &&
    typeof receipt.expiresAt === "number" &&
    Number.isFinite(receipt.expiresAt) &&
    typeof receipt.signature === "string";
}

export async function studioActionApprovalFingerprintForConvex(
  receipt: StudioActionApprovalReceipt,
): Promise<string> {
  return hex(await digestSha256(encoder.encode(studioActionApprovalCanonicalJson(receipt))));
}

/** Verify an approval receipt in Convex's default deterministic runtime. */
export async function verifyStudioActionApprovalForConvex(
  value: unknown,
  expected: VerificationExpectation,
): Promise<boolean> {
  try {
    if (!receiptShapeIsValid(value, expected)) return false;
    const receipt = value;
    const now = expected.now ?? Date.now();
    const receiptFingerprint = await studioActionApprovalFingerprintForConvex(receipt);
    if (
      receipt.issuedAt > now + STUDIO_ACTION_APPROVAL_MAX_CLOCK_SKEW_MS ||
      (receipt.expiresAt < now && expected.persistedReceiptFingerprint !== receiptFingerprint) ||
      receipt.expiresAt - receipt.issuedAt > STUDIO_ACTION_APPROVAL_MAX_TTL_MS
    ) return false;
    if (
      expected.maximumCostUsd !== undefined &&
      (typeof receipt.maxCostUsd !== "number" || receipt.maxCostUsd > expected.maximumCostUsd)
    ) return false;
    const actualSignature = base64UrlBytes(receipt.signature);
    if (!actualSignature) return false;
    const { signature: _signature, ...claims } = receipt;
    return crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      exactArrayBuffer(actualSignature),
      exactArrayBuffer(encoder.encode(studioActionApprovalCanonicalJson(claims))),
    );
  } catch {
    return false;
  }
}
