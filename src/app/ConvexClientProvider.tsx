"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
} from "convex/react";
import styles from "./StudioSessionGate.module.css";

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
    return <StudioSessionGate state="loading" />;
  }

  if (!isAuthenticated) {
    return <StudioSessionGate state="unavailable" />;
  }

  return children;
}

function StudioSessionGate({ state }: { state: "loading" | "unavailable" }) {
  const loading = state === "loading";
  return (
    <main
      className={styles.screen}
      aria-busy={loading || undefined}
      aria-label={loading ? "Securing studio session" : "Studio connection unavailable"}
    >
      <section className={`${styles.card} glass glass-shine`}>
        <span className={styles.mark} aria-hidden="true">✦</span>
        <span className={styles.eyebrow}>AutoStudio · private workspace</span>
        <h1 className={styles.title}>
          {loading ? "Securing your studio" : "Live studio connection paused"}
        </h1>
        <p className={styles.body}>
          {loading
            ? "Checking the signed connection before loading channels, media, or production records."
            : "Your workspace is still protected, but its signed live-data connection could not be confirmed."}
        </p>
        <span className={styles.status} data-state={state}>
          <span className={styles.statusDot} aria-hidden="true" />
          {loading ? "Connecting to retained studio data" : "No live records are being shown"}
        </span>
        {!loading ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`studio-action studio-action-primary ${styles.retry}`}
          >
            Retry live data
          </button>
        ) : null}
        <p className={styles.safety}>
          No render, schedule, or publishing action is started from this state.
        </p>
      </section>
    </main>
  );
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
