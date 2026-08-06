import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildConvexAuthProbeEvidence,
  CONVEX_AUTH_PROBE_LIMIT,
} from "@/lib/convexAuthProbe";

// The live query returns a wider row. These values prove the redactor cannot
// accidentally pass additional production fields through.
const wideRun = {
  status: "ok",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
  _id: "secret-run-id",
  channelName: "secret-channel-name",
  error: "secret-provider-error",
  costTotal: 123.45,
  youtubeVideoId: "secret-video-id",
};
const evidence = buildConvexAuthProbeEvidence([wideRun], 1_700_000_002_000);

assert.deepEqual(evidence, {
  ok: true,
  authenticatedAs: "studio-service-jwt",
  query: "runs:listRecent",
  limit: CONVEX_AUTH_PROBE_LIMIT,
  observedRows: 1,
  checkedAt: 1_700_000_002_000,
  recentRun: {
    status: "ok",
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_001_000,
  },
});
const serialized = JSON.stringify(evidence);
for (const secret of [
  "secret-run-id",
  "secret-channel-name",
  "secret-provider-error",
  "secret-video-id",
  "123.45",
]) {
  assert.equal(serialized.includes(secret), false, `probe evidence leaked ${secret}`);
}

assert.deepEqual(buildConvexAuthProbeEvidence([], 42), {
  ok: true,
  authenticatedAs: "studio-service-jwt",
  query: "runs:listRecent",
  limit: 1,
  observedRows: 0,
  checkedAt: 42,
  recentRun: null,
});

assert.equal(
  buildConvexAuthProbeEvidence([{ status: "surprise", startedAt: Infinity }], 43)
    .recentRun?.status,
  "unknown",
);
assert.throws(
  () => buildConvexAuthProbeEvidence([{}, {}]),
  /bounded query returned more than one row/,
);

const taskSource = readFileSync(
  join(process.cwd(), "src", "trigger", "convexAuthProbe.ts"),
  "utf8",
);
assert.match(taskSource, /new StudioConvexHttpClient\(convexUrl\(\)\)/);
assert.match(taskSource, /convex\.query\(api\.runs\.listRecent/);
assert.equal(
  [...taskSource.matchAll(/\.query\(/g)].length,
  1,
  "production probe must execute exactly one Convex query",
);
assert.match(taskSource, /limit: CONVEX_AUTH_PROBE_LIMIT/);
assert.match(taskSource, /machine: "micro"/);
assert.match(taskSource, /retry: \{ maxAttempts: 1 \}/);
assert.doesNotMatch(taskSource, /\.mutation\(/);
assert.doesNotMatch(taskSource, /\bfetch\(|\bimport\(|tasks\./);
assert.doesNotMatch(
  taskSource,
  /bootstrapSecrets|gemini|groq|fal|novita|elevenlabs|publishDispatcher/i,
);

console.log("CONVEX AUTH PROBE PASS: bounded, redacted, query-only Trigger task");
