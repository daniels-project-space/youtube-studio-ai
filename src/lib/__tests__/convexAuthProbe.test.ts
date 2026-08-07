import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildConvexAuthProbeEvidence,
  CONVEX_AUTH_PROBE_CONTRACT,
  evaluateConvexAuthProbeIdentity,
} from "@/lib/convexAuthProbe";

const ownerId = "secret-owner-id";
const authenticatedChallenge = "signed-challenge-00000001";
const unauthenticatedChallenge = "unsigned-challenge-00001";
const authenticated = evaluateConvexAuthProbeIdentity(
  {
    role: "service",
    owner_id: ownerId,
    subject: "service:youtube-studio-ai",
  },
  { expectedOwnerId: ownerId, challenge: authenticatedChallenge },
);
const unauthenticated = evaluateConvexAuthProbeIdentity(null, {
  expectedOwnerId: ownerId,
  challenge: unauthenticatedChallenge,
});

assert.deepEqual(authenticated, {
  contract: CONVEX_AUTH_PROBE_CONTRACT,
  challenge: authenticatedChallenge,
  access: "granted",
  reason: "service_identity_verified",
  identity: {
    role: "service",
    ownerMatchesExpected: true,
    subjectMatchesService: true,
  },
});
assert.deepEqual(unauthenticated, {
  contract: CONVEX_AUTH_PROBE_CONTRACT,
  challenge: unauthenticatedChallenge,
  access: "denied",
  reason: "authentication_required",
  identity: null,
});

const evidence = buildConvexAuthProbeEvidence({
  authenticated,
  unauthenticated,
  authenticatedChallenge,
  unauthenticatedChallenge,
  checkedAt: 1_700_000_002_000,
});
assert.deepEqual(evidence, {
  ok: true,
  contract: CONVEX_AUTH_PROBE_CONTRACT,
  query: "runs:verifyAuthBoundary",
  authenticatedAccess: "granted",
  unauthenticatedAccess: "denied",
  serverObservedIdentity: {
    role: "service",
    ownerMatchesConfigured: true,
    subjectMatchesService: true,
  },
  freshChallengeResponses: true,
  checkedAt: 1_700_000_002_000,
});

const serialized = JSON.stringify(evidence);
for (const secret of [ownerId, authenticatedChallenge, unauthenticatedChallenge]) {
  assert.equal(serialized.includes(secret), false, `probe evidence leaked ${secret}`);
}

for (const identity of [
  { role: "owner", owner_id: ownerId, subject: ownerId },
  { role: "service", owner_id: "wrong-owner", subject: "service:youtube-studio-ai" },
  { role: "service", owner_id: ownerId, subject: "wrong-service" },
]) {
  const result = evaluateConvexAuthProbeIdentity(identity, {
    expectedOwnerId: ownerId,
    challenge: authenticatedChallenge,
  });
  assert.equal(result.access, "denied");
  assert.equal(result.reason, "identity_scope_mismatch");
}

assert.throws(
  () =>
    buildConvexAuthProbeEvidence({
      authenticated: { ...authenticated, challenge: "stale-challenge-00000000" },
      unauthenticated,
      authenticatedChallenge,
      unauthenticatedChallenge,
    }),
  /stale or mismatched challenge response/,
);
assert.throws(
  () =>
    buildConvexAuthProbeEvidence({
      authenticated,
      unauthenticated: {
        ...unauthenticated,
        access: "granted",
        reason: "service_identity_verified",
      },
      authenticatedChallenge,
      unauthenticatedChallenge,
    }),
  /unauthenticated access was not denied/,
);
assert.throws(
  () =>
    evaluateConvexAuthProbeIdentity(null, {
      expectedOwnerId: ownerId,
      challenge: "short",
    }),
  /invalid challenge length/,
);

const taskSource = readFileSync(
  join(process.cwd(), "src", "trigger", "convexAuthProbe.ts"),
  "utf8",
);
const runsSource = readFileSync(
  join(process.cwd(), "convex", "runs.ts"),
  "utf8",
);
assert.match(taskSource, /new StudioConvexHttpClient\(url\)/);
assert.match(taskSource, /new ConvexHttpClient\(url\)/);
assert.match(taskSource, /process\.env\.STUDIO_OWNER_ID\?\.trim\(\)/);
assert.doesNotMatch(taskSource, /studioOwnerId\(\)/);
assert.equal(
  [...taskSource.matchAll(/\.query\(api\.runs\.verifyAuthBoundary/g)].length,
  2,
  "probe must test signed grant and unsigned denial on the same endpoint",
);
assert.doesNotMatch(taskSource, /api\.runs\.listRecent/);
assert.match(taskSource, /Promise\.all\(/);
assert.match(taskSource, /machine: "micro"/);
assert.match(taskSource, /retry: \{ maxAttempts: 1 \}/);
assert.doesNotMatch(taskSource, /\.mutation\(/);
assert.doesNotMatch(taskSource, /\bfetch\(|\bimport\(|tasks\./);
assert.doesNotMatch(
  taskSource,
  /bootstrapSecrets|gemini|groq|fal|novita|elevenlabs|publishDispatcher/i,
);
assert.match(runsSource, /verifyAuthBoundary = publicQuery/);
assert.match(
  runsSource,
  /evaluateConvexAuthProbeIdentity\(await ctx\.auth\.getUserIdentity\(\), args\)/,
);

console.log(
  "CONVEX AUTH PROBE PASS: fresh signed grant + unsigned denial, data-free and redacted",
);
