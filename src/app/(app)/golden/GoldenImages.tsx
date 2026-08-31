"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export interface ProofImage {
  id: string;
  src: string;
  alt: string;
  /** The server resolves this from the Golden proof-media manifest. */
  status?: "reference" | "context";
  /** Full content fingerprint; the compact viewer shows an inspectable prefix. */
  sha256?: string;
}

function evidenceLabel(image: ProofImage): string {
  return image.status === "context" ? "CONTEXT ONLY" : "MANIFEST REFERENCE";
}

function fingerprint(image: ProofImage): string | undefined {
  return image.sha256 ? `SHA-256 ${image.sha256.slice(0, 12)}…` : undefined;
}

/**
 * Golden proof images — a wrapping grid (everything visible at once, no
 * carousel). Each image opens a full-screen lightbox with prev/next side
 * buttons, close, backdrop-click and keyboard (Esc / ← / →).
 *
 * The overlay is PORTALED to document.body: the cards use backdrop-filter
 * (.glass), which makes position:fixed anchor to the card, not the viewport —
 * the portal escapes that containing block so the overlay covers the screen
 * cleanly and toggling it never shifts the page (no twitch/flicker). The scroll
 * lock compensates for the scrollbar width so the layout doesn't jump either.
 */
export function GoldenImages({ images }: { images: ProofImage[] }) {
  const [idx, setIdx] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const evidenceId = useId();
  const open = idx !== null;

  const close = useCallback(() => setIdx(null), []);
  const prev = useCallback(() => setIdx((i) => (i === null ? i : (i - 1 + images.length) % images.length)), [images.length]);
  const next = useCallback(() => setIdx((i) => (i === null ? i : (i + 1) % images.length)), [images.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // Lock scroll WITHOUT a layout jump: compensate the scrollbar width.
    const body = document.body;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      openerRef.current?.focus();
    };
  }, [open, close, prev, next]);

  const overlay =
    idx !== null ? (
      <div
        ref={dialogRef}
        onClick={close}
        style={OVERLAY}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={evidenceId}
      >
        <button onClick={(e) => { e.stopPropagation(); prev(); }} style={{ ...NAV, left: 12 }} aria-label="Previous">‹</button>
        {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image */}
        <img
          src={images[idx].src}
          alt={images[idx].alt}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "90vw", maxHeight: "84vh", borderRadius: 10, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}
        />
        <button onClick={(e) => { e.stopPropagation(); next(); }} style={{ ...NAV, right: 12 }} aria-label="Next">›</button>
        <button ref={closeRef} onClick={(e) => { e.stopPropagation(); close(); }} style={CLOSE} aria-label="Close">×</button>
        <div style={CAPTION}>
          <span id={titleId}>{images[idx].alt} · {idx + 1}/{images.length}</span>
          <span id={evidenceId} style={{ color: images[idx].status === "context" ? "#f9c968" : "#d9ddff" }}>{evidenceLabel(images[idx])} · {images[idx].id}</span>
          {fingerprint(images[idx]) && <span>{fingerprint(images[idx])}</span>}
        </div>
      </div>
    ) : null;

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))",
          gap: "0.5rem",
          marginTop: "0.9rem",
          paddingTop: "0.85rem",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {images.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              setIdx(i);
            }}
            aria-label={`Inspect ${evidenceLabel(p).toLowerCase()} artifact ${p.id}: ${p.alt}`}
            title={`${evidenceLabel(p)} · ${p.id}${fingerprint(p) ? ` · ${fingerprint(p)}` : ""}`}
            style={PROOF_BUTTON}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- manifest-resolved proof image */}
            <img src={p.src} alt={p.alt} loading="lazy" style={PROOF_IMAGE} />
            <span style={{ ...PROOF_STATUS, color: p.status === "context" ? "var(--color-warning)" : "var(--color-gold)" }}>{evidenceLabel(p)}</span>
            <span style={PROOF_ID}>{p.id}</span>
            {fingerprint(p) && <span style={PROOF_HASH}>{fingerprint(p)}</span>}
          </button>
        ))}
      </div>
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}

const OVERLAY: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(8, 8, 10, 0.92)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem",
};

const NAV: CSSProperties = {
  position: "fixed",
  top: "50%",
  transform: "translateY(-50%)",
  width: 48,
  height: 48,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(20,20,24,0.7)",
  color: "#fff",
  fontSize: "1.8rem",
  lineHeight: 1,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const CLOSE: CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(20,20,24,0.7)",
  color: "#fff",
  fontSize: "1.4rem",
  lineHeight: 1,
  cursor: "pointer",
};

const CAPTION: CSSProperties = {
  position: "fixed",
  bottom: 20,
  left: "50%",
  transform: "translateX(-50%)",
  display: "grid",
  gap: "0.12rem",
  fontFamily: "var(--font-mono)",
  fontSize: "0.72rem",
  color: "rgba(255,255,255,0.7)",
  background: "rgba(20,20,24,0.7)",
  padding: "0.35rem 0.8rem",
  borderRadius: 999,
  maxWidth: "calc(100vw - 2rem)",
  textAlign: "center",
};

const PROOF_BUTTON: CSSProperties = {
  appearance: "none",
  width: "100%",
  padding: 0,
  overflow: "hidden",
  borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-solid)",
  color: "var(--color-fg)",
  cursor: "zoom-in",
  textAlign: "left",
  display: "grid",
};

const PROOF_IMAGE: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  objectFit: "cover",
  display: "block",
  borderBottom: "1px solid var(--color-border)",
};

const PROOF_STATUS: CSSProperties = {
  padding: "0.38rem 0.45rem 0",
  fontFamily: "var(--font-mono)",
  fontSize: "0.52rem",
  letterSpacing: "0.055em",
  fontWeight: 700,
};

const PROOF_ID: CSSProperties = {
  padding: "0.08rem 0.45rem 0",
  fontFamily: "var(--font-mono)",
  fontSize: "0.55rem",
  color: "var(--color-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const PROOF_HASH: CSSProperties = {
  padding: "0.1rem 0.45rem 0.43rem",
  fontFamily: "var(--font-mono)",
  fontSize: "0.5rem",
  color: "var(--color-faint)",
};
