/**
 * Does the Show Bible fit in its ceiling?
 *
 * synthShowBible runs agentJson at maxTokens 2000 for a contract that is far
 * heavier than anything the list floor was measured on: TWO arrays of 5-8
 * specific items (worksInSpace, avoidInSpace), an activeCrew array, three prose
 * fields, and up to five per-role doctrine strings. The measured floor came from
 * a 5-item list (1000) and an 8-item ranking (2500). This asks for roughly
 * 10-16 list items plus eight prose fields, on a route where reasoning is
 * mandatory and billed out of the same budget.
 *
 * It matters more than most ceilings because of what the failure does. The catch
 * returns fallbackBible, which sets:
 *
 *   worksInSpace: []      the proven patterns for the niche — gone
 *   avoidInSpace: []      the anti-patterns, which the prompt itself calls
 *                         "critical" — gone
 *   no doctrines          every crew role loses its per-channel stance
 *
 * And crew.ts's header() omits both clauses when those arrays are empty, so
 * EVERY crew brief for that channel — director, DP, editor, composer, critic —
 * is written without them. The bible is persisted at inception, so this is not
 * one bad video; it is the channel's permanent creative baseline.
 *
 * The fallback is honest (it logs "synth failed — fallback") and correct as a
 * degradation. The question is only whether it is being taken because the
 * ceiling is too low, which would mean channels are silently generic by default.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/measure-showbible-ceiling.ts
 */
import { synthShowBible } from "@/engine/creative/showBible";

/** Four real channel identities, so one niche's verbosity cannot carry it. */
const CASES = [
  { name: "Lorecraft", family: "narrated_stock", niche: "folklore and local legend", persona: "hushed, unhurried folklore reader" },
  { name: "Casefile", family: "narrated_stock", niche: "unsolved cases, evidence-led", persona: "cold, procedural narrator" },
  { name: "How It Holds", family: "narrated_stock", niche: "civil engineering explained", persona: "bright, brisk, curious" },
  { name: "Stoic Truths", family: "narrated_stock", niche: "practical ancient philosophy", persona: "steady, grounded, adult" },
] as const;

const TRIALS = 2;

/** A bible that fell back is recognisable without reading the log. */
const isFallback = (bible: { worksInSpace: string[]; avoidInSpace: string[] }) =>
  bible.worksInSpace.length === 0 && bible.avoidInSpace.length === 0;

async function main(): Promise<void> {
  console.log("=== show bible vs ceiling ===");
  console.log("A run that falls back gives the channel NO proven patterns, NO anti-patterns");
  console.log("and NO crew doctrine, permanently.\n");

  // ShowBibleInput has no ceiling override, so the ceiling under test is
  // whatever the source currently declares. The caller patches it between runs
  // and passes the value in, rather than this file copying the prompt — a copied
  // prompt would measure the copy.
  const ceiling = process.env.SHOWBIBLE_CEILING_UNDER_TEST ?? "(as declared in source)";
  let real = 0;
  let fell = 0;
  const sizes: number[] = [];
  for (const channel of CASES) {
    for (let trial = 0; trial < TRIALS; trial++) {
      const bible = await synthShowBible({
        name: channel.name,
        family: channel.family,
        niche: channel.niche,
        persona: channel.persona,
        now: Date.now(),
        log: () => {},
      } as unknown as Parameters<typeof synthShowBible>[0]);
      if (isFallback(bible)) fell++;
      else {
        real++;
        sizes.push(bible.worksInSpace.length + bible.avoidInSpace.length);
      }
    }
  }
  const total = CASES.length * TRIALS;
  const mean = sizes.length ? (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) : "-";
  console.log(
    `  ceiling ${ceiling}: ${real}/${total} real, ${fell} fell back` +
      `   mean list items when real: ${mean}`,
  );

  console.log(
    `\nA fallback here is not a bad video, it is a bad CHANNEL: the bible is persisted\n` +
      `at inception and every crew brief afterwards is written without the patterns and\n` +
      `anti-patterns it should have carried.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
