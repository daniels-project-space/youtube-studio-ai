/**
 * The planned title has to COMPETE, not win by precedence and not be ignored.
 *
 * Packaging used to ship `plannedTitle || craftedTitle`, so a title written
 * before the script existed — and never judged against the feed — beat one that
 * was. The fix is not "always prefer the crafted title": an owner-approved
 * planned title that is genuinely the strongest must still ship. Both halves
 * are asserted here, because getting only one of them right is easy and useless.
 *
 * The generator and judge are stubbed so this tests the SELECTION rule rather
 * than a model's taste, which would make the test a coin flip.
 */
process.env.OPENROUTER_API_KEY = "test-key-for-selection-logic";

import assert from "node:assert/strict";
import Module from "node:module";
import { readTitleReview } from "@/lib/titleReviewPresentation";

const GOOD_PLANNED = "Desmond Doss Saved 75 Men Without Touching a Weapon";
const WEAK_PLANNED = "Understanding The Historical Events At Hacksaw Ridge";
const CRAFTED = "The Army Called Him a Coward Until Hacksaw Ridge";

/** Judge stub: whichever title we nominate as the winner scores highest. */
let preferredTitle = CRAFTED;
let malformedJudgeAttempts = 0;
let judgeFailureAttempts = 0;
let packageFailureAttempts = 0;
let judgeAttempts = 0;
let installed = false;

function install(preferred: string, malformedAttempts = 0, packageFailures = 0, judgeFailures = 0): void {
  preferredTitle = preferred;
  malformedJudgeAttempts = malformedAttempts;
  judgeFailureAttempts = judgeFailures;
  packageFailureAttempts = packageFailures;
  judgeAttempts = 0;
  if (installed) return;
  installed = true;
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function patched(
    this: unknown, request: string, ...rest: unknown[]
  ) {
    const resolved = load.call(this, request, ...rest) as Record<string, unknown>;
    if (!request.includes("anthropic")) return resolved;
    return {
      ...resolved,
      hasAnthropicKey: () => true,
      claudeJson: async ({ prompt }: { prompt: string }) => {
        if (prompt.includes("pinned comment")) return { comment: "What would you have done?" };
        if (prompt.includes("description + tags")) {
          if (packageFailureAttempts-- > 0) throw new Error("package temporarily unavailable");
          return { description: "A description long enough to pass.", tagsCsv: "a,b,c,d,e,f" };
        }
        if (prompt.startsWith("You are a YouTube CTR strategist")) {
          if (judgeFailureAttempts-- > 0) throw new Error("judge temporarily unavailable");
          if (judgeAttempts++ < malformedJudgeAttempts) {
            return { rankings: [{ idx: 0, clickScore: 10 }] };
          }
          // Rank the candidates as listed, promoting `preferred`.
          const lines = prompt.split("CANDIDATES:\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
          const rankings = lines.map((line, idx) => ({
            idx,
            clickScore: line.includes(preferredTitle) ? 10 : 7,
            direct: 9,
            identityFit: 9,
            grounding: "supported" as const,
            reason: "The fixture title is grounded and matches the channel identity.",
          }));
          const winner = rankings.reduce((a, b) => (b.clickScore > a.clickScore ? b : a), rankings[0]);
          return { rankings, winner: winner.idx, runnerUp: rankings.find((r) => r.idx !== winner.idx)?.idx ?? 0 };
        }
        return { candidates: [{ frame: "direct_verdict", title: CRAFTED }] };
      },
    };
  } as never;
}

async function craft(warmStartTitle: string) {
  delete require.cache[require.resolve("@/lib/metacraft")];
  const { craftMetadata } = await import("@/lib/metacraft");
  return craftMetadata({
    topic: "Desmond Doss at Hacksaw Ridge",
    channelName: "Inked Histories",
    niche: "History",
    scriptExcerpt: "Desmond Doss saved 75 men at Hacksaw Ridge without touching a weapon; the army called him a coward.",
    warmStartTitle,
    log: () => {},
  });
}

async function main(): Promise<void> {
  install(GOOD_PLANNED);
  const kept = await craft(GOOD_PLANNED);
  assert.equal(kept.title, GOOD_PLANNED, "a planned title that wins on merit must still ship");
  assert.equal(kept.frame, "planned", "and must be identifiable as the planned one");
  assert.equal(kept.judged, true, "it ships having been judged, not by precedence");
  const keptReview = readTitleReview({ title: kept.title, titleDecision: kept.titleDecision });
  assert.ok(keptReview && keptReview.state === "recorded", "the selected title must carry a readable decision receipt");

  install(CRAFTED);
  const replaced = await craft(WEAK_PLANNED);
  assert.equal(replaced.title, CRAFTED, "a weaker planned title must lose to the judged winner");
  assert.notEqual(replaced.title, WEAK_PLANNED, "the old `plannedTitle || title` behaviour must be gone");

  // No plan at all is the unscheduled path and must be unaffected.
  install(CRAFTED);
  const none = await craft("");
  assert.equal(none.title, CRAFTED);

  // A malformed first judge response must trigger the existing bounded retry,
  // not silently turn a missing directness score into a pass.
  install(CRAFTED, 1);
  const recovered = await craft("");
  assert.equal(recovered.title, CRAFTED);
  assert.equal(recovered.judged, true, "the recovered title must have a real judge receipt");

  // A package failure happens after title selection. The selected title must
  // survive with an explicit deterministic package fallback instead of being
  // replaced by the legacy tournament path.
  install(CRAFTED, 0, 1);
  const packageRecovered = await craft("");
  assert.equal(packageRecovered.title, CRAFTED);
  assert.equal(packageRecovered.packageFallback, true, "the package degradation must be explicit");
  assert.match(packageRecovered.description, /Hacksaw Ridge/, "fallback description must retain the selected title");

  // A provider/transport exception is also not a score. Both bounded attempts
  // must fail closed instead of returning the first lint survivor as judged.
  install(CRAFTED, 0, 0, 99);
  await assert.rejects(() => craft(""), /both attempts failed the gate/);

  // If both bounded attempts return malformed judge evidence, the caller must
  // fail closed before buying the winner's description package.
  install(CRAFTED, 99);
  await assert.rejects(() => craft(""), /both attempts failed the gate/);

  console.log("METACRAFT WARM START PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
