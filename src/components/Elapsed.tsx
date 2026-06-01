"use client";

import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/format";

/**
 * Live-ticking elapsed duration. If `to` is set the run has finished and the
 * value is static; otherwise it ticks every second off `from`.
 */
export function Elapsed({ from, to }: { from?: number; to?: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (to || !from) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [from, to]);

  return (
    <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
      {fmtDuration(from, to)}
    </span>
  );
}
