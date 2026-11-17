import type { AuthConfig } from "convex/server";
import { studioConvexIdentityConfig } from "../src/lib/studioConvexIdentityConfig";

const identity = studioConvexIdentityConfig({
  STUDIO_CONVEX_ISSUER: process.env.STUDIO_CONVEX_ISSUER,
  STUDIO_CONVEX_JWKS_URL: process.env.STUDIO_CONVEX_JWKS_URL,
  STUDIO_CONVEX_AUDIENCE: process.env.STUDIO_CONVEX_AUDIENCE,
});

export default {
  providers: [
    {
      type: "customJwt",
      issuer: identity.issuer,
      jwks: identity.jwks,
      algorithm: "ES256",
      applicationID: identity.audience,
    },
  ],
} satisfies AuthConfig;
