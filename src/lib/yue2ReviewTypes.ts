import type { readDurableYuE2Candidate } from "./yue2DurableEvaluation";
import type { YuE2AuditionRecord } from "@/engine/yue2Audition";

type Material = NonNullable<Awaited<ReturnType<typeof readDurableYuE2Candidate>>>;

/** Public owner-only projection; storage keys and worker configuration stay server-side. */
export type YuE2CandidateReview = {
  candidateSha256: string;
  audition?: YuE2AuditionRecord | null;
  jobId: string;
  nativeWavUrl: string;
  nativeOutput: Material["candidate"]["nativeOutput"];
  arrangement: Material["request"]["acceptedArrangement"]["arrangement"];
  brief: {
    topic: string;
    sourceBriefFingerprint: string;
    reviewContext: NonNullable<Material["request"]["acceptedArrangement"]["reviewContext"]> | null;
    contextRetained: boolean;
    channelPersonalityVerified: false;
  };
  allocation: { allocatedCostUsdMicros: number; providerBilledCostUsdMicros: null };
  quality: Material["quality"];
};
