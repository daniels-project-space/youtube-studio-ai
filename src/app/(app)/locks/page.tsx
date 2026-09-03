"use client";

/**
 * Owner locks.
 *
 * Locking is deliberately a human-only surface. The enforcement is a Claude
 * Code PreToolUse hook that lives outside this repository, so a locked module
 * cannot be edited by any AI worker — and the hook also refuses edits to the
 * lock registry and to itself, so a worker cannot quietly unlock anything.
 */
import { useCallback, useEffect, useState } from "react";

interface ModuleLock {
  id: string;
  label: string;
  description: string;
  fileCount: number;
  locked: boolean;
  lockedAt: string | null;
}

export default function LocksPage() {
  const [modules, setModules] = useState<ModuleLock[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/module-locks", { cache: "no-store" });
      const data = await res.json() as { modules: ModuleLock[] };
      setModules(data.modules ?? []);
      setError(null);
    } catch {
      setError("Could not load lock state.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (id: string, locked: boolean) => {
    setBusy(id);
    try {
      const res = await fetch("/api/module-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, locked }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch {
      setError(`Could not ${locked ? "lock" : "unlock"} ${id}.`);
    } finally {
      setBusy(null);
    }
  }, [load]);

  return (
    <main style={{ padding: 28, maxWidth: 900 }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Owner locks</h1>
      <p style={{ color: "#96a2b8", marginTop: 0, lineHeight: 1.6 }}>
        A locked module cannot be modified by any AI worker — Claude, Codex, or anything else driving
        the editing tools. Enforcement runs as a pre-edit hook outside this repository, and it also
        refuses changes to the lock registry and to itself, so nothing can unlock itself. Unlocking
        happens only here.
      </p>
      {error ? <p style={{ color: "#e2585c" }}>{error}</p> : null}
      <div style={{ display: "grid", gap: 12, marginTop: 22 }}>
        {modules.map((mod) => (
          <div
            key={mod.id}
            style={{
              border: `1px solid ${mod.locked ? "#43c98a66" : "#242b38"}`,
              background: mod.locked ? "#43c98a0f" : "#141821",
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {mod.locked ? "🔒 " : ""}{mod.label}
              </div>
              <div style={{ color: "#96a2b8", fontSize: 13, marginTop: 3 }}>{mod.description}</div>
              <div style={{ color: "#6c7789", fontSize: 12, marginTop: 5 }}>
                {mod.fileCount} protected file{mod.fileCount === 1 ? "" : "s"}
                {mod.lockedAt ? ` · locked ${new Date(mod.lockedAt).toLocaleString()}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={busy === mod.id}
              onClick={() => void toggle(mod.id, !mod.locked)}
              style={{
                cursor: busy === mod.id ? "wait" : "pointer",
                background: mod.locked ? "#43c98a" : "transparent",
                color: mod.locked ? "#08120d" : "#e8edf6",
                border: `1px solid ${mod.locked ? "#43c98a" : "#3a4354"}`,
                borderRadius: 8,
                padding: "9px 16px",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {busy === mod.id ? "…" : mod.locked ? "Locked" : "Lock"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
