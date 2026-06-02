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

export async function rehydrateOutputs(
  _block: string,
  outputs: Record<string, unknown>,
  runId: string,
): Promise<{ ok: boolean; outputs: Record<string, unknown> }> {
  let tmp: string | null = null;
  for (const [k, val] of Object.entries(outputs)) {
    // Arrays of local paths can't be rehydrated (no per-item R2 key) → re-run.
    if (Array.isArray(val)) {
      if (val.some((x) => isLocalPath(x) && !existsSync(x))) return { ok: false, outputs };
      continue;
    }
    if (isLocalPath(val) && !existsSync(val)) {
      const base = k.replace(/(LocalPath|Url|Path)$/, "");
      const r2 = outputs[`${base}Key`];
      if (!looksLikeR2Key(r2)) return { ok: false, outputs };
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
  return { ok: true, outputs };
}
