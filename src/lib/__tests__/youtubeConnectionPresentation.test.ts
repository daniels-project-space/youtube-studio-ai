import assert from "node:assert/strict";

import {
  youtubeConnectionLabel,
  youtubeConnectorPublishingReady,
  youtubeLastVerifiedLabel,
} from "@/lib/youtubeConnectionPresentation";

const healthy = { status: "active", scopeHealth: "healthy", validatedAt: 1_700_000_000_000 } as const;
const partial = { status: "active", scopeHealth: "partial", validatedAt: null } as const;
const unknown = { status: "active", scopeHealth: "unknown", validatedAt: null } as const;
const revoked = { status: "revoked", scopeHealth: "healthy", validatedAt: 1_700_000_000_000 } as const;

assert.equal(youtubeConnectionLabel(undefined, true), "Checking");
assert.equal(youtubeConnectionLabel(undefined, false), "Not linked");
assert.equal(youtubeConnectionLabel(healthy, false), "Healthy");
assert.equal(youtubeConnectionLabel(partial, false), "Partial scopes");
assert.equal(youtubeConnectionLabel(unknown, false), "Scopes unverified");
assert.equal(youtubeConnectionLabel(revoked, false), "Reconnect");

assert.equal(youtubeConnectorPublishingReady(healthy), true);
for (const connector of [partial, unknown, revoked, undefined]) {
  assert.equal(youtubeConnectorPublishingReady(connector), false);
}

const formatDate = (timestamp: number) => `verified:${timestamp}`;
assert.equal(youtubeLastVerifiedLabel(healthy, formatDate), "verified:1700000000000");
assert.equal(youtubeLastVerifiedLabel(unknown, formatDate), "Not yet verified");
assert.equal(youtubeLastVerifiedLabel(undefined, formatDate), "Not yet verified");
assert.equal(
  youtubeLastVerifiedLabel({ ...unknown, validatedAt: Number.NaN }, formatDate),
  "Not yet verified",
);

console.log("YOUTUBE CONNECTION PRESENTATION PASS — unknown scopes fail closed and verification uses validatedAt");
