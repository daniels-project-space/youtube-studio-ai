import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

export const STUDIO_CONVEX_ISSUER = "https://youtube-studio-ai.vercel.app";
export const STUDIO_CONVEX_AUDIENCE = "youtube-studio-ai-convex";

export type StudioConvexRole = "owner" | "service";

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function privateKey(): KeyObject {
  const encoded = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  if (!encoded) {
    throw new Error("STUDIO_CONVEX_JWT_PRIVATE_KEY is required");
  }
  const key = createPrivateKey(encoded.replace(/\\n/g, "\n"));
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error("STUDIO_CONVEX_JWT_PRIVATE_KEY must be an ES256 P-256 key");
  }
  return key;
}

function publicJwkFor(key: KeyObject) {
  const jwk = createPublicKey(key).export({ format: "jwk" });
  if (!jwk.kty || !jwk.crv || !jwk.x || !jwk.y) {
    throw new Error("could not derive the studio Convex public JWK");
  }
  const thumbprintInput = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const kid = createHash("sha256")
    .update(thumbprintInput)
    .digest("base64url");
  return { ...jwk, alg: "ES256", use: "sig", kid };
}

export function getStudioConvexPublicJwk() {
  return publicJwkFor(privateKey());
}

function previousPublicJwks() {
  const raw = process.env.STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("STUDIO_CONVEX_PREVIOUS_PUBLIC_JWKS must be a JSON array");
  }
  return parsed.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("previous Convex JWK entries must be objects");
    }
    const value = candidate as Record<string, unknown>;
    if ("d" in value) {
      throw new Error("previous Convex JWK entries must never include private key material");
    }
    if (
      value.kty !== "EC" ||
      value.crv !== "P-256" ||
      typeof value.x !== "string" ||
      typeof value.y !== "string"
    ) {
      throw new Error("previous Convex JWK entries must be ES256 P-256 public keys");
    }
    const thumbprintInput = JSON.stringify({
      crv: value.crv,
      kty: value.kty,
      x: value.x,
      y: value.y,
    });
    const kid =
      typeof value.kid === "string" && value.kid
        ? value.kid
        : createHash("sha256").update(thumbprintInput).digest("base64url");
    return {
      kty: "EC",
      crv: "P-256",
      x: value.x,
      y: value.y,
      alg: "ES256",
      use: "sig",
      kid,
    };
  });
}

/** Current public key plus optional public-only overlap keys for safe rotation. */
export function getStudioConvexPublicJwks() {
  const current = getStudioConvexPublicJwk();
  const seen = new Set([current.kid]);
  const previous = previousPublicJwks().filter((key) => {
    if (seen.has(key.kid)) return false;
    seen.add(key.kid);
    return true;
  });
  return [current, ...previous];
}

export function studioOwnerId(): string {
  return process.env.STUDIO_OWNER_ID ?? "owner_daniel";
}

/**
 * Issue a JWT accepted only by this app's Convex deployment. Browser tokens are
 * deliberately short lived; worker tokens are bounded above the two-hour task
 * ceiling so a durable run cannot lose database access halfway through.
 */
export function issueStudioConvexToken(options: {
  role: StudioConvexRole;
  ownerId?: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: number } {
  const key = privateKey();
  const publicJwk = publicJwkFor(key);
  const now = Math.floor(Date.now() / 1000);
  const defaultTtl = options.role === "owner" ? 5 * 60 : 3 * 60 * 60;
  const maxTtl = options.role === "owner" ? 10 * 60 : 4 * 60 * 60;
  const ttlSeconds = Math.max(
    60,
    Math.min(Math.floor(options.ttlSeconds ?? defaultTtl), maxTtl),
  );
  const ownerId = options.ownerId ?? studioOwnerId();
  const subject = options.role === "owner" ? ownerId : "service:youtube-studio-ai";

  const header = base64UrlJson({ alg: "ES256", typ: "JWT", kid: publicJwk.kid });
  const payload = base64UrlJson({
    iss: STUDIO_CONVEX_ISSUER,
    aud: STUDIO_CONVEX_AUDIENCE,
    sub: subject,
    role: options.role,
    owner_id: ownerId,
    iat: now,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");

  return { token: `${signingInput}.${signature}`, expiresAt: (now + ttlSeconds) * 1000 };
}
