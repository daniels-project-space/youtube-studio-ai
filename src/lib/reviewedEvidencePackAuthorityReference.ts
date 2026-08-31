export type ReviewedEvidencePackAuthorityKind =
  | "editorial_evidence_packet"
  | "data_story_source_ledger";

type StoredEditorialEvidencePacket = {
  ownerId: string;
  contentFingerprint: string;
};

/**
 * Enforces the durable authority boundary shared by the provider-free engine
 * receipt and its Convex persistence adapter. The caller resolves the packet
 * ID from storage first; this function deliberately has no database or
 * provider dependency, so its negative cases stay directly regression-tested.
 */
export function assertReviewedEvidencePackEditorialAuthorityReference<
  TPacket extends StoredEditorialEvidencePacket,
>(args: {
  authorityKind: ReviewedEvidencePackAuthorityKind;
  authorityContentFingerprint: string;
  ownerId: string;
  editorialEvidencePacketId?: string;
  storedEditorialEvidencePacket?: TPacket | null;
}): void {
  if (args.authorityKind === "data_story_source_ledger") {
    if (args.editorialEvidencePacketId !== undefined) {
      throw new Error(
        "reviewed evidence pack data-story authority must not carry an editorial evidence packet reference",
      );
    }
    return;
  }

  if (!args.editorialEvidencePacketId?.trim()) {
    throw new Error(
      "reviewed evidence pack editorial authority requires a stored editorial evidence packet reference",
    );
  }
  const packet = args.storedEditorialEvidencePacket;
  // Deliberately return one opaque result for an absent and a cross-owner row.
  if (!packet || packet.ownerId !== args.ownerId) {
    throw new Error("reviewed evidence pack editorial authority packet not found");
  }
  if (packet.contentFingerprint !== args.authorityContentFingerprint) {
    throw new Error(
      "reviewed evidence pack editorial authority fingerprint does not match stored packet",
    );
  }
}
