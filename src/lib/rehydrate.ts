/**
 * Resume rehydration: make a previously-completed block's persisted outputs
 * usable on a fresh worker. Local temp files (e.g. narrationLocalPath,
 * videoLocalPath, loopUnitUrl) don't survive a crash/retry, so we re-download
 * them from their sibling R2 key (narrationKey, videoKey, loopUnitKey). Returns
 * ok:false when a value can't be restored (the runner then re-runs that block).
 *
 * Convention: a missing local path `<base><LocalPath|Url|Path>` is restored from
 * the R2 key `<base>Key` in the same outputs patch. Arrays of local paths
 * (footageClips/entityClips) have no per-item R2 key → ok:false (cheap re-run).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { classifyExecutionError } from "@/engine/executionErrors";
import { getObjectBytes } from "@/lib/storage";
import { makeRunTempDir, writeBytes } from "@/lib/files";

function isLocalPath(v: unknown): v is string {
  // STRICT filesystem-path shape only. The old test (any non-URL string
  // containing a slash) classified brief prose like "24/7" or "sun/rain" as
  // local paths — whole cached stages were declared "not rehydratable" and
  // re-RAN, re-billing paid TTS/music/footage on every resume (observed live
  // on the meditation resume: $0.35 ElevenLabs re-spend for nothing).
  return (
    typeof v === "string" &&
    v.length > 3 &&
    v.length < 400 &&
    !/\s/.test(v) &&
    /^(?:[A-Za-z]:[\\/]|\/)/.test(v)
  );
}

function looksLikeR2Key(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !/^https?:\/\//i.test(v) && !/^[/\\]/.test(v) && !/^[a-zA-Z]:\\/.test(v);
}

/** A confirmed missing object can be regenerated; infra failures must not bill. */
function isMissingStoredObject(error: unknown): boolean {
  const classified = classifyExecutionError(error);
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name).toUpperCase()
      : "";
  return (
    classified.status === 404 ||
    classified.code === "NOSUCHKEY" ||
    name === "NOSUCHKEY" ||
    name === "NOTFOUND"
  );
}

/** Recursively: does this value contain a local-path string that's missing? */
function hasMissingLocalPath(val: unknown): boolean {
  if (typeof val === "string") return isLocalPath(val) && !existsSync(val);
  if (Array.isArray(val)) return val.some(hasMissingLocalPath);
  if (val && typeof val === "object") return Object.values(val).some(hasMissingLocalPath);
  return false;
}

/**
 * The sibling R2-key fields `rehydrateOutputs` needs to find in the SAME patch
 * to restore `key`. Kept next to the restore rules below because the two must
 * evolve together: narrationLocalPath←narrationKey, musicUrl←musicKey,
 * introCardPath←introCardKey, footageClips←footageKeys, entityClips←entityKeys.
 * (Nested overlay specs carry their own `key` per item, so they need nothing.)
 */
function siblingR2KeyFields(key: string): string[] {
  const fields: string[] = [];
  const base = key.replace(/(LocalPath|Url|Path)$/, "");
  if (base !== key) fields.push(`${base}Key`);
  if (/Clips$/.test(key)) fields.push(`${key.replace(/Clips$/, "")}Keys`);
  return fields;
}

/**
 * Narrow one completed block's outputs to just what a specific CONSUMER needs
 * rehydrated, so a fresh worker pays R2 GETs only for artifacts it will read.
 *
 * The render child (render-block) used to rehydrate EVERY completed upstream
 * block's outputs — narration, every footage clip, intro card, overlays, music,
 * avatar — even when the block it was dispatched to run consumes none of them
 * (novita_render_images/_video and documotion_short consume no media at all).
 * That was 15-40 pointless R2 GETs per dispatch, repeated on every retry.
 *
 * Returns `null` when the consumer needs nothing from this patch (caller skips
 * the fetch entirely), otherwise the needed values PLUS their sibling R2 keys.
 * Callers must still merge the block's raw outputs into the store: this decides
 * what we PAY to fetch, never what the consumer is allowed to see.
 */
