/**
 * OWNER LOCKS.
 *
 * A lock marks a module or a channel as owner-controlled: no AI worker —
 * Claude, Codex, or anything else driving the editing tools — may modify it
 * until the owner unlocks it from the UI.
 *
 * The enforcement deliberately does NOT live here. This module is the registry
 * and the state; the block happens in a Claude Code PreToolUse hook outside the
 * repository, because a guard that lives inside the thing it guards can be
 * edited by the same worker it is meant to stop. This file only decides WHAT is
 * lockable and writes the marker files the hook reads.
 *
 * The marker format follows the existing `pipeline-lock-guard` convention
 * already running on this machine — one file per locked entity — and extends it
 * by writing the protected path patterns INTO the marker, so the hook needs no
 * TypeScript to resolve a module to its files.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCK_DIR = join(process.cwd(), ".locks");

export interface LockableEntity {
  id: string;
  label: string;
  kind: "module" | "channel";
  description: string;
  /** Absolute-from-repo-root path patterns this lock protects. */
  paths: readonly string[];
}

/**
 * Modules that can be locked.
 *
 * A module is a coherent unit of behaviour, not a single file: locking the
 * thumbnail module has to cover every file that can change how a thumbnail is
 * produced, or the lock is theatre — a worker forbidden from editing the
 * renderer would simply edit the gate that admits its output.
 */
export const LOCKABLE_MODULES: readonly LockableEntity[] = [
  {
    id: "thumbnail",
    label: "Thumbnail module",
    kind: "module",
    description:
      "Art direction, story-interest gating, capability routing, the quality gates and the learning loops.",
    paths: [
      "src/lib/thumbnailLab.ts",
      "src/lib/banana.ts",
      "src/lib/thumbnailStoryInterest.ts",
      "src/lib/thumbnailStoryJudge.ts",
      "src/lib/thumbnailCapabilities.ts",
      "src/lib/thumbnailChannelIdentity.ts",
      "src/lib/thumbnailGoldenStandard.ts",
      "src/lib/thumbnailMobileGate.ts",
      "src/lib/thumbnailPaletteGuard.ts",
      "src/lib/thumbnailPanelDetector.ts",
      "src/lib/thumbnailSameness.ts",
      "src/lib/thumbnailDefectLedger.ts",
      "src/lib/thumbnailCtrFeedback.ts",
      "src/lib/thumbnailLearningStore.ts",
      "src/lib/thumbnailDefaults.ts",
      "src/lib/thumbnailRenderTier.ts",
      "src/lib/thumbnailOcr.ts",
      "src/lib/thumbnailRenderer.ts",
      "src/lib/thumbnailLayout.ts",
      "src/lib/thumbnailSafeZone.ts",
      "src/lib/falNanoBananaProThumbnail.ts",
      "src/lib/falNanoBananaProThumbnailContract.ts",
      "src/lib/nanoBananaThumbnailContract.ts",
    ],
  },
  {
    id: "publishing",
    label: "Publishing + YouTube",
    kind: "module",
    description: "Upload, scheduling, thumbnail replacement and anything that reaches the live channel.",
    paths: [
      "src/lib/youtube.ts",
      "src/lib/youtubeThumbnailReplacement.ts",
      "src/lib/youtubeThumbnailReplacementRuntime.ts",
      "src/lib/youtubeAnalytics.ts",
    ],
  },
  {
    id: "vault",
    label: "Credentials + vault",
    kind: "module",
    description: "Secret hydration and provider credential handling.",
    paths: ["src/lib/vault.ts", "src/lib/storage.ts"],
  },
];

export interface LockRecord {
  id: string;
  label: string;
  kind: "module" | "channel";
  lockedAt: string;
  lockedBy: string;
  paths: readonly string[];
}

function markerPath(id: string): string {
  // Never let an id escape the lock directory.
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  return join(LOCK_DIR, `${safe}.lock`);
}

/** Channels are lockable by name; their marker protects no file paths. */
export function channelLockEntity(channelName: string): LockableEntity {
  return {
    id: `channel-${channelName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: channelName,
    kind: "channel",
    description: "Channel identity, playbook and settings.",
    paths: [],
  };
}

export async function listLocks(): Promise<LockRecord[]> {
  try {
    const files = await readdir(LOCK_DIR);
    const records: LockRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".lock")) continue;
      try {
        const raw = await readFile(join(LOCK_DIR, file), "utf8");
        // The marker is human-readable on purpose: an operator looking at the
        // directory over SSH should be able to see what is locked and why
        // without running anything.
        const json = raw.slice(raw.indexOf("{"));
        records.push(JSON.parse(json) as LockRecord);
      } catch { /* a malformed marker still means locked; skip metadata */ }
    }
    return records;
  } catch {
    return [];
  }
}

export async function isLocked(id: string): Promise<boolean> {
  return (await listLocks()).some((record) => record.id === id);
}

export async function lockEntity(args: {
  entity: LockableEntity;
  lockedBy: string;
}): Promise<LockRecord> {
  await mkdir(LOCK_DIR, { recursive: true });
  const record: LockRecord = {
    id: args.entity.id,
    label: args.entity.label,
    kind: args.entity.kind,
    lockedAt: new Date().toISOString(),
    lockedBy: args.lockedBy,
    paths: args.entity.paths,
  };
  // Patterns are written FIRST, one per line, so the shell hook can read them
  // with grep alone and never has to parse JSON or load this module.
  const body =
    `${args.entity.paths.join("\n")}\n` +
    `# ${args.entity.label} locked by ${args.lockedBy} at ${record.lockedAt}\n` +
    `${JSON.stringify(record)}\n`;
  await writeFile(markerPath(args.entity.id), body, "utf8");
  return record;
}

export async function unlockEntity(id: string): Promise<boolean> {
  try {
    await rm(markerPath(id));
    return true;
  } catch {
    return false;
  }
}
