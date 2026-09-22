import assert from "node:assert/strict";
import { MetadataDeliverySchema, musicDeliveryClaims } from "../metadataDelivery";
import { lintTitle } from "../metacraft";

const delivery = { basis: "planned", durationSec: 7200 } as const;
for (const label of ["2 hours", "two hours", "2-hour", "2h", "2H", "2 HOURS", "120 minutes", "7200 seconds"]) {
  const result = musicDeliveryClaims(`Quiet coastal music (${label})`, delivery);
  assert.deepEqual(result.issues, [], label);
  assert.ok(!result.sourceClaimTitle.includes(label), label);
}
for (const label of ["3 hours", "20 minutes", "2 seconds", "12 hours", "1.2 hours"]) {
  assert.equal(musicDeliveryClaims(`Quiet coastal music (${label})`, delivery).issues.length, 1, label);
}
for (const label of ["1 hour 30 minutes", "one hour and thirty minutes", "1.5 hours", "90 minutes"]) {
  assert.deepEqual(musicDeliveryClaims(`Quiet coastal music (${label})`, { basis: "measured", durationSec: 5400 }).issues, [], label);
}
assert.deepEqual(musicDeliveryClaims("Quiet coastal music (2 hours)", { basis: "measured", durationSec: 7199.99 }).issues, []);
const valid = lintTitle("Quiet coastal music for focus (2 hours)", {
  profile: "music_loop", isMusicNiche: true, grounding: "Quiet coastal music for focus.", delivery,
});
assert.equal(valid.pass, true, valid.issues.join("; "));
assert.equal(lintTitle("Quiet coastal music for focus [2 HOURS]", {
  profile: "music_loop", grounding: "Quiet coastal music for focus.", delivery,
}).pass, true, "an authorized uppercase duration label is not an ungrounded proper name");
assert.ok(lintTitle("Quiet coastal music in Atlantis (2 hours)", {
  profile: "music_loop", grounding: "Quiet coastal music.", delivery,
}).issues.some(issue => issue.includes("ungrounded name")), "duration removal must preserve unrelated proper-name checks");
const unrelated = lintTitle("2 secret recordings in coastal music (2 hours)", {
  profile: "music_loop", isMusicNiche: true, grounding: "Secret recordings in coastal music.", delivery,
});
assert.ok(unrelated.issues.some(issue => issue.includes('ungrounded number "2"')),
  "a runtime quantity must not authorize an unrelated narrative claim");
const wrong = lintTitle("Quiet coastal music for focus (3 hours)", {
  profile: "music_loop", isMusicNiche: true, grounding: "Three quiet coastal music sessions for focus.", delivery,
});
assert.ok(wrong.issues.some(issue => issue.includes("duration claim")), "topic numbers cannot override delivery duration");
const history = lintTitle("The siege ended after two hours", {
  profile: "searchable_long", grounding: "The siege ended after two hours.", delivery: { basis: "measured", durationSec: 300 },
});
assert.equal(history.pass, true, history.issues.join("; "));
for (const value of [0, -1, NaN, Infinity, "7200", 86401]) {
  assert.equal(MetadataDeliverySchema.safeParse({ basis: "planned", durationSec: value }).success, false);
}
console.log("METADATA DELIVERY PASS: numeric and written duration units, compound durations, narrative-number isolation, non-music event timing and strict input validation.");
