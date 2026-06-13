"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface ProofImage { src: string; alt: string }

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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setIdx(null), []);
  const prev = useCallback(() => setIdx((i) => (i === null ? i : (i - 1 + images.length) % images.length)), [images.length]);
  const next = useCallback(() => setIdx((i) => (i === null ? i : (i + 1) % images.length)), [images.length]);

  useEffect(() => {
    if (idx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    // Lock scroll WITHOUT a layout jump: compensate the scrollbar width.
    const body = document.body;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [idx, close, prev, next]);

  const overlay =
    idx !== null ? (
      <div onClick={close} style={OVERLAY} role="dialog" aria-modal="true">
        <button onClick={(e) => { e.stopPropagation(); prev(); }} style={{ ...NAV, left: 12 }} aria-label="Previous">‹</button>
        {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image */}
        <img
          src={`/golden/${images[idx].src}`}
          alt={images[idx].alt}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "90vw", maxHeight: "84vh", borderRadius: 10, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}
        />
        <button onClick={(e) => { e.stopPropagation(); next(); }} style={{ ...NAV, right: 12 }} aria-label="Next">›</button>
        <button onClick={(e) => { e.stopPropagation(); close(); }} style={CLOSE} aria-label="Close">×</button>
        <div style={CAPTION}>{images[idx].alt} · {idx + 1}/{images.length}</div>
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
          // eslint-disable-next-line @next/next/no-img-element -- static proof image
          <img
            key={p.src}
            src={`/golden/${p.src}`}
            alt={p.alt}
            title={p.alt}
            loading="lazy"
            onClick={() => setIdx(i)}
            style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 7, border: "1px solid var(--color-border)", cursor: "zoom-in", display: "block" }}
          />
        ))}
      </div>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
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
  fontFamily: "var(--font-mono)",
  fontSize: "0.72rem",
  color: "rgba(255,255,255,0.7)",
  background: "rgba(20,20,24,0.7)",
  padding: "0.35rem 0.8rem",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
