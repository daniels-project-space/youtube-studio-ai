/**
 * A repair must aim at THIS channel's standard, including how it looks.
 *
 * runPipeline passes three things into planHeal — content lane, critic doctrine
 * and styleGrammar — and healer.ts read only the first two. The third was found
 * by scripts/audit-inert-inputs.ts: declared on HealChannelContext, passed at
 * every call site, read nowhere. So a heal regenerated a VISUAL block with a
 * description of the channel's editorial standard and none of its visual one,
 * which is how a watercolour channel comes back hyperreal on a retry.
 *
 * Nothing here asserts WHICH blocks re-run. That set is a deterministic
 * function of the defect catalog and must stay independent of free-form channel
 * prose — this only pins what the repair is aimed at.
 */
import assert from "node:assert/strict";

import { planHeal, type HealableBlock } from "@/engine/healer";

// A catalogued, healable defect. "thumbnail missing from uploaded draft" is a
// restore-and-persist class, not a quality rejection — the quality ones fail
// closed on purpose and would return null here.
const blocks: HealableBlock[] = [
  { id: "thumbnail_gen", produces: ["thumbnailKey"], consumes: ["title"], paid: true },
  { id: "qa_visual", produces: ["qaReport"], consumes: ["thumbnailKey"] },
];
const DEFECT = "thumbnail missing from uploaded draft";

// Both at the bound the healer itself allows: boundedStyleGrammar slices to
// 200 and boundedDoctrine to 240. A comfortable short pair would sit under any
// cap and prove nothing — the first version of this test used one, and
// restoring the old 300-char cap did not fail it. The worst case the code
// permits is the only case worth pinning.
const GRAMMAR =
  "hand-painted watercolour plates with visible paper grain and bleeding edges, muted winter palette, "
  + "soft graphite underdrawing, no digital gloss, no photoreal texture, no 3D".slice(0, 100);
const DOCTRINE =
  "Reject anything that reads as stock photography or a 3D render. Hold every plate long enough to "
  + "study. Prefer stillness to motion, and a single sustained image to a cut. Never resolve a reveal "
  + "with a jolt.".slice(0, 140);

function groundingHint(plan: { hints: Record<string, string[]> }): string {
  const all = Object.values(plan.hints).flat().filter((h) => h.startsWith("[channel-grounding]"));
  assert.ok(all.length > 0, "every re-running block must receive a channel-grounding hint");
  return all[0]!;
}

/* ------------------- the visual grammar reaches the repair ---------------- */

const logged: string[] = [];
const full = planHeal(
  DEFECT,
  blocks,
  (m) => logged.push(m),
  [],
  { contentLaneKey: "cinematic_ai", criticDoctrine: DOCTRINE, styleGrammar: GRAMMAR },
);
assert.ok(full, "a catalogued visual defect must produce a heal plan");
const hint = groundingHint(full);
assert.match(hint, /channel visual grammar: hand-painted watercolour plates/, "the visual grammar must reach the repair");
assert.match(hint, /channel critic doctrine: Reject anything/, "the critic doctrine must still reach the repair");
assert.match(hint, /content lane: cinematic_ai/, "the content lane must still reach the repair");

// The grammar is LAST in the composed string, so a cap that is too small eats
// exactly the part this test exists to protect. Pin that it survives intact.
assert.ok(
  hint.includes(GRAMMAR.slice(0, 200)),
  `the grammar must survive the hint cap intact; got ${hint.length} chars: ${hint}`,
);

/* ------------------------ the log names what it sent ---------------------- */

const groundingLog = logged.find((m) => m.includes("heal hints grounded"));
assert.ok(groundingLog, "the healer must log that it grounded the hints");
for (const source of ["content lane", "critic doctrine", "visual grammar"]) {
  assert.ok(
    groundingLog.includes(source),
    `the log must name every source it actually sent; "${source}" was missing from: ${groundingLog}`,
  );
}

/* -------------------------- grammar alone is enough ----------------------- */

// A channel with a visual identity but no critic doctrine must still ground its
// repairs. Before, doctrine-or-lane decided whether ANY hint was attached.
const grammarOnly = planHeal(
  DEFECT,
  blocks,
  () => {},
  [],
  { styleGrammar: GRAMMAR },
);
assert.ok(grammarOnly, "a catalogued defect must still plan a heal");
assert.match(
  groundingHint(grammarOnly),
  /channel visual grammar: hand-painted watercolour/,
  "a channel with only a visual grammar must still have its repair grounded",
);

/* ------------------------------ no context ------------------------------- */

// With nothing to ground on, there must be no grounding hint at all rather than
// an empty one that reads like guidance.
const bare = planHeal(
  DEFECT,
  blocks,
  () => {},
  [],
);
assert.ok(bare, "a catalogued defect must plan a heal without channel context");
assert.equal(
  Object.values(bare.hints).flat().filter((h) => h.startsWith("[channel-grounding]")).length,
  0,
  "with no channel context there must be no empty grounding hint",
);

console.log("HEALER CHANNEL GROUNDING PASS — lane, doctrine and visual grammar all reach the repair");
