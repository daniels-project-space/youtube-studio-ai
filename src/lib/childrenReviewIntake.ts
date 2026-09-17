export type ChildAgeBandLabel = "toddler" | "preschool" | "early_primary";

export type ChildrenReviewDraftInput = {
  channelName: string;
  ageBand: ChildAgeBandLabel;
  learningObjective: string;
  curriculumDraft: string;
  showBibleDraft: string;
};

function boundedText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return text;
}

/** Draft-only intake; never a child-editor approval or a production seed. */
export function normalizeChildrenReviewDraft(
  input: ChildrenReviewDraftInput,
  readyForReview: boolean,
): ChildrenReviewDraftInput {
  const draft = {
    channelName: boundedText(input.channelName, "Channel name", 120),
    ageBand: input.ageBand,
    learningObjective: boundedText(input.learningObjective, "Learning objective", 240),
    curriculumDraft: boundedText(input.curriculumDraft, "Curriculum draft", 4_000),
    showBibleDraft: boundedText(input.showBibleDraft, "Show Bible draft", 4_000),
  };
  if (draft.channelName.length < 2) throw new Error("Enter a channel name");
  if (!(["toddler", "preschool", "early_primary"] as const).includes(draft.ageBand)) {
    throw new Error("Select a supported child age band");
  }
  if (readyForReview && (
    draft.learningObjective.length < 8 ||
    draft.curriculumDraft.length < 20 ||
    draft.showBibleDraft.length < 20
  )) {
    throw new Error("A review handoff needs one learning objective and substantive curriculum and Show Bible drafts");
  }
  return draft;
}
