import type { SVGProps } from "react";

/**
 * AutoStudio's in-house signal mark: a cut frame, orbiting source, and play
 * wedge converge into one release object. It stays legible from favicon size
 * through channel-art scale and avoids a generic sparkle/robot silhouette.
 */
export function StudioMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      data-studio-mark="signal-frame"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d="M5.5 10V5.5H10M22 5.5h4.5V10M26.5 22v4.5H22M10 26.5H5.5V22" stroke="var(--studio-mark-release, #f3f0e8)" strokeWidth="1.6" strokeLinecap="square" data-node="release" />
      <circle cx="16" cy="16" r="9" stroke="var(--studio-mark-route, #b6df62)" strokeWidth="1.25" strokeDasharray="2.2 3.4" data-node="orbit" />
      <circle cx="8.2" cy="12" r="2" fill="var(--studio-mark-route, #b6df62)" data-node="source" />
      <path d="M13 10.8v10.4L22 16l-9-5.2Z" fill="var(--studio-mark-signal, #ff7046)" data-node="artifact" />
    </svg>
  );
}
