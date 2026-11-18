import { quietListeningRestBudgetSec } from "./narrationPerformance";
import { effectiveScriptWordsPerSecond } from "./scriptNarrationBudget";

const MAX_PLANNED_SECTIONS = 512;
const MAX_WORDS_PER_SECTION = 400;
const MAX_DURATION_SEC = 86_400;

/** Read-only sizing; it is not a generation budget, approval, or execution admission. */
export function planQuietLongScript(input: { targetSeconds: number; gapSec?: number; speed?: number; qualityProfile?: "production" | "draft"; override?: string }) {
  if (!Number.isFinite(input.targetSeconds) || input.targetSeconds < 180 || input.targetSeconds > MAX_DURATION_SEC) throw new Error("quiet script planning requires a duration between 180 and 86400 seconds");
  const restSeconds = quietListeningRestBudgetSec(input.targetSeconds);
  const minimumRestBoundaries = Math.ceil(restSeconds / 30);
  const spokenSeconds = input.targetSeconds - restSeconds;
  const wordBudget = Math.round(spokenSeconds * effectiveScriptWordsPerSecond(input));
  const sectionCount = Math.max(minimumRestBoundaries + 1, Math.ceil(wordBudget / MAX_WORDS_PER_SECTION));
  if (sectionCount > MAX_PLANNED_SECTIONS) throw new Error("quiet script plan exceeds the bounded section limit");
  const baseWords = Math.floor(wordBudget / sectionCount);
  const extraWords = wordBudget % sectionCount;
  return {
    version: "quiet-long-script-plan/v1" as const,
    targetSeconds: input.targetSeconds, restSeconds, spokenSeconds, minimumRestBoundaries,
    wordBudget, sectionCount,
    sectionWordTargets: Array.from({ length: sectionCount }, (_, i) => baseWords + (i < extraWords ? 1 : 0)),
    executionAuthorized: false as const,
  };
}
