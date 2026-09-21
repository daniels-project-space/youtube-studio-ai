import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { YuE2AssemblySourceSchema } from "@/engine/yue2AssemblySource";

/** Source adoption only. Independent publishing policy remains mandatory. */
export async function verifyCurrentYuE2ReleaseSource(
  convex: Pick<ConvexHttpClient, "query">,
  scope: { ownerId: string; channelId: string; runId: string },
  source: unknown,
) {
  const endpoint = (api as unknown as { yue2Continuations: { verifyReleaseSource: never } }).yue2Continuations.verifyReleaseSource;
  const result = await convex.query(endpoint, {
    ownerId: scope.ownerId, channelId: scope.channelId, runId: scope.runId,
    ...(source === undefined ? {} : { source }),
  } as never);
  return result === null ? null : YuE2AssemblySourceSchema.parse(result);
}
