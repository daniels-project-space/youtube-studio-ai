import {
  CasefileSourcePacketSchema,
  type CasefileSourcePacket,
} from "./sourceFirstAdmission";

/**
 * Builds the source lock supplied to both the cold-open and script writers for
 * a supervised Casefile episode. This is deliberately a prompt *constraint*,
 * not an automated fact-check or an approval: the source packet and its human
 * editorial receipt remain the admission authority.
 */
export function casefileNarrativeGroundingPrompt(input: unknown): string {
  const packet = CasefileSourcePacketSchema.parse(input);
  const sourceById = new Map(packet.casePacket.sourceLedger.map((source) => [source.id, source]));
  const primaryByClaim = new Map(packet.claimPrimarySources.map((primary) => [primary.claimId, primary]));
  const claims = [...packet.casePacket.claims]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((claim) => {
      const primary = primaryByClaim.get(claim.id);
      const source = primary ? sourceById.get(primary.sourceId) : undefined;
      if (!primary || !source) {
        throw new Error(`casefile narrative grounding: claim ${claim.id} lacks an admitted primary source`);
      }
      return [
        `- ${claim.id} [${claim.state}; source ${source.id}, ${source.publisher}]: ${claim.text}`,
        `  Primary record: ${primary.primarySourceUrl} (${primary.provenance}).`,
      ].join("\n");
    });

  const sourceNames = [...sourceById.values()]
    .map((source) => `${source.id} (${source.publisher}: ${source.title})`)
    .join("; ");
  return [
    "CASEFILE NARRATIVE SOURCE LOCK — private, human-reviewed documentary draft.",
    "Build tension from the causal conflict inside the approved claims only. The cold open may combine or reframe approved claims, but may not invent a threat, motive, hidden event, witness, quote, date, place, identity, or outcome.",
    "Use restrained, source-aware wording for uncertainty. Do not portray allegations as fact, do not add operational wrongdoing detail, and do not make a faceless reconstruction sound like direct footage. On-screen citations and reconstruction disclosures are handled downstream; never read URLs or fake citations aloud.",
    `Admitted source records: ${sourceNames}.`,
    "Approved factual claims (use these as the complete factual boundary):",
    claims.join("\n"),
  ].join("\n\n");
}

/** Keeps the public helper's inferred contract visible at this seam. */
export type CasefileNarrativeGroundingInput = CasefileSourcePacket;
