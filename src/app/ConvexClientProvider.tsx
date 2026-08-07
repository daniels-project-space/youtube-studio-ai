"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
} from "convex/react";

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

  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      fetchToken(forceRefreshToken),
    [fetchToken],
  );

  return {
    isLoading: state === "loading",
    isAuthenticated: state === "authenticated",
    fetchAccessToken,
  };
}

function StudioConvexAuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <main
        aria-busy="true"
        aria-label="Authenticating studio session"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          color: "#a1a1aa",
          fontFamily: "system-ui",
        }}
      >
        Securing studio session…
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          color: "#f87171",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "grid", justifyItems: "center", gap: "0.75rem" }}>
          <p style={{ margin: 0 }}>Studio data is temporarily unavailable.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: "1px solid rgba(248, 113, 113, 0.32)",
              borderRadius: "0.65rem",
              padding: "0.55rem 0.8rem",
              color: "inherit",
              background: "rgba(248, 113, 113, 0.08)",
              cursor: "pointer",
            }}
          >
            Retry live data
          </button>
        </div>
      </main>
    );
  }

  return children;
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
      <StudioConvexAuthGate>{children}</StudioConvexAuthGate>
    </ConvexProviderWithAuth>
  );
}
