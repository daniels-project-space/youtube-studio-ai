"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function OperatorLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const token = String(new FormData(event.currentTarget).get("token") ?? "");
    const response = await fetch("/api/auth/operator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(body?.error ?? "Login failed");
      setBusy(false);
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("next") ?? "/";
    const next = requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/";
    router.replace(next);
    router.refresh();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#090b10",
        color: "#f5f7fb",
        padding: 24,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "min(420px, 100%)",
          display: "grid",
          gap: 16,
          padding: 28,
          border: "1px solid #2a3040",
          borderRadius: 16,
          background: "#111520",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Operator access</h1>
          <p style={{ color: "#aeb7ca", lineHeight: 1.5 }}>
            Authenticate before connecting accounts or launching paid renders.
          </p>
        </div>
        <input
          name="token"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          placeholder="Operator token"
          style={{
            padding: "12px 14px",
            borderRadius: 9,
            border: "1px solid #3a4357",
            background: "#0b0e15",
            color: "inherit",
          }}
        />
        {error ? <p role="alert" style={{ color: "#ff8c8c", margin: 0 }}>{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "12px 14px",
            border: 0,
            borderRadius: 9,
            fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Authenticating…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
