"use client";

import type { FamilyKey } from "@/engine/families";
import { contentLaneForFamily } from "@/engine/contentLane";
import { minimumVideoFoundationFor } from "@/engine/minimumVideoFoundation";
import styles from "./MinimumVideoFoundationCard.module.css";

export function MinimumVideoFoundationCard({ family }: { family: FamilyKey }) {
  const contentLane = contentLaneForFamily(family);
  if (!contentLane) return null;

  const foundation = minimumVideoFoundationFor({ family, contentLane });

  return (
    <details className={`${styles.card} glass`} aria-label="Automatic video foundation">
      <summary className={styles.summary}>
        <div className={styles.summaryCopy}>
          <span className={styles.eyebrow}>Automatic video foundation</span>
          <strong>{foundation.stages.length} release stages</strong>
        </div>
        <div className={styles.lane}>
          <span>{foundation.contentLane.replaceAll("_", " ")}</span>
          <strong>{foundation.primaryRenderer.replaceAll("_", " ")}</strong>
        </div>
        <i aria-hidden="true" />
      </summary>

      <div className={styles.body}>
        <ol className={styles.stages}>
          {foundation.stages.map((stage, index) => (
            <li key={stage.key}>
              <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{stage.title}</strong>
                <small>{stage.requirement}</small>
              </span>
            </li>
          ))}
        </ol>

        <p className={styles.note}>Creative modules cannot replace the renderer, quality review, or release gate.</p>
      </div>
    </details>
  );
}
