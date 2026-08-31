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
    <section className={`${styles.card} glass`} aria-label="Automatic video foundation">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Automatic video foundation</span>
          <h3>Every episode starts from the same release-safe structure.</h3>
        </div>
        <div className={styles.lane}>
          <span>{foundation.contentLane.replaceAll("_", " ")}</span>
          <strong>{foundation.primaryRenderer.replaceAll("_", " ")}</strong>
        </div>
      </header>

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

      <p className={styles.note}>
        Creative modules can enrich this path only when the selected route needs them; they cannot replace its renderer, quality review, or release gate.
      </p>
    </section>
  );
}
