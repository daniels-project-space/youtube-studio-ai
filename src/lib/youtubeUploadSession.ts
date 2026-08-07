/** Bind an encrypted resumable-session capability to one app account target. */
export function youtubeUploadSessionAad(
  ownerId: string,
  channelId: string,
  uploadKey: string,
): string {
  return `youtube-upload-session:${ownerId}:${channelId}:${uploadKey}`;
}
