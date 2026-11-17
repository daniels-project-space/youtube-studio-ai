/** Deployment-time boundary for the dedicated self-hosted Automation worker. */
export function localAutomationWorkerConfig(env: Record<string, string | undefined>): null | {
  project: string;
  convexUrl: string;
} {
  if (env.YOUTUBE_AUTOMATION_TRIGGER_LOCAL !== "1") {
    if (env.TRIGGER_API_URL && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(env.TRIGGER_API_URL)) {
      throw new Error("Loopback Trigger deployments require explicit local Automation mode");
    }
    return null;
  }
  const project = env.TRIGGER_PROJECT_REF?.trim();
  if (!project || !/^proj_[a-zA-Z0-9_-]+$/.test(project)) throw new Error("Local Automation requires an explicit Trigger project reference");
  let api: URL, convex: URL;
  try {
    api = new URL(env.TRIGGER_API_URL ?? "");
    convex = new URL(env.YTA_WORKER_CONVEX_URL ?? "");
  } catch {
    throw new Error("Local Automation requires explicit local Trigger and worker database URLs");
  }
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname) || api.username || api.password ||
      api.pathname !== "/" || api.search || api.hash) throw new Error("Local Trigger API must be an uncredentialed loopback origin");
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(convex.hostname);
  const octets = match?.slice(1).map(Number);
  const privateIp = !!octets && octets.every(part => part <= 255) &&
    (octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
     (octets[0] === 192 && octets[1] === 168));
  if (convex.protocol !== "http:" || !privateIp || convex.username || convex.password || convex.pathname !== "/" || convex.search || convex.hash) {
    throw new Error("Local worker database must be an uncredentialed private IPv4 origin");
  }
  if (!env.STUDIO_CONVEX_JWT_PRIVATE_KEY || !env.STUDIO_CONVEX_ISSUER || !env.STUDIO_CONVEX_AUDIENCE || !env.STUDIO_OWNER_ID) {
    throw new Error("Local worker requires its explicit database signing identity");
  }
  let issuer: URL;
  try { issuer = new URL(env.STUDIO_CONVEX_ISSUER); }
  catch { throw new Error("Local worker signing issuer must be a loopback origin"); }
  if (issuer.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(issuer.hostname) ||
      issuer.username || issuer.password || issuer.pathname !== "/" || issuer.search || issuer.hash) {
    throw new Error("Local worker signing issuer must be a loopback origin");
  }
  return { project, convexUrl: convex.origin };
}
