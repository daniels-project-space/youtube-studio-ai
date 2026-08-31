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
import type { ResumeRehydrationRequest } from "@/engine/types";
import { getObjectToFile, headObjectMetadata } from "@/lib/storage";
import { makeRunTempDir } from "@/lib/files";

export interface RehydrationStorage {
  getObjectToFile(key: string, filePath: string): Promise<string>;
  headObjectMetadata(key: string): Promise<{
    contentLength?: number;
    contentType?: string;
    etag?: string;
    metadata: Record<string, string>;
  } | null>;
}

const defaultRehydrationStorage: RehydrationStorage = {
  getObjectToFile,
  headObjectMetadata,
};

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

/**
 * Check skipped media without re-downloading it. Full rehydration previously
 * proved this only by GETting every object; a HEAD preserves the same missing
 * object fence while avoiding byte transfer for outputs no local consumer can
 * reach. We deliberately keep the scope narrow to the exact path conventions
 * `rehydrateOutputs` already understands—unknown nested path shapes still fail
 * closed exactly as they did before.
 */
async function verifySkippedDurableOutputs(
  outputs: Record<string, unknown>,
  needed: ReadonlySet<string>,
  storage: RehydrationStorage,
): Promise<boolean> {
  const checked = new Map<string, boolean>();
  const exists = async (key: string): Promise<boolean> => {
    const prior = checked.get(key);
    if (prior !== undefined) return prior;
    const present = (await storage.headObjectMetadata(key)) !== null;
    checked.set(key, present);
    return present;
  };

  for (const [key, value] of Object.entries(outputs)) {
    if (needed.has(key) || !hasMissingLocalPath(value)) continue;

    if (typeof value === "string") {
      const base = key.replace(/(LocalPath|Url|Path)$/, "");
      const r2 = outputs[`${base}Key`];
      if (!looksLikeR2Key(r2) || !(await exists(r2))) return false;
      continue;
    }

    if (!Array.isArray(value)) {
      // Existing rehydration has no durable restoration rule for this shape.
      return false;
    }

    const siblingKeys = outputs[`${key.replace(/Clips$/, "")}Keys`];
    const clipArray =
      Array.isArray(siblingKeys) &&
      siblingKeys.length === value.length &&
      siblingKeys.every(looksLikeR2Key);
    if (clipArray) {
      for (let i = 0; i < value.length; i++) {
        const path = value[i];
        if (isLocalPath(path) && !existsSync(path) && !(await exists(siblingKeys[i] as string))) {
          return false;
        }
      }
      // A clip array is otherwise plain paths. Any nested missing path would
      // have failed full rehydration, so keep that conservative behavior.
      if (value.some((item) => typeof item !== "string" && hasMissingLocalPath(item))) return false;
      continue;
    }

    for (const item of value) {
      if (typeof item === "string") {
        if (isLocalPath(item) && !existsSync(item)) return false;
        continue;
      }
      if (!item || typeof item !== "object" || !hasMissingLocalPath(item)) continue;
      const overlay = item as { path?: unknown; key?: unknown };
      if (!isLocalPath(overlay.path) || existsSync(overlay.path) || !looksLikeR2Key(overlay.key)) {
        return false;
      }
      if (!(await exists(overlay.key))) return false;
    }
  }
  return true;
}

export async function rehydrateOutputs(
  _block: string,
  outputs: Record<string, unknown>,
  runId: string,
  request?: ResumeRehydrationRequest,
): Promise<{ ok: boolean; outputs: Record<string, unknown> }> {
  return rehydrateOutputsWithStorage(
    _block,
    outputs,
    runId,
    request,
    defaultRehydrationStorage,
  );
}

/** Visible for the hermetic recovery contract; production uses `rehydrateOutputs`. */
export async function rehydrateOutputsWithStorage(
  _block: string,
  outputs: Record<string, unknown>,
  runId: string,
  request: ResumeRehydrationRequest | undefined,
  storage: RehydrationStorage,
): Promise<{ ok: boolean; outputs: Record<string, unknown> }> {
  const needed = request?.neededOutputKeys;
  if (needed && !(await verifySkippedDurableOutputs(outputs, needed, storage))) {
    return { ok: false, outputs };
  }
  // Preserve the complete raw patch for lineage and downstream contract reads.
  // The subset controls only bytes transferred to this worker.
  const working = needed ? selectRehydrationSubset(outputs, needed) ?? {} : outputs;
  let tmp: string | null = null;
  // First, rehydrate TOP-LEVEL local files from their sibling R2 key
  // (narrationLocalPath←narrationKey, videoLocalPath←videoKey, loopUnitUrl←loopUnitKey).
  for (const [k, val] of Object.entries(working)) {
    if (typeof val === "string" && isLocalPath(val) && !existsSync(val)) {
      const base = k.replace(/(LocalPath|Url|Path)$/, "");
      const r2 = working[`${base}Key`];
      if (looksLikeR2Key(r2)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const ext = val.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
          const dest = join(tmp, `resume_${k}${ext}`);
          await storage.getObjectToFile(r2, dest);
          working[k] = dest;
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
  for (const [k, val] of Object.entries(working)) {
    if (
      Array.isArray(val) &&
      val.some((p) => isLocalPath(p) && !existsSync(p as string))
    ) {
      const keys = working[`${k.replace(/Clips$/, "")}Keys`]; // footageClips→footageKeys
      if (Array.isArray(keys) && keys.length === val.length && keys.every(looksLikeR2Key)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const restored: string[] = [];
          for (let i = 0; i < keys.length; i++) {
            const ext = (typeof val[i] === "string" ? (val[i] as string).match(/\.[a-z0-9]+$/i)?.[0] : "") ?? "";
            const dest = join(tmp, `resume_${k}_${i}${ext}`);
            await storage.getObjectToFile(keys[i] as string, dest);
            restored.push(dest);
          }
          working[k] = restored;
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
  for (const val of Object.values(working)) {
    if (!Array.isArray(val)) continue;
    for (let i = 0; i < val.length; i++) {
      const item = val[i] as { path?: unknown; key?: unknown } | null;
      if (!item || typeof item !== "object") continue;
      if (isLocalPath(item.path) && !existsSync(item.path) && looksLikeR2Key(item.key)) {
        try {
          if (!tmp) tmp = await makeRunTempDir(runId);
          const ext = item.path.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
          const dest = join(tmp, `resume_ovl_${String(item.key).replace(/[^a-z0-9]/gi, "_").slice(-32)}${ext}`);
          await storage.getObjectToFile(item.key, dest);
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
  if (Object.values(working).some(hasMissingLocalPath)) {
    return { ok: false, outputs };
  }
  if (working !== outputs) Object.assign(outputs, working);
  return { ok: true, outputs };
}
