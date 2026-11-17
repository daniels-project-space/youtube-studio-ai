export class LocalPublicationDisabledError extends Error {}

/** Keep the personal VPS in private-review mode until publication is explicitly enabled. */
export function assertLocalPublicationAllowed(
  upload: { privacyStatus?: string; publishAt?: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.YOUTUBE_AUTOMATION_PRIVATE !== "1" || env.YOUTUBE_AUTOMATION_PUBLICATION_ENABLED === "1") return;
  if ((upload.privacyStatus !== undefined && upload.privacyStatus !== "private") || upload.publishAt !== undefined) {
    throw new LocalPublicationDisabledError("Public, unlisted, and scheduled YouTube uploads are disabled for private Automation; review the video first.");
  }
}

export function assertLocalCrosspostAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.YOUTUBE_AUTOMATION_PRIVATE === "1" && env.YOUTUBE_AUTOMATION_PUBLICATION_ENABLED !== "1") {
    throw new LocalPublicationDisabledError("Social cross-posting is disabled for private Automation; review the video first.");
  }
}
