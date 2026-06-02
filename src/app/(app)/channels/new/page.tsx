"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

type Phase = "idle" | "building" | "error";

const STEPS = [
  "Researching the niche…",
  "Designing the channel identity…",
  "Generating channel art…",
  "Wiring the pipeline…",
  "Finalizing…",
];

export default function NewChannelPage() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate the descriptive caption while building (the run itself is autonomous).
  useEffect(() => {
    if (phase !== "building") return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function submit() {
    const s = seed.trim();
    if (!s) return;
    setPhase("building");
    setError(null);
    setStep(0);
    try {
      const res = await fetch("/api/build-channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: s }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start the builder.");
        setPhase("error");
        return;
      }
      poll(data.id);
    } catch {
      setError("Network error starting the builder.");
      setPhase("error");
    }
  }

  function poll(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/build-channel?id=${encodeURIComponent(id)}`);
        const d = await r.json();
        if (d.status === "COMPLETED" && d.output?.slug) {
          if (pollRef.current) clearInterval(pollRef.current);
          router.push(`/channels/${d.output.slug}`);
        } else if (
          ["FAILED", "CRASHED", "CANCELED", "TIMED_OUT"].includes(d.status)
        ) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(
            (typeof d.error === "object" && d.error?.message) ||
              `Build ${String(d.status).toLowerCase()}.`,
          );
          setPhase("error");
        }
      } catch {
        /* transient; keep polling */
      }
    }, 2500);
  }

  return (
    <>
      <PageHeader
        title="New channel"
        subtitle="Describe an idea — the studio designs the whole channel autonomously."
      />

      {phase === "building" ? (
        <div
          className="glass glass-shine"
          style={{ padding: "2.5rem", display: "grid", placeItems: "center", gap: "1.1rem" }}
        >
          <div className="studio-pulse" style={{ fontSize: "2rem" }}>✦</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
            Building “{seed.trim()}”
          </div>
          <div style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>{STEPS[step]}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--color-faint)" }}>
            This takes ~30–60s. You’ll land on the new channel when it’s ready.
          </div>
        </div>
      ) : (
        <div className="glass glass-shine" style={{ padding: "1.6rem", display: "grid", gap: "1rem", maxWidth: 640 }}>
          <label style={{ display: "grid", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
              What should this channel be about?
            </span>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. rainy cyberpunk lofi for late-night study"
              autoFocus
              style={{
                padding: "0.8rem 1rem",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-fg)",
                font: "inherit",
                fontSize: "0.95rem",
              }}
            />
          </label>

          {error && (
            <div style={{ fontSize: "0.85rem", color: "var(--color-failed)" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={submit}
              disabled={!seed.trim()}
              className="lift"
              style={{
                padding: "0.7rem 1.3rem",
                borderRadius: 10,
                border: "none",
                cursor: seed.trim() ? "pointer" : "not-allowed",
                background: "var(--color-accent)",
                color: "#0a0a0b",
                fontWeight: 600,
                font: "inherit",
                opacity: seed.trim() ? 1 : 0.5,
              }}
            >
              Create channel
            </button>
            <Link href="/channels" style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>
              Cancel
            </Link>
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--color-faint)", margin: 0 }}>
            The studio researches the niche, designs the identity + palette, generates avatar &
            banner art, picks the best archetype, and wires the pipeline — then drops you on the
            new channel to review or edit.
          </p>
        </div>
      )}
    </>
  );
}
