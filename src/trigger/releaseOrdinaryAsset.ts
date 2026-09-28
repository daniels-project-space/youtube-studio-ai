import { task } from "@trigger.dev/sdk";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { createVerifiedReleasedOrdinaryCopy } from "@/lib/releasedOrdinaryCopy";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

/** Manual service entry point; intentionally has no schedule or bulk scanner. */
export const releaseOrdinaryAssetTask = task({
  id: "release-ordinary-asset-copy",
  machine: "medium-1x",
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (payload: { ownerId: string; assetId: Id<"assets"> }) => {
    const ownerId = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
    if (payload.ownerId !== ownerId) throw new Error("ordinary release owner mismatch");
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "youtube"],
      required: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "STUDIO_CONVEX_JWT_PRIVATE_KEY"],
    });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("ordinary release Convex URL is missing");
    const copyKey = await createVerifiedReleasedOrdinaryCopy({ ownerId, assetId: payload.assetId,
      convex: new StudioConvexHttpClient(url) });
    return { copied: Boolean(copyKey), copyKey };
  },
});
