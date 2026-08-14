import type { Block } from "@/engine/types";
import { assertCasefileSourcePacket } from "@/engine/sourceFirstAdmission";

/**
 * Provider-free admission boundary for source-first documentary lanes.
 *
 * This is not a true-crime channel generator. It turns a real,
 * editor-approved Case Packet into provenance-bound artifacts that a future
 * renderer can consume, while explicitly limiting the resulting work to a
 * private human-editorial-review draft.
 */
const casefileSourcePacket: Block = {
  id: "casefile_source_packet",
  consumes: ["casefileSourcePacketInput"],
  produces: ["casefileSourcePacket", "casefileEvidenceGrammar", "casefileSourceAdmission"],
  run: async (ctx) => {
    const admitted = assertCasefileSourcePacket(ctx.store["casefileSourcePacketInput"]);
    ctx.log(
      `casefile_source_packet: ${admitted.receipt.claimPrimarySourceCount} primary claim links + ` +
        `${admitted.receipt.sourceUsageCount} explicit source uses; provider calls: 0; private human-review draft only`,
    );
    return {
      casefileSourcePacket: admitted.packet,
      casefileEvidenceGrammar: admitted.evidenceGrammar,
      casefileSourceAdmission: admitted.receipt,
    };
  },
};

export const casefileSourcePacketBlocks: Block[] = [casefileSourcePacket];
