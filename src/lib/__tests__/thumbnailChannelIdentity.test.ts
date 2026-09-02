import assert from "node:assert/strict";

import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import {
  resolveGoldenThumbnailPlaybook,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";

const base: ThumbnailPlaybook = {
  source: "style_dna_foundation",
  energy: "bold",
  visualLanguage: {
    font: "impact",
    treatment: "plate",
    baseColor: "#111111",
    accentColor: "#ffcc00",
    imageStyle: "generic thumbnail art",
  },
  rules: ["one clear subject"],
  avoid: ["clutter"],
  patterns: [{ name: "hero", when: "all topics", fluxRecipe: "one subject", textRecipe: { lines: [] } }],
  refsUsed: [],
  distilledAt: 1,
};

function policyFor(channelName: string) {
  return applyThumbnailChannelIdentity({ channelName, playbook: base });
}

const investory = policyFor("Investory");
assert.match(investory.visualLanguage?.imageStyle ?? "", /realistic financial editorial photograph/i);
assert.match(investory.rules.join(" "), /real-world wealth mechanism/i);
assert.match(investory.avoid.join(" "), /video-game/i);

const gratitude = policyFor("Gratitude Springs");
assert.match(gratitude.rules.join(" "), /woman floating or resting naturally in water/i);
assert.match(gratitude.rules.join(" "), /stones only when/i);
assert.match(gratitude.avoid.join(" "), /repeating paired stones/i);

const chalk = policyFor("Chalk & Compound");
assert.match(chalk.rules.join(" "), /hand actively drawing/i);
assert.match(chalk.rules.join(" "), /tax mechanism/i);
assert.match(chalk.avoid.join(" "), /chalkless illustration/i);
assert.equal(chalk.identityContract?.profile, "chalk-compound-causal-teaching");
assert.ok(
  chalk.identityContract?.reviewCriteria.some((criterion) => /actively drawing with white chalk/i.test(criterion)),
  "Chalk & Compound needs a pixel-verifiable active-chalk requirement, not only prompt prose",
);
assert.ok(
  chalk.identityContract?.reviewCriteria.some((criterion) => /tax split or take-home consequence/i.test(criterion)),
  "Tax thumbnails must prove the causal allocation with the headline covered",
);

const inked = policyFor("Inked Histories");
assert.match(inked.visualLanguage?.imageStyle ?? "", /historical ink-and-charcoal/i);
assert.match(inked.avoid.join(" "), /video-game concept art/i);

const lofi = policyFor("Night LoFi");
assert.match(lofi.rules.join(" "), /exact sampled frame/i);
assert.match(lofi.avoid.join(" "), /separately generated generic Lo-Fi scene/i);
assert.equal(lofi.identityContract?.profile, "lofi-rendered-frame-only");

assert.equal(policyFor("Unrelated Channel"), base, "unmatched channel records must remain untouched");

const resolved = resolveGoldenThumbnailPlaybook({
  storedPlaybook: base,
  channelName: "Chalk & Compound",
});
assert.equal(resolved.strategy, "playbook");
assert.match(
  resolved.playbook.rules.join(" "),
  /hand actively drawing/i,
  "the central playbook resolver must apply the identity policy to stored channel playbooks",
);
assert.match(
  resolved.playbook.avoid.join(" "),
  /chalkless illustration/i,
  "the central playbook resolver must carry channel-specific anti-patterns into generation and QA",
);

console.log("thumbnail channel-identity policy tests passed");
