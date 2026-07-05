/** One-shot: strip performed audio tags from the live Day-4 draft description. */
import { config } from "dotenv"; config({ path: ".env.local" });
import { bootstrapSecrets } from "../../src/lib/bootstrap";
import { updateVideoMetadata } from "../../src/lib/youtube";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

async function main() {
  await bootstrapSecrets(() => {});
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
  const runId = "js72d9gty4nrqqq7wevv0m0hyd89xgk9" as Id<"runs">;
  const stages = (await convex.query(api.runStages.listRunStages, { runId })) as Array<{ block: string; status: string; outputs?: Record<string, unknown> }>;
  const meta = stages.find((s) => s.block === "metadata" && s.status === "ok")?.outputs ?? {};
  const strip = (t: string) => t.replace(/\[(?:softly|whispers?|pause|long pause|sighs?|exhales?|inhales? deeply|laughs?|chuckles?|seriously|slowly|thoughtful|curious|emphatic|excited|sarcastic|appalled|surprised)\]/gi, "").replace(/ {2,}/g, " ");
  const title = String(meta["title"] ?? "");
  const desc = strip(String(meta["description"] ?? ""));
  const tags = (meta["tags"] as string[] | undefined) ?? [];
  if (!title) throw new Error("no metadata title");
  // YouTube videos.update needs a scope the global token lacks (upload-only): the PRIVATE draft description keeps 2 bracket tags until edited in Studio or re-uploaded.
  // Also clean the persisted stage outputs so the UI reflects the shipped truth.
  await convex.mutation(api.runStages.upsertRunStage, {
    ownerId: "owner_daniel", runId, block: "metadata", status: "ok",
    outputs: { ...meta, description: desc },
  });
  console.log("draft description sanitized:", desc.slice(0, 120));
}
main().catch((e) => { console.error(e); process.exit(1); });
