export class PrivateTriggerTargetError extends Error {
  constructor() {
    super("Private Automation requires an explicit loopback Trigger API origin.");
    this.name = "PrivateTriggerTargetError";
  }
}

/**
 * Validate an explicit private Trigger origin. Callers must pass the returned
 * origin as SDK clientConfig.baseURL; this helper does not protect other routes.
 */
export function privateTriggerApiOrigin(env: Record<string, string | undefined>): string {
  let url: URL;
  try {
    url = new URL(env.TRIGGER_API_URL ?? "");
  } catch {
    throw new PrivateTriggerTargetError();
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new PrivateTriggerTargetError();
  }
  return url.origin;
}

/** Preserve default SDK resolution outside private mode; pin the origin in private mode. */
export function privateTriggerRequestOptions(env: Record<string, string | undefined>):
  { clientConfig: { baseURL: string } } | undefined {
  if (env.YOUTUBE_AUTOMATION_PRIVATE !== "1") return undefined;
  return { clientConfig: { baseURL: privateTriggerApiOrigin(env) } };
}

