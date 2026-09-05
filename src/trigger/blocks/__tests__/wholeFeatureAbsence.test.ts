/**
 * A whole feature going missing must not log like one item being skipped.
 *
 * Several blocks catch a failure and continue, which is usually right — a
 * missing portrait or one unrenderable quote card must not fail a video. But
 * two shapes hide inside that pattern and they are not the same:
 *
 *   PER-ITEM   the loop over Wikimedia lookups skips one entity and images the
 *              rest. Losing one of eight is visible in the output.
 *   WHOLE      entity extraction failing means there is nothing to look up, so
 *              the video ships with NO entity imagery — and the old log said
 *              only "extraction failed", which reads identically to a script
 *              that happens to name nobody.
 *
 * quote_overlays is the counter-example worth keeping in view: when its model
 * selection fails it falls through to a DETERMINISTIC philosopher-quote pass, so
 * the feature still happens. That is a real fallback, not a silent loss, and it
 * is why this test does not demand a loud log there.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- the whole-feature loss announces itself ----------------------------
  assert.match(
    SRC,
    /entity_imagery: EXTRACTION FAILED — this video gets no entity imagery at all/,
    "a failed extraction removes the entire feature and must say so",
  );
  assert.ok(
    !/entity_imagery: extraction failed \(\$\{e instanceof Error/.test(CODE),
    "the old wording read like a routine per-item skip",
  );

  // ---- but it must still DEGRADE, not throw -------------------------------
  const at = CODE.indexOf("entity_imagery: EXTRACTION FAILED");
  assert.ok(at > 0);
  const after = CODE.slice(at, at + 400);
  assert.ok(!/throw\s/.test(after), "a missing portrait must not fail the render");

  // ---- the per-item skips stay per-item ----------------------------------
  // If these became loud too, the distinction would be lost and the loud line
  // would stop meaning anything.
  assert.match(
    CODE,
    /entity_imagery: no Wikimedia image for/,
    "a single entity with no image must remain an ordinary skip",
  );

  // ---- quote_overlays keeps its deterministic fallback --------------------
  // This is what makes its quiet catch acceptable; if the fallback were removed
  // the catch would become the same silent-loss shape.
  const quoteAt = CODE.indexOf("quote_overlays: selection failed");
  assert.ok(quoteAt > 0, "the quote selection catch must still exist");
  const afterQuote = CODE.slice(quoteAt, quoteAt + 1200);
  // An OR here was too weak: the first version matched `Marcus Aurelius|philoIdx`,
  // so emptying the philosopher list still matched the variable name and the
  // test passed while the fallback had been neutered. Both halves are required —
  // a named list AND the pass that uses it.
  assert.match(
    afterQuote,
    /philoIdx/,
    "the deterministic quote pass must still run after a failed selection",
  );
  const philo = /const PHILO = \/\\b\(([^)]+)\)\\b\//.exec(afterQuote);
  assert.ok(philo, "the philosopher list must still be a real alternation, not a stub");
  const names = philo![1].split("|").filter((n) => /^[A-Z]/.test(n.trim()));
  assert.ok(
    names.length >= 5,
    `the deterministic fallback recognises ${names.length} name(s) — too few to catch the ` +
      `attributed quotes script_gen is asked to weave in, so a failed selection would drop every card`,
  );

  console.log("WHOLE FEATURE ABSENCE PASS — losing everything does not log like losing one");
}

main();
