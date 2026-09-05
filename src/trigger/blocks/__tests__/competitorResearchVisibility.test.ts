/**
 * The block that supplies the evidence two judges rely on must say when it has
 * none.
 *
 * competitor_research loads three things — a niche profile, an SEO databank and
 * a competitor list — and every one was read with a bare `.catch(() => null)`.
 * No log. A Convex outage therefore produced an empty result that is
 * indistinguishable from a niche nobody has researched yet, and the block
 * returned `nicheReady: true` either way.
 *
 * That is not a local problem. topicraft fuzzy-verifies every bet's cited
 * evidence against these signals before its judge sees them, and metacraft
 * judges each title against this competitor feed. Both silently lose their
 * evidence base rather than failing, so the visible symptom is weaker topics and
 * weaker titles — with nothing anywhere pointing at the cause.
 *
 * `nicheReady` is left alone deliberately: it is produced but read by no
 * consumer anywhere, so narrowing it would change nothing except to look like a
 * fix. The honest change is that the log now distinguishes "researched and
 * empty" from "could not read", and says so where an operator will see it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/trigger/blocks/intelligenceBlocks.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- no silent catch on the three reads ---------------------------------
  for (const what of ["niche intelligence read FAILED", "SEO databank read FAILED", "competitor list read FAILED"]) {
    assert.ok(SRC.includes(what), `a failed read must name itself: "${what}"`);
  }
  assert.ok(
    !/\.catch\(\(\) => null\)/.test(CODE.slice(CODE.indexOf("const [nicheIntel, databank, competitors]"), CODE.indexOf("nicheReady: true"))),
    "none of the three reads may swallow its error without a log",
  );

  // ---- the empty case is called out, not merely absent --------------------
  assert.match(
    SRC,
    /competitor_research: NO INTELLIGENCE for/,
    "having nothing at all must be reported, since two judges downstream depend on it",
  );
  assert.match(
    SRC,
    /judged against an empty feed/,
    "and the log must say what the consequence is, not just that a value was empty",
  );
  // The healthy case must report counts too, or "no news" stays ambiguous.
  assert.match(CODE, /competitors=\$\{competitorCount\}/, "a successful load must report what it found");

  // ---- nicheReady is untouched on purpose ---------------------------------
  assert.match(
    CODE,
    /nicheReady: true,/,
    "nicheReady is read by no consumer; narrowing it would look like a fix and change nothing",
  );

  console.log("COMPETITOR RESEARCH VISIBILITY PASS — an empty evidence base announces itself");
}

main();
