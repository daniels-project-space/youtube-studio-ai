"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * Renders a private R2 object (thumbnail/image) by presigning it via the
 * server-only /api/asset-url route — the browser only ever sees the short-lived
 * signed URL. Shows a tasteful placeholder while loading / when absent. Optional
 * `fallbackSrc` (e.g. a public YouTube thumb) is used if there's no R2 key.
 */
export function AssetImg({
  k,
  alt,
  style,
  fallbackSrc,
}: {
  k?: string | null;
  alt: string;
  style?: CSSProperties;
  fallbackSrc?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!k) {
      setUrl(null);
      return;
    }
    let live = true;
    fetch(`/api/asset-url?key=${encodeURIComponent(k)}`)
      .then((r) => r.json())
      .then((d) => { if (live && d.url) setUrl(d.url); })
      .catch(() => {});
    return () => { live = false; };
  }, [k]);

  const base: CSSProperties = {
    background: "var(--color-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-muted)",
    fontSize: "0.72rem",
    ...style,
  };
  const src = url ?? (!k ? fallbackSrc : undefined);
  if (!src) return <div style={base}>{k ? "rendering…" : "no thumbnail"}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} style={{ objectFit: "cover", ...style }} />;
}
