import type { Block } from "@/engine/types";
import {
  autoVerifyCasefileSourcePacket,
  type CasefileSourcePacketContentInput,
} from "@/engine/casefileSourceAutoVerifier";
import { assertCasefileSourcePacket } from "@/engine/sourceFirstAdmission";

/**
 * Admission boundary for source-first documentary lanes.
 *
 * This is not a true-crime channel generator. It turns a real,
 * editor-approved Case Packet into provenance-bound artifacts that a future
 * renderer can consume, while explicitly limiting the resulting work to a
 * private human-editorial-review draft.
 *
 * A human-pasted `editorialReview` on the packet always wins unchanged; only
 * when the packet omits one do we call the automated structural-plausibility
 * screener (`autoVerifyCasefileSourcePacket` — one provider call, fail-closed)
 * to produce it, then fall through to the exact same, unmodified
 * `assertCasefileSourcePacket` gate below.
 */
const casefileSourcePacket: Block = {
  id: "casefile_source_packet",
  consumes: ["casefileSourcePacketInput"],
  produces: ["casefileSourcePacket", "casefileEvidenceGrammar", "casefileSourceAdmission"],
  run: async (ctx) => {
    const providedInput = ctx.store["casefileSourcePacketInput"];
    const hasHumanEditorialReview =
      Boolean(providedInput) &&
      typeof providedInput === "object" &&
      !Array.isArray(providedInput) &&
      (providedInput as Record<string, unknown>)["editorialReview"] !== undefined;

    const input = hasHumanEditorialReview
      ? providedInput
      : {
          ...(providedInput as Record<string, unknown>),
          editorialReview: await autoVerifyCasefileSourcePacket(
            providedInput as CasefileSourcePacketContentInput,
            { log: ctx.log },
          ),
        };

    const admitted = assertCasefileSourcePacket(input);
    ctx.log(
      `casefile_source_packet: ${hasHumanEditorialReview ? "human-drafted" : "auto-drafted"} editorial review — ` +
        `${admitted.receipt.claimPrimarySourceCount} primary claim links + ` +
        `${admitted.receipt.sourceUsageCount} explicit source uses; provider calls: ${
          hasHumanEditorialReview ? 0 : 1
        }; private human-review draft only`,
    );
    return {
      casefileSourcePacket: admitted.packet,
      casefileEvidenceGrammar: admitted.evidenceGrammar,
      casefileSourceAdmission: admitted.receipt,
    };
  },
};

export const casefileSourcePacketBlocks: Block[] = [casefileSourcePacket];
