"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./GoldenImages.module.css";

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
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={evidenceId}
      >
        <button onClick={(e) => { e.stopPropagation(); prev(); }} className={`${styles.nav} ${styles.previous}`} aria-label="Previous">‹</button>
        {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image */}
        <img
          src={images[idx].src}
          alt={images[idx].alt}
          onClick={(e) => e.stopPropagation()}
          className={styles.lightboxImage}
        />
        <button onClick={(e) => { e.stopPropagation(); next(); }} className={`${styles.nav} ${styles.next}`} aria-label="Next">›</button>
        <button ref={closeRef} onClick={(e) => { e.stopPropagation(); close(); }} className={styles.close} aria-label="Close">×</button>
        <div className={styles.caption}>
          <span id={titleId}>{images[idx].alt} · {idx + 1}/{images.length}</span>
          <span id={evidenceId} data-context={images[idx].status === "context"}>{evidenceLabel(images[idx])} · {images[idx].id}</span>
          {fingerprint(images[idx]) && <span>{fingerprint(images[idx])}</span>}
        </div>
      </div>
    ) : null;

  return (
    <>
      <div className={styles.proofGrid}>
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
            className={styles.proofButton}
            data-context={p.status === "context"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- manifest-resolved proof image */}
            <img src={p.src} alt={p.alt} loading="lazy" className={styles.proofImage} />
            <span className={styles.proofStatus}>{evidenceLabel(p)}</span>
            <span className={styles.proofId}>{p.id}</span>
            {fingerprint(p) && <span className={styles.proofHash}>{fingerprint(p)}</span>}
          </button>
        ))}
      </div>
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
