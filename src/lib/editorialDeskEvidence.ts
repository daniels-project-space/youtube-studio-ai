/**
 * Small, UI-safe projections of immutable editorial records. These helpers do
 * not infer approval, trigger work, or mutate an episode; they only make the
 * bindings already persisted by the private editorial desks legible.
 */

export type CasefileEvidenceEpisode = {
  sourcePacketFingerprint?: string;
  status?: string;
  workflow?: {
    cinematicDraft?: {
      sequenceContentFingerprint?: string;
      content?: {
        beats?: Array<{
          shots?: Array<{
            visualMode?: string;
            sourceProofMedia?: unknown;
          }>;
        }>;
      };
    };
    cinematicAdmission?: {
      generatedSceneCount?: number;
      release?: string;
    };
    referenceMechanicsPacket?: {
      contentFingerprint?: string;
      release?: string;
    };
    sourceBoundStorySpine?: {
      storySpineFingerprint?: string;
      release?: string;
    };
    narrativeEvidenceLedger?: {
      contentFingerprint?: string;
      release?: string;
    };
  };
};

export type CasefileEvidenceLock = {
  label: string;
  detail: string;
  value?: string;
  recorded: boolean;
};

function hasSourceProofMedia(episode: CasefileEvidenceEpisode | null): boolean {
  return Boolean(
    episode?.workflow?.cinematicDraft?.content?.beats?.some((beat) =>
      beat.shots?.some(
        (shot) =>
          shot.visualMode === "source_proof" && Boolean(shot.sourceProofMedia),
      ),
    ),
  );
}

/**
 * Records are deliberately reported individually instead of as a made-up
 * readiness score: several of these bindings are optional for a given case.
 */
export function casefileEvidenceLocks(
  episode: CasefileEvidenceEpisode | null,
): CasefileEvidenceLock[] {
  const workflow = episode?.workflow;
  const sourcePacket = episode?.sourcePacketFingerprint;
  const storySpine = workflow?.sourceBoundStorySpine?.storySpineFingerprint;
  const ledger = workflow?.narrativeEvidenceLedger?.contentFingerprint;
  const mechanics = workflow?.referenceMechanicsPacket?.contentFingerprint;
  const cinematicSequence = workflow?.cinematicDraft?.sequenceContentFingerprint;
  const sourceProof = hasSourceProofMedia(episode);
  const admission = workflow?.cinematicAdmission;

  return [
    {
      label: "Source packet",
      detail: sourcePacket
        ? "Fingerprint recorded for this case."
        : "No source packet fingerprint is recorded.",
      value: sourcePacket,
      recorded: Boolean(sourcePacket),
    },
    {
      label: "Source-bound Story Spine",
      detail: storySpine
        ? "Timed narration binding is recorded."
        : "No source-bound Story Spine is recorded.",
      value: storySpine,
      recorded: Boolean(storySpine),
    },
    {
      label: "Narrative evidence ledger",
      detail: ledger
        ? "Reviewed claim-to-narration binding is recorded."
        : "No narrative evidence ledger is recorded.",
      value: ledger,
      recorded: Boolean(ledger),
    },
    {
      label: "Reference mechanics",
      detail: mechanics
        ? "Reviewed original craft guidance is recorded."
        : "No reviewed mechanics packet is recorded.",
      value: mechanics,
      recorded: Boolean(mechanics),
    },
    {
      label: "Cinematic sequence",
      detail: cinematicSequence
        ? "The current sequence fingerprint is recorded."
        : "No cinematic sequence fingerprint is recorded.",
      value: cinematicSequence,
      recorded: Boolean(cinematicSequence),
    },
    {
      label: "Source-proof media",
      detail: sourceProof
        ? "At least one source-proof shot has an approved media binding."
        : "No approved source-proof media binding is recorded.",
      recorded: sourceProof,
    },
    {
      label: "Render admission",
      detail:
        typeof admission?.generatedSceneCount === "number"
          ? `${admission.generatedSceneCount} generated scene${admission.generatedSceneCount === 1 ? "" : "s"} recorded in the admitted package.`
          : admission
            ? "An admitted render package is recorded."
            : "No admitted render package is recorded.",
      value: admission?.release,
      recorded: Boolean(admission),
    },
  ];
}

export type EditorialEvidenceSummary = {
  sourceCount: number;
  claimCount: number;
  reviewerId?: string;
  reviewId?: string;
  reviewedAt?: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Returns counts and review identifiers that actually exist in a saved packet. */
export function editorialEvidenceSummary(
  packet: Record<string, unknown> | null | undefined,
): EditorialEvidenceSummary {
  const review = recordValue(packet?.review);
  const reviewerId = stringValue(review?.reviewerId);
  const reviewId = stringValue(review?.reviewId);
  const reviewedAt = stringValue(review?.reviewedAt);
  return {
    sourceCount: Array.isArray(packet?.sources) ? packet.sources.length : 0,
    claimCount: Array.isArray(packet?.claims) ? packet.claims.length : 0,
    ...(reviewerId ? { reviewerId } : {}),
    ...(reviewId ? { reviewId } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
  };
}
