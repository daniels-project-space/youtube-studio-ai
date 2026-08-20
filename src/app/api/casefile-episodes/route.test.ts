import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sourceProofMediaAttachments } from "./route";

const attachment = {
  shotId: "cinematic-shot-source-proof",
  sourceId: "source-court-record",
  assetId: "asset-court-exhibit",
  rightsEvidenceLocator: "https://court.example.org/rights/exhibit",
  assetUrl: "https://court.example.org/assets/exhibit.jpg",
  assetSha256: "a".repeat(64),
  approvalReceiptId: "source-proof-receipt-court-exhibit",
};

assert.deepEqual(
  sourceProofMediaAttachments({
    action: "attach_source_proof_media",
    episodeId: "casefileEpisodes:test",
    attachments: [attachment],
  }),
  [attachment],
  "the private route passes only the seven exact asset-approval fields into the workflow",
);

assert.throws(
  () => sourceProofMediaAttachments({
    action: "attach_source_proof_media",
    episodeId: "casefileEpisodes:test",
    attachments: [{ ...attachment, provenanceFingerprint: "b".repeat(64) }],
  }),
  /packet\/provenance fields are server-derived/i,
  "a browser cannot inject a provenance fingerprint",
);

assert.throws(
  () => sourceProofMediaAttachments({
    action: "attach_source_proof_media",
    episodeId: "casefileEpisodes:test",
    attachments: [attachment],
    sourcePacket: { sourceUsage: [] },
  }),
  /accepts only action, episodeId, and attachments/i,
  "a browser cannot submit a packet alongside source-proof media",
);

assert.throws(
  () => sourceProofMediaAttachments({
    action: "attach_source_proof_media",
    episodeId: "casefileEpisodes:test",
    attachments: [{ shotId: attachment.shotId }],
  }),
  /is missing/i,
  "the intake cannot forward a partial asset obligation",
);

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(routeSource, /api\.casefileEpisodes\.attachSourceProofMedia/);
assert.match(routeSource, /attachments: sourceProofMediaAttachments\(body\)/);

const persistenceSource = readFileSync(new URL("../../../../convex/casefileEpisodes.ts", import.meta.url), "utf8");
assert.match(persistenceSource, /attachCasefileEpisodeSourceProofMedia/);
assert.match(persistenceSource, /const episode = await ownedEpisode\(ctx, args\.episodeId, args\.ownerId\)/);

const deskSource = readFileSync(new URL("../../(app)/casefile/page.tsx", import.meta.url), "utf8");
assert.match(deskSource, /attach_source_proof_media/);
assert.match(deskSource, /Source-proof media attachments JSON/);
assert.match(deskSource, /packet\/provenance fields are server-derived/);

console.log("Casefile source-proof media route intake tests passed");
