import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://youtube-studio-ai.vercel.app",
      jwks: "https://youtube-studio-ai.vercel.app/api/auth/convex-jwks",
      algorithm: "ES256",
      applicationID: "youtube-studio-ai-convex",
    },
  ],
} satisfies AuthConfig;
