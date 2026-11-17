/** Hard boundary for the VPS workshop's Trigger project and database. */
export function localWorkshopWorkerConfig(env: Readonly<Record<string, string | undefined>>) {
  if (env.YOUTUBE_STUDIO_WORKSHOP_TRIGGER_LOCAL !== "1") {
    if (env.TRIGGER_API_URL && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(env.TRIGGER_API_URL))
      throw new Error("A loopback Trigger deployment requires explicit workshop mode");
    return null;
  }
  if (env.TRIGGER_PROJECT_REF !== "proj_dqyvctmalaifbqvylvfm" ||
      env.TRIGGER_API_URL !== "http://127.0.0.1:39400" ||
      env.YTS_WORKER_CONVEX_URL !== "http://172.30.240.1:39403" ||
      env.STUDIO_CONVEX_ISSUER !== "http://127.0.0.1:39440" ||
      env.STUDIO_CONVEX_AUDIENCE !== "youtube-studio-workshop-vps" ||
      env.R2_BUCKET !== "youtube-studio-ai-private" ||
      env.YTS_R2_BROKER_URL !== "http://172.30.240.1:39405/v1/credentials" ||
      !/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID ?? "") || !env.YTS_R2_BROKER_TOKEN ||
      !env.STUDIO_CONVEX_JWT_PRIVATE_KEY || !env.STUDIO_OWNER_ID) {
    throw new Error("Local workshop worker requires its own project, local database and signing identity");
  }
  return { project: env.TRIGGER_PROJECT_REF, convexUrl: env.YTS_WORKER_CONVEX_URL };
}
