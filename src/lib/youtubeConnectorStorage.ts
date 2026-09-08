/**
 * Stable, non-secret connector-storage contract shared by Convex and workers.
 * Keep this module runtime-neutral: Convex imports it when deciding whether a
 * failed thumbnail handoff became recoverable after an at-rest migration.
 */
export const LEGACY_YOUTUBE_CONNECTOR_STORAGE_ERROR =
  "YouTube connector uses legacy plaintext storage; reconnect or run the encrypted-token migration";

export function isLegacyYoutubeConnectorStorageError(value: unknown): boolean {
  return value === LEGACY_YOUTUBE_CONNECTOR_STORAGE_ERROR;
}
