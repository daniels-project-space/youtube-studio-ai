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

const GOOD_PLANNED = "Desmond Doss Saved 75 Men Without Touching a Weapon";
const WEAK_PLANNED = "Understanding The Historical Events At Hacksaw Ridge";
const CRAFTED = "The Army Called Him a Coward Until Hacksaw Ridge";

/** Judge stub: whichever title we nominate as the winner scores highest. */
function install(preferred: string): void {
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
          return { description: "A description long enough to pass.", tagsCsv: "a,b,c,d,e,f" };
        }
        if (prompt.startsWith("You are a YouTube CTR strategist")) {
          // Rank the candidates as listed, promoting `preferred`.
          const lines = prompt.split("CANDIDATES:\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
          const rankings = lines.map((line, idx) => ({
            idx,
            clickScore: line.includes(preferred) ? 10 : 7,
            direct: 9,
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

  install(CRAFTED);
  const replaced = await craft(WEAK_PLANNED);
  assert.equal(replaced.title, CRAFTED, "a weaker planned title must lose to the judged winner");
  assert.notEqual(replaced.title, WEAK_PLANNED, "the old `plannedTitle || title` behaviour must be gone");

  // No plan at all is the unscheduled path and must be unaffected.
  install(CRAFTED);
  const none = await craft("");
  assert.equal(none.title, CRAFTED);

  console.log("METACRAFT WARM START PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
