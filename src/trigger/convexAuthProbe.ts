import { randomUUID } from "node:crypto";

import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { buildConvexAuthProbeEvidence } from "@/lib/convexAuthProbe";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

function convexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("convex-auth-probe: NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return url;
}

function configuredOwnerId(): string {
  const ownerId = process.env.STUDIO_OWNER_ID?.trim();
  if (!ownerId) {
    throw new Error("convex-auth-probe: STUDIO_OWNER_ID is not configured");
  }
  return ownerId;
}

/**
 * Production rollout probe for the Trigger -> authenticated Convex boundary.
 * It performs two data-free queries to the same versioned server contract: a
 * signed service call must be granted and an unsigned call must be denied. It
 * makes no mutations and calls no data, model, media, storage, YouTube, vault,
 * or publishing provider.
 */
export const convexAuthProbeTask = task({
  id: "convex-auth-probe",
  machine: "micro",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => {
    const url = convexUrl();
    const expectedOwnerId = configuredOwnerId();
    const authenticatedChallenge = randomUUID();
    const unauthenticatedChallenge = randomUUID();
    const authenticatedClient = new StudioConvexHttpClient(url);
    const unauthenticatedClient = new ConvexHttpClient(url);

    const [authenticated, unauthenticated] = await Promise.all([
      authenticatedClient.query(api.runs.verifyAuthBoundary, {
        expectedOwnerId,
        challenge: authenticatedChallenge,
      }),
      unauthenticatedClient.query(api.runs.verifyAuthBoundary, {
        expectedOwnerId,
        challenge: unauthenticatedChallenge,
      }),
    ]);

    return buildConvexAuthProbeEvidence({
      authenticated,
      unauthenticated,
      authenticatedChallenge,
      unauthenticatedChallenge,
    });
  },
});
