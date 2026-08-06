import { task } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import {
  buildConvexAuthProbeEvidence,
  CONVEX_AUTH_PROBE_LIMIT,
} from "@/lib/convexAuthProbe";
import { studioOwnerId } from "@/lib/studioConvexAuth";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

function convexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("convex-auth-probe: NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return url;
}

/**
 * Production rollout probe for the Trigger -> authenticated Convex boundary.
 * It deliberately performs one bounded query, no mutations, and no calls to
 * model, media, storage, YouTube, vault, or publishing providers.
 */
export const convexAuthProbeTask = task({
  id: "convex-auth-probe",
  machine: "micro",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => {
    const convex = new StudioConvexHttpClient(convexUrl());
    const rows = await convex.query(api.runs.listRecent, {
      ownerId: studioOwnerId(),
      limit: CONVEX_AUTH_PROBE_LIMIT,
    });
    return buildConvexAuthProbeEvidence(rows);
  },
});
