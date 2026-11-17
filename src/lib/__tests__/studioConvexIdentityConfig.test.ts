import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { importJWK, jwtVerify } from "jose";
import { studioConvexIdentityConfig } from "../studioConvexIdentityConfig";
import { getStudioConvexPublicJwk, issueStudioConvexToken } from "../studioConvexAuth";

async function main() {
  const env = { ...process.env };
  try {
    const defaults = studioConvexIdentityConfig({});
    assert.equal(defaults.issuer, "https://youtube-studio-ai.vercel.app");
    assert.equal(defaults.audience, "youtube-studio-ai-convex");
    assert.equal(defaults.jwks, `${defaults.issuer}/api/auth/convex-jwks`);
    for (const bad of ["", "http://example.com", "https://user:pass@example.com", "https://example.com/?a=b", "https://example.com/"]) {
      assert.throws(() => studioConvexIdentityConfig({ STUDIO_CONVEX_ISSUER: bad }));
    }
    assert.throws(() => studioConvexIdentityConfig({ STUDIO_CONVEX_AUDIENCE: " " }));
    assert.throws(() => studioConvexIdentityConfig({ STUDIO_CONVEX_JWKS_URL: "http://external.invalid/jwks" }));

    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.STUDIO_CONVEX_ISSUER = "http://127.0.0.1:18770";
    process.env.STUDIO_CONVEX_AUDIENCE = "youtube-automation-local";
    delete process.env.STUDIO_CONVEX_JWKS_URL;
    const config = studioConvexIdentityConfig(process.env);
    const convexConfig = (await import("../../../convex/auth.config")).default;
    const provider = convexConfig.providers[0];
    assert.equal(provider.type, "customJwt");
    if (provider.type !== "customJwt") throw new Error("expected custom JWT provider");
    assert.equal(provider.issuer, config.issuer);
    assert.equal(provider.jwks, config.jwks);
    assert.equal(provider.applicationID, config.audience);
    const publicKey = await importJWK(getStudioConvexPublicJwk(), "ES256");
    const { token } = issueStudioConvexToken({ role: "service", ownerId: "owner-a" });
    const verified = await jwtVerify(token, publicKey, { algorithms: ["ES256"], issuer: config.issuer, audience: config.audience });
    assert.equal(verified.payload.owner_id, "owner-a");
    assert.equal(config.jwks, "http://127.0.0.1:18770/api/auth/convex-jwks");
    await assert.rejects(jwtVerify(token, publicKey, { issuer: defaults.issuer, audience: defaults.audience }));
    console.log("CONVEX IDENTITY CONFIG PASS: distinct issuer/audience, real signed token and invalid URL rejection");
  } finally {
    for (const key of ["STUDIO_CONVEX_JWT_PRIVATE_KEY", "STUDIO_CONVEX_ISSUER", "STUDIO_CONVEX_AUDIENCE", "STUDIO_CONVEX_JWKS_URL"]) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
