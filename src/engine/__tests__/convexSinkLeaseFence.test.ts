import assert from "node:assert/strict";
import { makeConvexSink } from "@/engine/convexSink";

async function main() {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    mutation: async (_reference: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      return null;
    },
    query: async () => [],
  };
  const fence = { leaseOwner: "trigger-current", executionLeaseToken: 9 };
  const sink = makeConvexSink(client as never, "owner-test", fence);

  await sink.upsert({
    ownerId: "owner-test",
    runId: "runs:test",
    block: "qa_visual",
    status: "running",
  });
  assert.equal(calls[0]?.leaseOwner, fence.leaseOwner);
  assert.equal(calls[0]?.executionLeaseToken, fence.executionLeaseToken);

  const priorSecret = process.env.INTERNAL_QUERY_SECRET;
  process.env.INTERNAL_QUERY_SECRET = "test-internal-secret";
  try {
    await sink.upsertArtifacts?.({
      ownerId: "owner-test",
      channelId: "channels:test",
      runId: "runs:test",
      artifacts: [{
        artifact: {
          artifactId: "runs:test:qa_visual:artifact",
          key: "visualArtifactAttempt",
          type: "VisualArtifactAttempt",
          schemaVersion: "1.0.0",
          producerModule: "qa_visual",
          producerVersion: "1.0.0",
          payloadHash: "a".repeat(64),
        },
        inputArtifactIds: [],
        optionalFallbacks: [],
        persistence: "reference",
        payload: { version: 1 },
        createdAt: Date.now(),
      }],
    });
  } finally {
    if (priorSecret === undefined) delete process.env.INTERNAL_QUERY_SECRET;
    else process.env.INTERNAL_QUERY_SECRET = priorSecret;
  }
  assert.equal(calls[1]?.leaseOwner, fence.leaseOwner);
  assert.equal(calls[1]?.executionLeaseToken, fence.executionLeaseToken);

  const legacySink = makeConvexSink(client as never, "owner-test");
  await assert.rejects(
    legacySink.upsert({
      ownerId: "owner-test",
      runId: "runs:test",
      block: "qa_visual",
      status: "running",
    }),
    /execution lease fence/,
  );

  console.log("CONVEX SINK LEASE FENCE TESTS PASS");
}

void main();
