import { ConvexHttpClient as BaseConvexHttpClient } from "convex/browser";
import { issueStudioConvexToken } from "@/lib/studioConvexAuth";

let cachedServiceToken: { token: string; refreshAt: number } | null = null;

function serviceToken(): string {
  if (cachedServiceToken && Date.now() < cachedServiceToken.refreshAt) {
    return cachedServiceToken.token;
  }
  const issued = issueStudioConvexToken({ role: "service" });
  cachedServiceToken = {
    token: issued.token,
    refreshAt: issued.expiresAt - 5 * 60 * 1000,
  };
  return issued.token;
}

/**
 * Server/Trigger Convex client authenticated as this studio's scoped service.
 * Keeping the constructor compatible makes existing durable workers inherit the
 * security boundary without changing every database call signature.
 */
export class StudioConvexHttpClient extends BaseConvexHttpClient {
  constructor(
    address: string,
    options?: ConstructorParameters<typeof BaseConvexHttpClient>[1],
  ) {
    const explicitAuth = options?.auth;
    const transport = options?.fetch ?? globalThis.fetch;
    const authenticatedFetch: typeof globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${explicitAuth ?? serviceToken()}`);
      return transport(input, { ...init, headers });
    };
    super(address, {
      ...options,
      auth: explicitAuth ?? serviceToken(),
      fetch: authenticatedFetch,
    });
  }
}
