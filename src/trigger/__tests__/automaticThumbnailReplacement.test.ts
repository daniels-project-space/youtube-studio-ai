import assert from "node:assert/strict";

import type { Id } from "../../../convex/_generated/dataModel";
import {
  dispatchAutomaticThumbnailReplacements,
  type AutomaticThumbnailReplacementCandidate,
} from "../automaticThumbnailReplacementCore";

async function main() {
  const priorSecret = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "automatic-thumbnail-test-key";
  try {
    const candidates: AutomaticThumbnailReplacementCandidate[] = [
      {
        sourceRunId: "source-a" as Id<"runs">,
        candidateRunId: "candidate-a" as Id<"runs">,
        youtubeVideoId: "video-a",
      },
      {
        sourceRunId: "source-b" as Id<"runs">,
        candidateRunId: "candidate-b" as Id<"runs">,
        youtubeVideoId: "video-b",
      },
    ];
    const observed: string[] = [];
    const convex = {
      query: async () => candidates,
      mutation: async () => null,
    };
    const result = await dispatchAutomaticThumbnailReplacements({
      ownerId: "owner-test",
      convex,
      queue: async ({ ownerId, candidate }) => {
        observed.push(`${ownerId}:${candidate.candidateRunId}`);
        if (candidate.youtubeVideoId === "video-b") throw new Error("provider temporarily unavailable");
        return "queued";
      },
    });
    assert.deepEqual(result, { due: 2, queued: 1, failed: 1 });
    assert.deepEqual(observed, ["owner-test:candidate-a", "owner-test:candidate-b"]);
  } finally {
    if (priorSecret === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorSecret;
  }
}

void main();