export function selectRehydrationSubset(
  outputs: Record<string, unknown>,
  needed: ReadonlySet<string>,
): Record<string, unknown> | null {
  const wanted = Object.keys(outputs).filter((key) => needed.has(key));
  if (wanted.length === 0) return null;
  const subset: Record<string, unknown> = {};
  for (const key of wanted) {
    subset[key] = outputs[key];
    for (const sibling of siblingR2KeyFields(key)) {
      if (sibling in outputs) subset[sibling] = outputs[sibling];
    }
  }
  return subset;
}

export async function rehydrateOutputs(
  _block: string,
  outputs: Record<string, unknown>,
  runId: string,
): Promise<{ ok: boolean; outputs: Record<string, unknown> }> {
  let tmp: string | null = null;
  // First, rehydrate TOP-LEVEL local files from their sibling R2 key
  // (narrationLocalPath←narrationKey, videoLocalPath←videoKey, loopUnitUrl←loopUnitKey).
  for (const [k, val] of Object.entries(outputs)) {
    if (typeof val === "string" && isLocalPath(val) && !existsSync(val)) {
      const base = k.replace(/(LocalPath|Url|Path)$/, "");
      const r2 = outputs[`${base}Key`];
      if (looksLikeR2Key(r2)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const ext = val.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
          const dest = join(tmp, `resume_${k}${ext}`);
          await writeBytes(dest, await getObjectBytes(r2));
          outputs[k] = dest;
        } catch (error) {
          if (isMissingStoredObject(error)) return { ok: false, outputs };
          throw error;
        }
      }
    }
  }
  // Arrays of local clip paths restored from a sibling array of R2 keys
  // (footageClips←footageKeys, entityClips←entityKeys). This is what lets the
  // render run on a SEPARATE worker from the one that downloaded the footage
  // (the P1→P2 render-split), and also makes these blocks resume-restorable
  // instead of forcing a re-download.
  for (const [k, val] of Object.entries(outputs)) {
    if (
      Array.isArray(val) &&
      val.some((p) => isLocalPath(p) && !existsSync(p as string))
    ) {
      const keys = outputs[`${k.replace(/Clips$/, "")}Keys`]; // footageClips→footageKeys
      if (Array.isArray(keys) && keys.length === val.length && keys.every(looksLikeR2Key)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const restored: string[] = [];
          for (let i = 0; i < keys.length; i++) {
            const ext = (typeof val[i] === "string" ? (val[i] as string).match(/\.[a-z0-9]+$/i)?.[0] : "") ?? "";
            const dest = join(tmp, `resume_${k}_${i}${ext}`);
            await writeBytes(dest, await getObjectBytes(keys[i] as string));
            restored.push(dest);
          }
          outputs[k] = restored;
        } catch (error) {
          if (isMissingStoredObject(error)) return { ok: false, outputs };
          throw error;
        }
      }
    }
  }
  // Nested overlay specs ({path, key, ...} inside arrays — quoteOverlays,
  // insertOverlays, extraOverlays): restore each item's missing local `path`
  // from its OWN sibling `key`. This is the render-split contract for overlay
  // producers; before it existed, one stale nested path forced a full re-run
  // of the producing block (and on the render child, dropped every overlay).
  for (const val of Object.values(outputs)) {
    if (!Array.isArray(val)) continue;
    for (let i = 0; i < val.length; i++) {
      const item = val[i] as { path?: unknown; key?: unknown } | null;
      if (!item || typeof item !== "object") continue;
      if (isLocalPath(item.path) && !existsSync(item.path) && looksLikeR2Key(item.key)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const ext = item.path.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
          const dest = join(tmp, `resume_ovl_${String(item.key).replace(/[^a-z0-9]/gi, "_").slice(-32)}${ext}`);
          await writeBytes(dest, await getObjectBytes(item.key));
          (item as { path: string }).path = dest;
        } catch (error) {
          if (isMissingStoredObject(error)) return { ok: false, outputs };
          throw error;
        }
      }
    }
  }
  // Then: if ANY value (including nested in arrays/objects, e.g. quoteOverlays
  // [{path}], footageClips[]) still points at a missing local file, we cannot
  // restore it → re-run the block (correctness over a skipped re-run).
  if (Object.values(outputs).some(hasMissingLocalPath)) {
    return { ok: false, outputs };
  }
  return { ok: true, outputs };
}
