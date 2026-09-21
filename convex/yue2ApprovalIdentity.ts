import type { Doc } from "./_generated/dataModel";
import { createYuE2SourceApproval, YuE2SourceApprovalSchema } from "../src/engine/yue2SourceApproval";

export function verifiedYuE2Approval(row: Doc<"yue2Auditions"> | null, invocationSha256: string | undefined) {
  if (!row?.sourceApproval || row.submission?.verdict !== "approved_for_assembly") return null;
  const approval = YuE2SourceApprovalSchema.parse(row.sourceApproval);
  const expected = createYuE2SourceApproval({ basis: approval.basis, submission: row.submission,
    reviewedAt: row.reviewedAt, revision: row.revision });
  if (approval.fingerprint !== expected.fingerprint || approval.basis.ownerId !== row.ownerId ||
    approval.basis.channelId !== row.channelId || approval.basis.runId !== row.runId ||
    approval.basis.candidateSha256 !== row.candidateSha256) throw new Error("Source approval audit identity mismatch");
  return approval.basis.invocationSha256 === invocationSha256 ? approval : null;
}
