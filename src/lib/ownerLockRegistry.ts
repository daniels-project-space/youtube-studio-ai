/**
 * OWNER LOCK REGISTRY — what is lockable, and which patterns a lock protects.
 *
 * Deliberately free of `node:fs`, unlike `moduleLocks.ts`, so the browser can
 * import it. The lock badge needs to know whether a module is lockable and how
 * a channel name maps to a lock id; making it re-derive either of those would
 * let the UI and the guard disagree about what is locked, which is the one
 * failure a lock cannot afford.
 */

export interface LockableEntity {
  id: string;
  label: string;
  kind: "module" | "channel";
  description: string;
  /**
   * Patterns this lock protects.
   *
   * The guard treats every line as a substring to match against an edited file
   * path and against any shell command that writes. They are repo-relative
   * paths for modules; for channels they are the channel's own identifying
   * strings, because a channel is not a file.
   */
  paths: readonly string[];
}

/**
 * Modules that can be locked.
 *
 * A module is a coherent unit of behaviour, not a single file: locking the
 * thumbnail module has to cover every file that can change how a thumbnail is
 * produced, or the lock is theatre — a worker forbidden from editing the
 * renderer would simply edit the gate that admits its output.
 *
 * `id` matches the `key` of the corresponding entry in GOLDEN_MODULES, so the
 * catalog page can show a lock without a second mapping table to drift.
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

export const LOCKABLE_MODULE_IDS: ReadonlySet<string> = new Set(
  LOCKABLE_MODULES.map((entity) => entity.id),
);

export function channelSlug(channelName: string): string {
  return channelName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The lock id for a channel. Shared by the UI and the API so they cannot drift. */
export function channelLockId(channelName: string): string {
  return `channel-${channelSlug(channelName)}`;
}

/**
 * A channel lock, and an honest note about its reach.
 *
 * A channel is not a file, so a channel lock cannot protect a path list the way
 * a module lock does. What it CAN do is refuse shell commands that write while
 * naming the channel — a script, a seed file, a redirect into a channel fixture.
 * Channel state that lives in Convex is reached by mutations the pre-edit guard
 * never sees, so a channel lock is not a complete seal on its own; it is a hard
 * stop on the file-level routes plus a visible owner declaration.
 *
 * Short names are excluded from matching on purpose. A two- or three-letter
 * pattern appears inside unrelated words and would refuse half the shell
 * commands in the repository, which trains the operator to work around the
 * guard — the worst outcome for a lock.
 */
export function channelLockEntity(channelName: string): LockableEntity {
  const slug = channelSlug(channelName);
  const trimmed = channelName.trim();
  const patterns = new Set<string>();
  if (trimmed.length >= 4) patterns.add(trimmed);
  if (slug.length >= 4) {
    patterns.add(slug);
    patterns.add(`channels/${slug}`);
  }
  return {
    id: channelLockId(channelName),
    label: trimmed,
    kind: "channel",
    description: "Channel identity, playbook and settings.",
    paths: [...patterns],
  };
}
