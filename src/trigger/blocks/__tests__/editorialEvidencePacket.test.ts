import assert from "node:assert/strict";

import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";
import { editorialEvidencePacketBlocks } from "../editorialEvidencePacketBlocks";

const now = Date.now();
const packet = createEditorialEvidencePacket({
  subject: "Port delays",
  sources: [{
    id: "port-authority",
    name: "Port Authority",
    url: "https://authority.example.org/report",
    snapshotSha256: "a".repeat(64),
    kind: "official",
  }],
  claims: [{
    id: "port-delay",
    sourceIds: ["port-authority"],
    approvedText: "The annual report records a 4.1 day average berth delay.",
    numericAnchor: "4.1 days",
    context: "Annual report period only.",
  }],
  review: {
    reviewerId: "reviewer-editorial",
    reviewId: "review-port-delay",
    reviewedAt: new Date(now).toISOString(),
  },
  now,
});

async function main() {
  const logs: string[] = [];
  const output = await editorialEvidencePacketBlocks[0]!.run({
    ownerId: "owner-test",
    runId: "run-editorial-evidence",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: { editorialEvidencePacketInput: packet },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal((output.editorialEvidencePacket as { contentFingerprint: string }).contentFingerprint, packet.contentFingerprint);
  assert.match(logs.join("\n"), /provider calls: 0/);

  const stale = structuredClone(packet);
  stale.review.reviewedAt = new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString();
  await assert.rejects(
    () => editorialEvidencePacketBlocks[0]!.run({
      ownerId: "owner-test",
      runId: "run-editorial-evidence-stale",
      channelId: "channel-test",
      keyPrefix: "owner/owner-test/channel/channel-test/",
      params: {},
      store: { editorialEvidencePacketInput: stale },
      budgetUsd: 0,
      log: () => undefined,
    }),
    /older than 30 days/i,
  );
  console.log("editorial evidence packet block tests passed");
}

void main();
