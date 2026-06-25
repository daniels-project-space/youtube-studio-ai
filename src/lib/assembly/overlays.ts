/**
 * overlays — PURE mapping from the typed EDL `Overlay[]` to the two render
 * primitives the god-block's `finishFromComposed` pass consumes:
 *   - caption overlays  → CaptionCue[]        (burned via libass / writeCaptionsAss)
 *   - quote/insert overlays → QuoteOverlaySpec[] (alpha-composited via
 *     applyOverlaysAndCaptions / applyQuoteOverlays)
 *
 * NO I/O, NO ffmpeg, NO Remotion — just data. Every drop (a caption with no text,
 * a quote/insert with no renderable media) surfaces as a typed warning; nothing is
 * silently skipped (the module's "drops surface as warnings" contract).
 *
 * ADDITIVE ONLY — the live `timeline_assemble` block builds its QuoteOverlaySpec[]
 * directly from ctx.store and does NOT import this. This is the standalone Assembly
 * module's bridge from a declarative Timeline to those same proven primitives.
 */
import type { QuoteOverlaySpec } from "@/lib/ffmpeg";
import type { Overlay } from "./timeline";

/** A burnable caption window (matches ffmpeg.ts CaptionCue). */
export interface OverlayCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface CuesAndSpecs {
  /** Caption windows → libass cues. */
  cues: OverlayCue[];
  /** Quote/insert windows → alpha-overlay specs. */
  specs: QuoteOverlaySpec[];
  /** Typed degradations — a skipped caption/quote/insert. Never silent. */
  warnings: string[];
}

/** Number guard — finite & ≥ 0. */
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Map EDL `Overlay[]` → caption cues + quote/insert specs (+ warnings).
 *
 *   kind:'caption'        → an OverlayCue. Needs `text`; missing/blank ⇒ warn + skip.
 *   kind:'quote'|'insert' → a QuoteOverlaySpec built from a renderable media path
 *                           (overlay.src, or overlay.data.path) + start + (end-start)
 *                           as durSec, carrying data fields (text/highlights/
 *                           width/height/noBlur). Missing media ⇒ warn + skip
 *                           (NEVER fake — the alpha card must be a real Remotion-
 *                           rendered .webm/.mov; we do not invent one).
 */
export function overlaysToCuesAndSpecs(overlays: Overlay[]): CuesAndSpecs {
  const cues: OverlayCue[] = [];
  const specs: QuoteOverlaySpec[] = [];
  const warnings: string[] = [];

  overlays.forEach((o, i) => {
    const durSec = o.endSec - o.startSec;
    if (o.kind === "caption") {
      const text = (o.text ?? "").trim();
      if (!text) {
        warnings.push(`overlay[${i}] (caption): no text — skipped`);
        return;
      }
      cues.push({ startSec: o.startSec, endSec: o.endSec, text });
      return;
    }

    // quote | insert → QuoteOverlaySpec
    const data = (o.data ?? {}) as Record<string, unknown>;
    const path =
      o.src ??
      (typeof data.path === "string" ? data.path : undefined) ??
      (typeof data.src === "string" ? data.src : undefined);
    if (!path) {
      warnings.push(
        `overlay[${i}] (${o.kind}): no renderable media path (needs src or data.path — a Remotion-rendered alpha card) — skipped`,
      );
      return;
    }
    const spec: QuoteOverlaySpec = {
      path,
      startSec: o.startSec,
      durSec,
    };
    // Carry through optional re-render fields when present in data.
    if (typeof data.text === "string") spec.text = data.text;
    else if (typeof o.text === "string") spec.text = o.text;
    if (Array.isArray(data.highlights)) {
      spec.highlights = (data.highlights as unknown[]).filter((h): h is string => typeof h === "string");
    }
    if (isNum(data.width)) spec.width = data.width;
    if (isNum(data.height)) spec.height = data.height;
    if (typeof data.noBlur === "boolean") spec.noBlur = data.noBlur;
    specs.push(spec);
  });

  return { cues, specs, warnings };
}
