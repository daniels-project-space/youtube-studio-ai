import type { Block } from "@/engine/types";
import { assertEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";

/**
 * Provider-free admission for reviewed factual-explainer evidence. It is a
 * narrow shared core, not a Casefile replacement and not an automatic channel
 * admission: downstream lanes must retain their own visual/source safeguards.
 */
const editorialEvidencePacket: Block = {
  id: "editorial_evidence_packet",
  consumes: ["editorialEvidencePacketInput"],
  produces: ["editorialEvidencePacket"],
  run: async (ctx) => {
    const packet = assertEditorialEvidencePacket(ctx.store["editorialEvidencePacketInput"]);
    ctx.log(
      `editorial_evidence_packet: ${packet.claims.length} reviewed claim(s) / ${packet.sources.length} immutable source snapshot(s); ` +
        "provider calls: 0; private human-editorial-review only",
    );
    return { editorialEvidencePacket: packet };
  },
};

export const editorialEvidencePacketBlocks: Block[] = [editorialEvidencePacket];
