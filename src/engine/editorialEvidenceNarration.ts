import {
  assertEditorialEvidencePacket,
  type EditorialEvidencePacket,
} from "./editorialEvidencePacket";
import {
  StorySpineSchema,
  type StorySpine,
  validateStorySpine,
} from "./storySpine";

/**
 * Provider-free proof that an editor-approved factual claim remains in the
 * actual measured narration that Story Spine will hand to the renderer.
 *
 * This is intentionally an opt-in supervised capability. It does not infer
 * facts from arbitrary narration, and it does not make the automatic path a
 * factual-channel admission. A packet claim has to be present verbatim in a
 * single timed sentence before it can be treated as narration-grounded.
 */
export const EDITORIAL_EVIDENCE_NARRATION_BINDING_VERSION = "editorial-evidence-narration-binding/v1" as const;

export interface EditorialEvidenceNarrationClaimBinding {
  claimId: string;
  sourceIds: string[];
  storySpineSentenceIds: string[];
}

export interface EditorialEvidenceNarrationBinding {
  version: typeof EDITORIAL_EVIDENCE_NARRATION_BINDING_VERSION;
  editorialEvidencePacketFingerprint: string;
  claimBindings: EditorialEvidenceNarrationClaimBinding[];
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBoundedText(sentence: string, phrase: string): boolean {
  const normalizedSentence = normalizedText(sentence);
  const normalizedPhrase = normalizedText(phrase);
  return Boolean(normalizedPhrase) && ` ${normalizedSentence} `.includes(` ${normalizedPhrase} `);
}

function numericTokens(value: string): string[] {
  return (value.match(/\d[\d,.]*%?/g) ?? [])
    .map((token) => token.replace(/[,.]/g, ""))
    .filter(Boolean);
}

function containsNumericAnchor(sentences: readonly { text: string }[], numericAnchor: string): boolean {
  const expectedTokens = numericTokens(numericAnchor);
  if (!expectedTokens.length) {
    return sentences.some((sentence) => containsBoundedText(sentence.text, numericAnchor));
  }
  const actualTokens = new Set(sentences.flatMap((sentence) => numericTokens(sentence.text)));
  return expectedTokens.every((token) => actualTokens.has(token));
}

/**
 * Assert that every reviewed claim is audibly present in the exact timed
 * script. A claim may bind to more than one sentence only when the same
 * approved wording is deliberately repeated; it may never span a sentence
 * boundary, because that would lose a reliable time/cut attachment.
 */
export function assertEditorialEvidencePacketNarrationAlignment(args: {
  editorialEvidencePacket: unknown;
  storySpine: unknown;
  now?: number;
}): EditorialEvidenceNarrationBinding {
  const packet = assertEditorialEvidencePacket(args.editorialEvidencePacket, args.now);
  const storySpine = validateStorySpine(StorySpineSchema.parse(args.storySpine));
  const claimBindings: EditorialEvidenceNarrationClaimBinding[] = [];

  for (const claim of packet.claims) {
    const matchingSentences = storySpine.timedScript.sentences.filter((sentence) =>
      containsBoundedText(sentence.text, claim.approvedText),
    );
    if (!matchingSentences.length) {
      throw new Error(
        `editorial evidence claim ${claim.id} is not represented verbatim in one timed Story Spine sentence; ` +
          "regenerate narration from the reviewed claim or submit a fresh packet review",
      );
    }
    if (claim.numericAnchor && !containsNumericAnchor(matchingSentences, claim.numericAnchor)) {
      throw new Error(
        `editorial evidence claim ${claim.id} does not say its approved numeric anchor exactly in the bound timed narration`,
      );
    }
    claimBindings.push({
      claimId: claim.id,
      sourceIds: [...claim.sourceIds].sort(),
      storySpineSentenceIds: matchingSentences.map((sentence) => sentence.id),
    });
  }

  return {
    version: EDITORIAL_EVIDENCE_NARRATION_BINDING_VERSION,
    editorialEvidencePacketFingerprint: packet.contentFingerprint,
    claimBindings,
  };
}

export type { EditorialEvidencePacket, StorySpine };
