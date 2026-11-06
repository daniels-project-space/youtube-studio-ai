import { readDurableYuE2Candidate } from "@/lib/yue2DurableEvaluation";
import { readHyperYoutubeYue } from "@/lib/hyperYoutubeYue";

/** Existing retained candidates and new HRS candidates use separate evidence. */
export async function readYuE2CandidateForReview(scope:{ownerId:string;channelId:string;runId:string}) {
  const legacy=await readDurableYuE2Candidate(scope);
  return legacy ?? await readHyperYoutubeYue(scope);
}
