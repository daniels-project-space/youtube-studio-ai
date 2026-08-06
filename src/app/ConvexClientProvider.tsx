"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";

type TokenState = "loading" | "authenticated" | "unauthenticated";

function useStudioConvexAuth() {
  const cachedToken = useRef<string | null>(null);
  const pendingToken = useRef<Promise<string | null> | null>(null);
  const [state, setState] = useState<TokenState>("loading");

  const fetchToken = useCallback(async (forceRefreshToken: boolean) => {
    if (!forceRefreshToken && cachedToken.current) return cachedToken.current;
    if (!forceRefreshToken && pendingToken.current) return pendingToken.current;

    const request = fetch("/api/auth/convex-token", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          cachedToken.current = null;
          setState("unauthenticated");
          return null;
        }
        const body = (await response.json()) as { token?: unknown };
        if (typeof body.token !== "string" || body.token.length < 80) {
          cachedToken.current = null;
          setState("unauthenticated");
          return null;
        }
        cachedToken.current = body.token;
        setState("authenticated");
        return body.token;
      })
      .catch(() => {
        cachedToken.current = null;
        setState("unauthenticated");
        return null;
      })
      .finally(() => {
        pendingToken.current = null;
      });
    pendingToken.current = request;
    return request;
  }, []);

  useEffect(() => {
    void fetchToken(false);
  }, [fetchToken]);

  return {
    isLoading: state === "loading",
    isAuthenticated: state === "authenticated",
    fetchAccessToken: ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      fetchToken(forceRefreshToken),
  };
}

/**
 * Client-side Convex provider. Reads NEXT_PUBLIC_CONVEX_URL (inlined at build
 * time). Wrapping in useMemo keeps a single client instance per mount.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);

  if (!client) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui", color: "#f87171" }}>
        Misconfigured: NEXT_PUBLIC_CONVEX_URL is not set.
      </div>
    );
  }

  return (
    <ConvexProviderWithAuth client={client} useAuth={useStudioConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
