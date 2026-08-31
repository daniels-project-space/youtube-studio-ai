"use client";

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
  type SyntheticEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type OperationsAccessState =
  | "checking"
  | "viewer"
  | "owner"
  | "unavailable";

type OperationsAccessContextValue = {
  state: OperationsAccessState;
  setState: (value: SetStateAction<OperationsAccessState>) => void;
};

const OperationsAccessContext =
  createContext<OperationsAccessContextValue | null>(null);

type ElevationResponse = {
  ok?: boolean;
  elevated?: boolean;
  role?: "viewer" | "owner";
  error?: string;
};

async function readResponse(response: Response): Promise<ElevationResponse> {
  return await response.json().catch(() => ({})) as ElevationResponse;
}

/** One session probe serves the header and every owner-only desk. */
export function OperationsAccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OperationsAccessState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/operations/elevation", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await readResponse(response);
      if (!response.ok) {
        throw new Error(body.error ?? "Operations status unavailable");
      }
      setState(
        body.elevated === true && body.role === "owner" ? "owner" : "viewer",
      );
    }).catch(() => {
      if (!controller.signal.aborted) setState("unavailable");
    });
    return () => controller.abort();
  }, []);

  return (
    <OperationsAccessContext.Provider value={{ state, setState }}>
      {children}
    </OperationsAccessContext.Provider>
  );
}

function useOperationsAccessContext(): OperationsAccessContextValue {
  const context = useContext(OperationsAccessContext);
  if (!context) {
    throw new Error(
      "Operations access must be read inside OperationsAccessProvider",
    );
  }
  return context;
}

export function useOperationsAccess(): OperationsAccessState {
  return useOperationsAccessContext().state;
}

/** Optional operations elevation; the surrounding viewer shell always remains mounted. */
export function OperationsAccess() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const { state: access, setState: setAccess } = useOperationsAccessContext();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : triggerRef.current;
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled)")
        ?? dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
      first?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [open]);

  function close() {
    requestAbortRef.current?.abort(new DOMException("Operations dialog closed", "AbortError"));
    requestAbortRef.current = null;
    setBusy(false);
    setOpen(false);
    setSecret("");
    setError("");
  }

  function beginRequest() {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("Operations request timed out", "TimeoutError"));
    }, 12_000);
    return {
      controller,
      finish: () => {
        window.clearTimeout(timeout);
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
      },
    };
  }

  async function unlock(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true);
    setError("");
    const request = beginRequest();
    try {
      const response = await fetch("/api/operations/elevation", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ secret }),
        signal: request.controller.signal,
      });
      const body = await readResponse(response);
      if (!response.ok || body.elevated !== true || body.role !== "owner") {
        throw new Error(body.error ?? "Operations could not be unlocked");
      }
      setSecret("");
      setAccess("owner");
      window.location.reload();
    } catch (reason) {
      if (request.controller.signal.reason instanceof DOMException
        && request.controller.signal.reason.message === "Operations dialog closed") return;
      setError(reason instanceof Error ? reason.message : "Operations could not be unlocked");
    } finally {
      request.finish();
      setBusy(false);
    }
  }

  async function lock() {
    if (busy) return;
    setBusy(true);
    setError("");
    const request = beginRequest();
    try {
      const response = await fetch("/api/operations/elevation", {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: request.controller.signal,
      });
      const body = await readResponse(response);
      if (!response.ok) throw new Error(body.error ?? "Operations could not be locked");
      setAccess("viewer");
      window.location.reload();
    } catch (reason) {
      if (request.controller.signal.reason instanceof DOMException
        && request.controller.signal.reason.message === "Operations dialog closed") return;
      setError(reason instanceof Error ? reason.message : "Operations could not be locked");
    } finally {
      request.finish();
      setBusy(false);
    }
  }

  const unlocked = access === "owner";

  function containDialogFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`operations-access-trigger${unlocked ? " is-unlocked" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        title={unlocked ? "Owner operations are unlocked" : "Unlock settings, scheduling, rendering and publishing controls"}
      >
        <span className="operations-access-dot" aria-hidden="true" />
        <span className="operations-access-label">
          {unlocked ? "Operations unlocked" : access === "checking" ? "Checking access" : "Unlock operations"}
        </span>
      </button>

      {open ? (
        <div
          className="operations-access-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={dialogRef}
            className="operations-access-dialog glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operations-access-title"
            onKeyDown={containDialogFocus}
          >
            <button
              type="button"
              className="operations-access-close"
              onClick={close}
              aria-label="Close operations access"
            >
              ×
            </button>
            <span className="operations-access-eyebrow">Optional owner controls</span>
            <h2 id="operations-access-title">
              {unlocked ? "Operations are unlocked" : "Unlock operating controls"}
            </h2>
            <p>
              {unlocked
                ? "Owner controls are available in this browser session."
                : "The studio stays readable. Unlock only when you need settings, schedules, OAuth, renders or publishing."}
            </p>
            <p className="operations-access-safety">
              Paid render and publish review gates remain enforced.
            </p>

            {unlocked ? (
              <button type="button" className="operations-access-secondary" onClick={() => void lock()} disabled={busy}>
                {busy ? "Locking…" : "Lock operations"}
              </button>
            ) : (
              <form onSubmit={unlock} className="operations-access-form">
                <label htmlFor="operations-key">Operations key</label>
                <input
                  id="operations-key"
                  name="operations-key"
                  type="password"
                  autoComplete="current-password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoFocus
                  required
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !secret}>
                  {busy ? "Unlocking…" : "Unlock operations"}
                </button>
              </form>
            )}

            {error ? <p className="operations-access-error" role="alert">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
