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
import { getObjectBytes } from "@/lib/storage";
import { makeRunTempDir, writeBytes } from "@/lib/files";

function isLocalPath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    !/^https?:\/\//i.test(v) &&
    /[/\\]/.test(v)
  );
}

function looksLikeR2Key(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !/^https?:\/\//i.test(v) && !/^[/\\]/.test(v) && !/^[a-zA-Z]:\\/.test(v);
}

/** Recursively: does this value contain a local-path string that's missing? */
function hasMissingLocalPath(val: unknown): boolean {
  if (typeof val === "string") return isLocalPath(val) && !existsSync(val);
  if (Array.isArray(val)) return val.some(hasMissingLocalPath);
  if (val && typeof val === "object") return Object.values(val).some(hasMissingLocalPath);
  return false;
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
        } catch {
          return { ok: false, outputs };
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
        } catch {
          return { ok: false, outputs };
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
