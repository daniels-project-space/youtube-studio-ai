"use client";

/**
 * Owner locks — the full list, in one place.
 *
 * The same locks appear inline on the Golden catalog and on the channels page;
 * this is the overview that answers "what have I frozen?" without hunting.
 *
 * Locking is deliberately a human-only surface: `ownerModuleLocks.setLock`
 * requires an interactive owner identity, and every automated caller
 * authenticates as a service. Enforcement is a pre-edit hook outside this
 * repository that also refuses edits to its own file and to the lock mirror, so
 * a worker cannot quietly unlock anything.
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { LOCKABLE_MODULES } from "@/lib/ownerLockRegistry";
import { OwnerLockBadge } from "@/components/OwnerLockBadge";
import { NicheMotionGlyph } from "@/components/NicheMotionGlyph";
import styles from "./locks.module.css";

export default function LocksPage() {
  const ownerId = useOwnerId();
  const locks = useQuery(api.ownerModuleLocks.list, { ownerId });
  const lockedKeys = useMemo(
    () => new Set((locks ?? []).map((row) => row.moduleKey)),
    [locks],
  );

  // Locked first: the point of this page is to see what is frozen.
  const ordered = useMemo(
    () => [...LOCKABLE_MODULES].sort((a, b) => {
      const byLock = Number(lockedKeys.has(b.id)) - Number(lockedKeys.has(a.id));
      return byLock !== 0 ? byLock : a.label.localeCompare(b.label);
    }),
    [lockedKeys],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof ordered>();
    for (const entity of ordered) {
      const key = entity.description.split(" · ", 1)[0]?.trim() || "catalog";
      const rows = map.get(key) ?? [];
      rows.push(entity);
      map.set(key, rows);
    }
    return [...map.entries()];
  }, [ordered]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headingCopy}>
          <span className={styles.eyebrow}>Governance · protection</span>
          <h1>Owner locks</h1>
          <p>Freeze modules before they ship. Only your explicit unlock reopens them.</p>
        </div>
        <div className={styles.summary} aria-label="Lock summary">
          <div><span>Sealed</span><strong>{lockedKeys.size}</strong></div>
          <div><span>Available</span><strong>{Math.max(0, ordered.length - lockedKeys.size)}</strong></div>
          <div><span>Coverage</span><strong>{ordered.filter((entity) => entity.paths.length > 0).length}</strong></div>
        </div>
      </header>

      <section className={styles.policy} aria-label="Lock policy">
        <div className={styles.policyMark} aria-hidden="true"><NicheMotionGlyph motif="casefile" /></div>
        <div><strong>Protected at the source</strong><span>Module locks cover every linked worktree. Channel locks remain separate and protect one channel’s configuration.</span></div>
        <span className={styles.policyRule}>Owner action only</span>
      </section>

      <section className={styles.moduleSection} aria-labelledby="module-locks-title">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Module protection</span><h2 id="module-locks-title">Production building blocks</h2></div>
          <span className={styles.sectionMeta}>{lockedKeys.size}/{ordered.length} sealed</span>
        </div>
        <div className={styles.groups}>
        {groups.map(([group, entities], groupIndex) => {
          const groupLocked = entities.filter((entity) => lockedKeys.has(entity.id)).length;
          return <details className={styles.group} key={group} open={groupLocked > 0 || groupIndex === 0}>
            <summary className={styles.groupSummary}>
              <span className={styles.groupIndex}>{String(groupIndex + 1).padStart(2, "0")}</span>
              <strong>{groupLabel(group)}</strong>
              <span>{groupLocked}/{entities.length} sealed</span>
              <i aria-hidden="true">+</i>
            </summary>
            <div className={styles.grid}>
        {entities.map((entity) => {
          const locked = lockedKeys.has(entity.id);
          return (
            <div
              key={entity.id}
              className={styles.card}
              data-locked={locked || undefined}
            >
              <div className={styles.cardMark} aria-hidden="true"><NicheMotionGlyph motif="casefile" /></div>
              <div className={styles.cardCopy}>
                <div className={styles.cardTitle}><strong>{entity.label}</strong><span data-state={locked ? "sealed" : "open"}>{locked ? "Sealed" : "Open"}</span></div>
                <p>{entity.description}</p>
                <small className={entity.paths.length ? undefined : styles.noCoverage}>
                  {entity.paths.length} protected file{entity.paths.length === 1 ? "" : "s"}
                  {entity.paths.length === 0 ? " · catalog contract only" : " · source enforced"}
                </small>
              </div>
              <OwnerLockBadge kind="module" moduleId={entity.id} label={entity.label} />
            </div>
          );
        })}
            </div>
          </details>;
        })}
        </div>
      </section>
    </main>
  );
}

function groupLabel(value: string): string {
  const labels: Record<string, string> = {
    brief: "Brief & story",
    build: "Build & assembly",
    guard: "Quality gates",
    intel: "Research & intel",
    layer: "Presentation",
    package: "Packaging",
    post: "Post-production",
    ship: "Release",
    sound: "Sound",
    verify: "Verification",
    visual: "Visuals",
    voice: "Voice",
    write: "Writing",
    catalog: "Catalog contracts",
  };
  return labels[value.toLowerCase()] ?? value;
}
