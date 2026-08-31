import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReviewedEvidencePackEditorialAuthorityReference } from "@/lib/reviewedEvidencePackAuthorityReference";

const persistenceSource = readFileSync(
  new URL("../../../convex/reviewedEvidencePacks.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../convex/schema.ts", import.meta.url),
  "utf8",
);
const coreSource = readFileSync(new URL("../reviewedEvidencePack.ts", import.meta.url), "utf8");
const blockRegistrySource = readFileSync(new URL("../blocks.ts", import.meta.url), "utf8");
const executableRegistrySource = readFileSync(new URL("../registry.ts", import.meta.url), "utf8");

// Every surface is service-only and owner-scoped. There is intentionally no
// browser-facing mutation, update, delete, channel, or run API in this phase.
assert.match(
  persistenceSource,
  /requireStudioServiceIdentity\(ctx, args\.ownerId, "reviewed evidence pack persistence"\)/,
);
assert.match(
  persistenceSource,
  /requireStudioServiceIdentity\(ctx, args\.ownerId, "reviewed evidence pack retrieval"\)/,
);
assert.match(persistenceSource, /packId: v\.id\("reviewedEvidencePacks"\)/);
assert.match(persistenceSource, /if \(!pack \|\| pack\.ownerId !== ownerId\) throw new Error\("reviewed evidence pack not found"\)/);
assert.doesNotMatch(persistenceSource, /export const (?:update|remove|delete|dispatch|createRun|publish)/);

const ownerId = "owner-a";
const packetFingerprint = "a".repeat(64);
assert.doesNotThrow(() =>
  assertReviewedEvidencePackEditorialAuthorityReference({
    authorityKind: "editorial_evidence_packet",
    authorityContentFingerprint: packetFingerprint,
    ownerId,
    editorialEvidencePacketId: "packet-a",
    storedEditorialEvidencePacket: { ownerId, contentFingerprint: packetFingerprint },
  }),
);
assert.throws(
  () =>
    assertReviewedEvidencePackEditorialAuthorityReference({
      authorityKind: "editorial_evidence_packet",
      authorityContentFingerprint: packetFingerprint,
      ownerId,
    }),
  /requires a stored editorial evidence packet reference/,
  "editorial authority cannot be admitted without a durable packet reference",
);
assert.throws(
  () =>
    assertReviewedEvidencePackEditorialAuthorityReference({
      authorityKind: "editorial_evidence_packet",
      authorityContentFingerprint: packetFingerprint,
      ownerId,
      editorialEvidencePacketId: "packet-b",
      storedEditorialEvidencePacket: { ownerId: "owner-b", contentFingerprint: packetFingerprint },
    }),
  /packet not found/,
  "a packet owned by another user must be indistinguishable from a missing packet",
);
assert.throws(
  () =>
    assertReviewedEvidencePackEditorialAuthorityReference({
      authorityKind: "editorial_evidence_packet",
      authorityContentFingerprint: packetFingerprint,
      ownerId,
      editorialEvidencePacketId: "packet-a",
      storedEditorialEvidencePacket: { ownerId, contentFingerprint: "b".repeat(64) },
    }),
  /fingerprint does not match stored packet/,
  "an altered or substituted stored packet cannot satisfy the approved authority fingerprint",
);
assert.throws(
  () =>
    assertReviewedEvidencePackEditorialAuthorityReference({
      authorityKind: "data_story_source_ledger",
      authorityContentFingerprint: packetFingerprint,
      ownerId,
      editorialEvidencePacketId: "packet-a",
    }),
  /data-story authority must not carry an editorial evidence packet reference/,
  "raw immutable data-story ledger authority remains separate from editorial packet persistence",
);

// Exact retries may return their immutable row; a reused review identity or
// content fingerprint may never rewrite it with different approval metadata.
assert.match(persistenceSource, /withIndex\("by_owner_review"/);
assert.match(persistenceSource, /withIndex\("by_owner_content"/);
assert.match(persistenceSource, /reviewId is already bound to different immutable evidence/);
assert.match(persistenceSource, /content is already bound to a different immutable approval/);
assert.match(persistenceSource, /existingReview\.reviewerId !== pack\.review\.reviewerId/);
assert.match(persistenceSource, /existingContent\.reviewedAt !== pack\.review\.reviewedAt/);

// The schema persists owner, exact review, route, capability, and authority
// identities, but keeps the table outside all execution-oriented tables.
assert.match(schemaSource, /reviewedEvidencePacks: defineTable\(\{/);
assert.match(schemaSource, /ownerId: v\.string\(\),\n    contentFingerprint: v\.string\(\),\n    routeSeedFingerprint: v\.string\(\)/);
assert.match(schemaSource, /\.index\("by_owner_review", \["ownerId", "reviewId"\]\)/);
assert.match(schemaSource, /\.index\("by_owner_content", \["ownerId", "contentFingerprint"\]\)/);
assert.match(schemaSource, /\.index\("by_owner_route_profile", \["ownerId", "routeSeedFingerprint", "showProfileFingerprint"\]\)/);
assert.match(schemaSource, /editorialEvidencePacketId: v\.optional\(v\.id\("editorialEvidencePackets"\)\)/);
assert.match(persistenceSource, /await ctx\.db\.get\(args\.editorialEvidencePacketId\)/);
assert.match(persistenceSource, /existingReview\.editorialEvidencePacketId !== editorialEvidencePacketId/);
assert.match(persistenceSource, /existingContent\.editorialEvidencePacketId !== editorialEvidencePacketId/);

// Phase I is intentionally inert: its core has no network/provider imports
// and it is not registered as an executable pipeline module or block.
assert.doesNotMatch(coreSource, /\bfetch\s*\(|@trigger\.dev|novita|gemini|anthropic/i);
assert.doesNotMatch(persistenceSource, /\bfetch\s*\(|@trigger\.dev|novita|gemini|anthropic/i);
assert.doesNotMatch(blockRegistrySource, /reviewedEvidencePack/);
assert.doesNotMatch(executableRegistrySource, /reviewedEvidencePack/);

console.log("Reviewed Evidence Pack persistence contract tests passed");
