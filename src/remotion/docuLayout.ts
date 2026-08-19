/**
 * Pure geometry shared by the documentary renderer and server-side planning.
 *
 * Keep this outside the React composition: channel planning and validation run
 * in Route Handlers, where importing a `use client`-style composition would
 * make the entire render tree part of the server bundle.
 */
export type DocuLayout = "long" | "short";

export interface DocuSafeFrame {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Shared safe frame for every deterministic text layer in the composition. */
export function safeFrameForDocuLayout(
  width: number,
  height: number,
  layout: DocuLayout = "long",
): DocuSafeFrame {
  const portrait = layout === "short" || height > width;
  return portrait
    ? {
        top: height * 0.075,
        right: width * 0.075,
        // Leave a real lower-third/caption-safe zone on native Shorts.
        bottom: height * 0.18,
        left: width * 0.075,
      }
    : {
        top: height * 0.08,
        right: width * 0.06,
        bottom: height * 0.08,
        left: width * 0.06,
      };
}
