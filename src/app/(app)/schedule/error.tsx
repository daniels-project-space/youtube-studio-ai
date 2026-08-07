"use client";

import { useEffect } from "react";
import styles from "./schedule.module.css";

export default function ScheduleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("schedule surface failed", error);
  }, [error]);

  return (
    <div className={`${styles.errorState} glass`} role="alert">
      <span className={styles.eyebrow}>Live data unavailable</span>
      <h2>Could not load the publishing calendar</h2>
      <p>No schedule data has been guessed or replaced. Retry the authenticated live connection.</p>
      <button type="button" onClick={reset}>Retry live data</button>
    </div>
  );
}
