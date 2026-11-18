import type { ReactNode } from "react";

export type ChannelDurationSettings = {
  durationSource: "assembly" | "script_maximum" | null;
  targetSeconds: number | null;
  minimumSeconds: number | null;
  maximumSeconds: number | null;
};

function seconds(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not recorded";
  if (value > 0 && value % 3600 === 0) return `${value / 3600} hr (${value} sec)`;
  if (value > 0 && value % 60 === 0) return `${value / 60} min (${value} sec)`;
  return `${value} sec`;
}

export function ChannelDurationReadOnly({ effective }: { effective: ChannelDurationSettings | null | undefined }): ReactNode {
  const label = effective?.durationSource === "assembly" ? "Assembly duration" : effective?.durationSource === "script_maximum" ? "Script maximum" : "Duration";
  return <div>
    {effective === undefined ? <span role="status">Loading saved duration...</span> : effective === null ? <span role="status">Saved duration is unavailable.</span> : <>
      <div><strong>{label}:</strong> {seconds(effective.targetSeconds)}</div>
      <div><strong>Saved length range:</strong> {effective.minimumSeconds === null && effective.maximumSeconds === null ? "Not recorded" : `${seconds(effective.minimumSeconds)} to ${seconds(effective.maximumSeconds)}`}</div>
    </>}
    <p>Read only: an admitted format and route can bind duration; changing it requires route and preparation checks.</p>
    <p>These are saved pipeline values. A finished video can have a different length.</p>
  </div>;
}
