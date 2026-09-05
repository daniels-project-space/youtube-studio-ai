/**
 * A reasoning model's token ceiling must cover the reasoning AND the answer.
 *
 * Every pinned route in this codebase is google/gemini-3.7-flash, which spends
 * output budget thinking before it emits anything. When the ceiling is too low
 * the budget is gone before the JSON starts, the response fails its contract,
 * and the call throws. That failure is only as visible as its caller makes it:
 *
 *   metacraft pinnedComment   `.catch(() => "")` — silent. Measured at the
 *                             shipped ceiling of 300: 3 of 3 attempts failed,
 *                             and 600 failed too, while 1200 and 2000 passed.
 *                             Every video ever produced shipped with an empty
 *                             pinned comment, and nothing said so.
 *   capabilityAdvisor         reasoned fallback. At the shipped 500: 0 of 2
 *                             attempts succeeded, so the advisor never once
 *                             advised — a channel received a default that read
 *                             exactly like a considered pick.
 *   formatAdvisor             reasoned fallback. At the shipped 700: 1 of 2.
 *                             The format choice was a coin flip between an
 *                             advised pick and a fallback.
 *
 * There is deliberately NO universal minimum asserted here. How much the model
 * reasons depends on the prompt: three simple one-field prompts cleared 700 at
 * 3 of 3, while the advisor-shaped prompt failed 2 of 2 at 500. A blanket floor
 * would be a number nobody measured, which is the mistake this file exists to
 * stop. What is pinned is each site that WAS measured, at the value measured
 * safe for it.
 *
 * The durable lesson is the second column, not the first: a soft failure must
 * still be loud. A fallback that records its reason is fine; `.catch(() => "")`
 * is how a feature stays dead in production indefinitely.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Source with comments removed.
 *
 * The first version of the swallow check matched its own explanation: the
 * comment describing the bug contains the offending snippet verbatim, so the
 * test failed on prose. A source assertion has to look at code, not at the
 * words written about the code.
 */
const code = (p: string): string =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Ceiling measured safe for the prompt at this call site. */
const MEASURED: { file: string; site: string; min: number; evidence: string }[] = [
  { file: "src/lib/metacraft.ts", site: "pinnedComment", min: 1200, evidence: "300 and 600 failed every attempt; 1200 and 2000 passed" },
  { file: "src/engine/creative/capabilityAdvisor.ts", site: "capability verdict", min: 1200, evidence: "500 failed 2/2; 1200 and 2000 passed 2/2" },
  { file: "src/engine/creative/formatAdvisor.ts", site: "format verdict", min: 1200, evidence: "700 passed only 1/2; 1200 and 2000 passed 2/2" },
];

function main(): void {
  for (const { file, site, min, evidence } of MEASURED) {
    const source = code(file);
    const ceilings = Array.from(source.matchAll(/maxTokens:\s*([0-9_]+)/g)).map((m) =>
      Number(m[1].replace(/_/g, "")),
    );
    assert.ok(ceilings.length > 0, `${file} declares no maxTokens — has the ${site} call moved?`);
    const tooLow = ceilings.filter((c) => c < min);
    assert.deepEqual(
      tooLow,
      [],
      `${file} (${site}) has a token ceiling below the measured-safe ${min}: ${tooLow.join(", ")}. ` +
        `Evidence: ${evidence}. Below this the call fails its JSON contract and the feature degrades ` +
        `into a fallback that looks like a real answer.`,
    );
  }

  // The pinned comment must degrade QUIETLY IN BEHAVIOUR but never in the log.
  // This is the property that would have caught the bug years earlier.
  const metacraft = read("src/lib/metacraft.ts");
  assert.ok(
    !/\.catch\(\(\)\s*=>\s*""\)/.test(code("src/lib/metacraft.ts")),
    "metacraft must not swallow a provider failure into an empty string with no log — " +
      "that is exactly how the pinned comment stayed empty on every video ever made",
  );
  assert.match(
    metacraft,
    /pinned comment failed, shipping without one/,
    "the pinned-comment failure must name itself in the log",
  );

  console.log("REASONING TOKEN CEILINGS PASS — measured ceilings held, soft failures stay loud");
}

main();
