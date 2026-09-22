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
    options?: ConstructorParameters<typeof BaseConvexHttpClient>[1] & { requestTimeoutMs?: number },
  ) {
    const { requestTimeoutMs, ...clientOptions } = options ?? {};
    if (requestTimeoutMs !== undefined && (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2 ** 31 - 1)) {
      throw new Error("Convex request timeout must be a positive bounded integer");
    }
    const explicitAuth = clientOptions.auth;
    const transport = clientOptions.fetch ?? globalThis.fetch;
    const authenticatedFetch: typeof globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${explicitAuth ?? serviceToken()}`);
      const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const deadline = requestTimeoutMs === undefined ? undefined : AbortSignal.timeout(requestTimeoutMs);
      // Keep the fetch signal alive through body consumption, not just headers.
      // A timed-out mutation may still commit; callers retain their durable fences.
      return transport(input, { ...init, headers,
        ...(deadline ? { signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline } : {}),
      });
    };
    super(address, {
      ...clientOptions,
      auth: explicitAuth ?? serviceToken(),
      fetch: authenticatedFetch,
    });
  }
}
