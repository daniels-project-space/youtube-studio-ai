import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireSecretKey } from "@/lib/secretEnvelope";

export const OPERATIONS_OAUTH_NONCE_COOKIE = "operations_oauth_nonce";
export const OPERATIONS_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const OPERATIONS_OAUTH_STATE_PREFIX = "ops";

export interface OperationsOAuthStatePayload {
  v: 1;
  purpose: "owner-session";
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(encodedPayload: string): string {
  return createHmac(
    "sha256",
    requireSecretKey("STUDIO_SESSION_SECRET"),
  )
    .update(`${OPERATIONS_OAUTH_STATE_PREFIX}.${encodedPayload}`)
    .digest("base64url");
}

export function isOperationsOAuthState(state: string | null): state is string {
  return Boolean(state?.startsWith(`${OPERATIONS_OAUTH_STATE_PREFIX}.`));
}

export function createOperationsOAuthState(args: {
  now?: number;
  ttlMs?: number;
} = {}): { state: string; nonce: string; payload: OperationsOAuthStatePayload } {
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? OPERATIONS_OAUTH_STATE_TTL_MS;
  if (ttlMs <= 0 || ttlMs > OPERATIONS_OAUTH_STATE_TTL_MS) {
    throw new Error("operations OAuth state TTL is outside the allowed range");
  }
  const nonce = randomBytes(24).toString("base64url");
  const payload: OperationsOAuthStatePayload = {
    v: 1,
    purpose: "owner-session",
    nonce,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    state: `${OPERATIONS_OAUTH_STATE_PREFIX}.${encoded}.${sign(encoded)}`,
    nonce,
    payload,
  };
}

export function verifyOperationsOAuthState(args: {
  state: string;
  nonce: string | undefined;
  now?: number;
}): OperationsOAuthStatePayload {
  const [prefix, encoded, signature, ...extra] = args.state.split(".");
  if (
    prefix !== OPERATIONS_OAUTH_STATE_PREFIX
    || !encoded
    || !signature
    || extra.length > 0
  ) {
    throw new Error("malformed operations OAuth state");
  }
  const expected = Buffer.from(sign(encoded), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (
    expected.byteLength !== actual.byteLength
    || !timingSafeEqual(expected, actual)
  ) {
    throw new Error("invalid operations OAuth state signature");
  }

  let payload: OperationsOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OperationsOAuthStatePayload;
  } catch {
    throw new Error("invalid operations OAuth state payload");
  }
  const now = args.now ?? Date.now();
  if (
    payload.v !== 1
    || payload.purpose !== "owner-session"
    || !payload.nonce
    || !Number.isFinite(payload.issuedAt)
    || !Number.isFinite(payload.expiresAt)
    || payload.expiresAt <= payload.issuedAt
    || payload.expiresAt - payload.issuedAt > OPERATIONS_OAUTH_STATE_TTL_MS
    || now < payload.issuedAt - 30_000
    || now > payload.expiresAt
  ) {
    throw new Error("expired or invalid operations OAuth state payload");
  }
  if (!args.nonce) throw new Error("missing operations OAuth nonce cookie");
  const expectedNonce = Buffer.from(payload.nonce, "utf8");
  const actualNonce = Buffer.from(args.nonce, "utf8");
  if (
    expectedNonce.byteLength !== actualNonce.byteLength
    || !timingSafeEqual(expectedNonce, actualNonce)
  ) {
    throw new Error("operations OAuth state is not bound to this browser");
  }
  return payload;
}
