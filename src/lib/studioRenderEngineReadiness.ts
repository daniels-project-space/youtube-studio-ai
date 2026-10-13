import { z } from "zod";

const IntegrationSchema = z.object({
  profiles: z.array(z.object({
    profileId: z.string(),
    sources: z.array(z.object({
      provider: z.string(),
      dispatchable: z.boolean(),
      executorReady: z.boolean(),
      state: z.string().optional(),
      finalQualified: z.boolean().optional(),
      blockers: z.array(z.string()).optional(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

export function assessStudioEngineRouteReadiness(
  input: unknown,
  profileId: string,
  provider: string,
): { ready: boolean; reason?: string } {
  const integration = IntegrationSchema.parse(input);
  const profile = integration.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) return { ready: false, reason: `Render Engine profile ${profileId} is not registered` };
  const route = profile.sources.find((candidate) => candidate.provider === provider);
  if (!route) return { ready: false, reason: `Render Engine route ${profileId}/${provider} is not registered` };
  if (route.state !== "qualified" || route.finalQualified !== true || !route.dispatchable || !route.executorReady) {
    const blockers = route.blockers?.length ? `: ${route.blockers.join(", ")}` : "";
    return { ready: false, reason: `Render Engine route ${profileId}/${provider} lacks provider-qualified dispatch proof${blockers}` };
  }
  return { ready: true };
}
