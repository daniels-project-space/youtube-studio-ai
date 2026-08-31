import { api } from "../../convex/_generated/api";
import {
  assertMusicVideoA2VidRuntimeAdmission,
  type MusicVideoA2VidRuntimeAdmission,
} from "@/engine/selfHostedLtxMusicVideoA2Vid";

/**
 * Narrow no-codegen bridge for the owner-scoped A2Vid capability registry.
 * The caller receives sealed runtime/benchmark evidence only; it is never a
 * browser-controlled GPU selection or a render-dispatch grant.
 */
const musicVideoA2VidStateApi = (api as unknown as {
  readonly musicVideoA2VidState: {
    readonly listActiveMusicVideoA2VidRuntimeAdmissions: never;
  };
}).musicVideoA2VidState;

type QueryClient = {
  query(reference: never, args: never): Promise<unknown>;
};

export async function listActiveMusicVideoA2VidRuntimeAdmissions(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly MusicVideoA2VidRuntimeAdmission[]> {
  const admissions = await input.client.query(
    musicVideoA2VidStateApi.listActiveMusicVideoA2VidRuntimeAdmissions,
    { ownerId: input.ownerId } as never,
  );
  if (!Array.isArray(admissions)) {
    throw new Error("music-video A2Vid runtime registry returned an invalid admission collection");
  }
  return Object.freeze(admissions.map(assertMusicVideoA2VidRuntimeAdmission));
}
