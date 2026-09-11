import { AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX } from "./studioActionApprovalContract";

/** The candidate UI may be session-free, but it may never be cross-site. */
export function isSameOriginThumbnailRefreshRequest(input: {
  requestUrl: string;
  requestOrigin: string | null;
}): boolean {
  if (!input.requestOrigin) return false;
  try {
    return new URL(input.requestOrigin).origin === new URL(input.requestUrl).origin;
  } catch {
    return false;
  }
}

export function thumbnailRefreshPolicyActor(ownerId: string): string {
  return `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${ownerId}`;
}
