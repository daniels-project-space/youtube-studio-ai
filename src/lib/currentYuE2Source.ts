import { readYuE2EngineCandidate } from "./yue2EngineSource";
import { readDurableYuE2Candidate } from "./yue2DurableEvaluation";

/** Modern production sources and historical supervised evidence retain distinct readers. */
export async function readCurrentYuE2Candidate(scope: { ownerId: string; channelId: string; runId: string }) {
  const native = await readYuE2EngineCandidate(scope);
  if (native) return native;
  return readDurableYuE2Candidate(scope);
}
