import { z } from "zod";

export const YUE2_AUDITION_CHECKS = ["channel_personality_fit", "arrangement_fidelity", "instrumental_only", "perceptual_artifacts", "repetition", "ending", "listening_quality"] as const;
const judgment = z.enum(["unreviewed", "pass", "fail"]);
export const YuE2AuditionSubmissionSchema = z.object({
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  verdict: z.enum(["needs_work", "rejected", "promising", "approved_for_assembly"]),
  listenedEntireSource: z.boolean(),
  checks: z.object(Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, judgment])) as Record<typeof YUE2_AUDITION_CHECKS[number], typeof judgment>).strict(),
  sections: z.array(z.object({ id: z.string().min(1).max(80), judgment, notes: z.string().trim().max(600) }).strict()).min(1).max(16),
  notes: z.string().trim().min(10).max(4000),
}).strict();
export type YuE2AuditionSubmission = z.infer<typeof YuE2AuditionSubmissionSchema>;
export type YuE2AuditionRecord = YuE2AuditionSubmission & {
  reviewedAt: number; reviewerId: string; productionApproved: false;
  sourceApprovalFingerprint?: string | null;
};

export function validateYuE2Audition(value: unknown, evidence: {
  candidateSha256: string; sectionIds: string[]; technicallyBlocked: boolean; contextRetained: boolean;
}): YuE2AuditionSubmission {
  const submission = YuE2AuditionSubmissionSchema.parse(value);
  if (submission.candidateSha256 !== evidence.candidateSha256) throw new Error("Candidate changed; reload review");
  if (submission.sections.length !== evidence.sectionIds.length ||
    submission.sections.some((section, index) => section.id !== evidence.sectionIds[index])) {
    throw new Error("Review must cover the exact ordered arrangement sections");
  }
  if (["promising", "approved_for_assembly"].includes(submission.verdict) && (evidence.technicallyBlocked || !evidence.contextRetained ||
    !submission.listenedEntireSource || Object.values(submission.checks).some(value => value !== "pass") ||
    submission.sections.some(section => section.judgment !== "pass" || !section.notes))) {
    throw new Error("Positive audition requires complete listening, retained context, clear technical checks and passing documented judgments");
  }
  return submission;
}
