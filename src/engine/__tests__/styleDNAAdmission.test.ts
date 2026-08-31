import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertStyleDNAAdmissionSafety } from "@/engine/creative/styleDNAAdmission";
import {
  assertReferenceQualityContracts,
  referenceQualityContractFor,
} from "@/engine/creative/referenceQuality";

const cleanStyleDNA = {
  source: "research",
  recurringSubject: "an original night-shift radio astronomer",
  setting: "a hand-built mountain observatory",
  visualAvoid: ["do not imitate another channel frame-for-frame"],
  narrative: {
    pacing: "let each original causal reveal land before the next",
  },
};

assert.doesNotThrow(() => assertStyleDNAAdmissionSafety(cleanStyleDNA));
assert.doesNotThrow(
  () => assertStyleDNAAdmissionSafety(undefined),
  "an omitted DNA patch must leave historic stored rows readable",
);

for (const [label, unsafe] of [
  ["historic anchor payload", { ...cleanStyleDNA, referenceAnchors: ["cozy scene notes"] }],
  ["raw reference URL", { ...cleanStyleDNA, setting: "https://example.invalid/reference-video" }],
  ["automated video analysis", { ...cleanStyleDNA, automatedVideoAnalysis: { summary: "copy this framing" } }],
  ["renamed reference clip input", { ...cleanStyleDNA, referenceClipNotes: "same visual setting" }],
] as const) {
  assert.throws(
    () => assertStyleDNAAdmissionSafety(unsafe),
    /must not contain raw reference-video material/,
    `${label} must fail before a Style DNA mutation can persist it`,
  );
}

// This guard intentionally applies to the Style DNA field only. Source URLs
// remain valid inside their attributed, mechanics-only quality contract rather
// than being lost to a blanket URL ban.
assert.doesNotThrow(assertReferenceQualityContracts);
assert.ok(
  referenceQualityContractFor("music_loop").sources.some((source) => source.url.startsWith("https://")),
  "attributed reference-quality sources must remain available outside Style DNA",
);

const channelsSource = readFileSync(join(process.cwd(), "convex/channels.ts"), "utf8");
assert.match(
  channelsSource,
  /assertStyleDNAAdmissionSafety\(args\.styleDNA, \{ context: "channel creation styleDNA" \}\);/,
  "new channel admission must reject unsafe Style DNA before persistence",
);
assert.match(
  channelsSource,
  /assertStyleDNAAdmissionSafety\(rest\.styleDNA, \{ context: "channel update styleDNA" \}\);/,
  "channel updates must reject unsafe incoming Style DNA without reinterpreting an old row",
);
assert.doesNotMatch(
  channelsSource,
  /assertStyleDNAAdmissionSafety\(args\.identity/,
  "reviewed mechanics/source evidence stored outside Style DNA must not be swept into this narrow guard",
);

const retiredScript = readFileSync(join(process.cwd(), "scripts/anchor-lofi-refs.mjs"), "utf8");
assert.match(retiredScript, /process\.exitCode = 1;/, "the retired script must fail closed");
assert.doesNotMatch(
  retiredScript,
  /ConvexHttpClient|geminiAnalyzeYouTube|api\.channels\.updateChannel|https?:\/\/|referenceAnchors/,
  "the retired script must contain no reference-analysis or database-mutation capability",
);
const retiredInvocation = spawnSync(process.execPath, [join(process.cwd(), "scripts/anchor-lofi-refs.mjs")], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(retiredInvocation.status, 1, "invoking the retired script must stop before any work");
assert.match(retiredInvocation.stderr, /is retired/, "the retirement outcome must be explicit to an operator");

console.log("style DNA reference-admission safety passed");
