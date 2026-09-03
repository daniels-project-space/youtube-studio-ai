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

  return (
    <main style={{ padding: 28, maxWidth: 940 }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Owner locks</h1>
      <p style={{ color: "#96a2b8", marginTop: 0, lineHeight: 1.6, maxWidth: 720 }}>
        A locked module cannot be modified by any AI worker — Claude, Codex, or anything else driving
        the editing tools. Everything starts unlocked. Enforcement runs as a pre-edit hook on the
        workstation, and it also refuses changes to the lock mirror and to itself, so nothing can
        unlock itself. A module showing <strong>0 files</strong> is a catalog contract with no source
        of its own yet: locking it records your intent but blocks no edits.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 22 }}>
        {ordered.map((entity) => {
          const locked = lockedKeys.has(entity.id);
          return (
            <div
              key={entity.id}
              style={{
                border: `1px solid ${locked ? "#43c98a66" : "#242b38"}`,
                background: locked ? "#43c98a0f" : "#141821",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{entity.label}</div>
                <div style={{ color: "#96a2b8", fontSize: 12.5, marginTop: 3 }}>{entity.description}</div>
                <div style={{ color: entity.paths.length ? "#6c7789" : "#a1791f", fontSize: 12, marginTop: 5 }}>
                  {entity.paths.length} protected file{entity.paths.length === 1 ? "" : "s"}
                  {entity.paths.length === 0 ? " · no source to enforce against" : ""}
                </div>
              </div>
              <OwnerLockBadge kind="module" moduleId={entity.id} label={entity.label} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
