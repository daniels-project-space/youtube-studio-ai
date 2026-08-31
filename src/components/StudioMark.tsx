import type { SVGProps } from "react";

/**
 * AutoStudio's pipeline mark: three source lanes converge on a playable
 * artifact, then cross the release rail. It is intentionally drawn in-house.
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
      data-studio-mark="pipeline"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M7 8.5h4.5l3.5 3.2M7 16h8M7 23.5h4.5l3.5-3.2"
        stroke="var(--studio-mark-route, #6ad7c1)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="8.5" r="1.6" fill="var(--studio-mark-route, #6ad7c1)" data-node="source" />
      <circle cx="6" cy="16" r="1.6" fill="var(--studio-mark-route, #6ad7c1)" data-node="source" />
      <circle cx="6" cy="23.5" r="1.6" fill="var(--studio-mark-route, #6ad7c1)" data-node="source" />
      <path
        d="M14 10v12l10-6-10-6Z"
        fill="var(--studio-mark-signal, #e0a260)"
        data-node="artifact"
      />
      <path
        d="M26.5 9.5v13"
        stroke="var(--studio-mark-release, #f4f6f8)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".72"
        data-node="release"
      />
    </svg>
  );
}
