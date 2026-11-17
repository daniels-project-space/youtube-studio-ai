export const DEFAULT_STUDIO_CONVEX_ISSUER = "https://youtube-studio-ai.vercel.app";
export const DEFAULT_STUDIO_CONVEX_AUDIENCE = "youtube-studio-ai-convex";

function validateUrl(value: string, name: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must use HTTPS, or HTTP on loopback, without credentials, query or fragment`);
  }
  return value;
}

/** Server-only deployment identity; both the signer and Convex use these values. */
export function studioConvexIdentityConfig(env: Record<string, string | undefined>) {
  const issuer = validateUrl(env.STUDIO_CONVEX_ISSUER ?? DEFAULT_STUDIO_CONVEX_ISSUER, "STUDIO_CONVEX_ISSUER");
  if (issuer.endsWith("/")) throw new Error("STUDIO_CONVEX_ISSUER must not end with a slash");
  const jwks = validateUrl(env.STUDIO_CONVEX_JWKS_URL ?? `${issuer}/api/auth/convex-jwks`, "STUDIO_CONVEX_JWKS_URL");
  const audience = env.STUDIO_CONVEX_AUDIENCE ?? DEFAULT_STUDIO_CONVEX_AUDIENCE;
  if (!audience.trim() || audience !== audience.trim()) throw new Error("STUDIO_CONVEX_AUDIENCE must be nonempty and trimmed");
  return { issuer, jwks, audience };
}
