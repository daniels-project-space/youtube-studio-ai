import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireSecretKey } from "@/lib/secretEnvelope";

export const YOUTUBE_OAUTH_NONCE_COOKIE = "yt_oauth_nonce";
export const YOUTUBE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface YouTubeOAuthStatePayload {
  v: 1;
  channelId: string;
  ownerId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(encodedPayload: string): string {
  return createHmac(
    "sha256",
    requireSecretKey("YOUTUBE_OAUTH_STATE_SECRET"),
  )
    .update(encodedPayload)
    .digest("base64url");
}

export function createYouTubeOAuthState(args: {
  channelId: string;
  ownerId: string;
  now?: number;
  ttlMs?: number;
}): { state: string; nonce: string; payload: YouTubeOAuthStatePayload } {
  if (!args.channelId || !args.ownerId) {
    throw new Error("OAuth state requires channelId and ownerId");
  }
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? YOUTUBE_OAUTH_STATE_TTL_MS;
  if (ttlMs <= 0 || ttlMs > YOUTUBE_OAUTH_STATE_TTL_MS) {
    throw new Error("OAuth state TTL is outside the allowed range");
  }
  const nonce = randomBytes(24).toString("base64url");
  const payload: YouTubeOAuthStatePayload = {
    v: 1,
    channelId: args.channelId,
    ownerId: args.ownerId,
    nonce,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return { state: `${encoded}.${sign(encoded)}`, nonce, payload };
}

export function verifyYouTubeOAuthState(args: {
  state: string;
  nonce: string | undefined;
  now?: number;
}): YouTubeOAuthStatePayload {
  const [encoded, signature, ...extra] = args.state.split(".");
  if (!encoded || !signature || extra.length > 0) {
    throw new Error("malformed OAuth state");
  }
  const expected = Buffer.from(sign(encoded), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (
    expected.byteLength !== actual.byteLength ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new Error("invalid OAuth state signature");
  }

  let payload: YouTubeOAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as YouTubeOAuthStatePayload;
  } catch {
    throw new Error("invalid OAuth state payload");
  }

  const now = args.now ?? Date.now();
  if (
    payload.v !== 1 ||
    !payload.channelId ||
    !payload.ownerId ||
    !payload.nonce ||
    !Number.isFinite(payload.issuedAt) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > YOUTUBE_OAUTH_STATE_TTL_MS ||
    now < payload.issuedAt - 30_000 ||
    now > payload.expiresAt
  ) {
    throw new Error("expired or invalid OAuth state payload");
  }
  if (!args.nonce) throw new Error("missing OAuth nonce cookie");
  const expectedNonce = Buffer.from(payload.nonce, "utf8");
  const actualNonce = Buffer.from(args.nonce, "utf8");
  if (
    expectedNonce.byteLength !== actualNonce.byteLength ||
    !timingSafeEqual(expectedNonce, actualNonce)
  ) {
    throw new Error("OAuth state is not bound to this browser");
  }
  return payload;
}
