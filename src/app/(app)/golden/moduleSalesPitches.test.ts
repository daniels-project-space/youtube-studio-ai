import assert from "node:assert/strict";

import { GOLDEN_MODULES } from "@/engine/golden";
import { MODULE_SALES_PITCHES, moduleSalesPitch } from "./moduleSalesPitches";

const catalogKeys = GOLDEN_MODULES.map((module) => module.key).sort();
const pitchKeys = Object.keys(MODULE_SALES_PITCHES).sort();

assert.deepEqual(
  pitchKeys,
  catalogKeys,
  "every current Golden module needs intentionally authored operator-facing sales copy",
);

for (const goldenModule of GOLDEN_MODULES) {
  const pitch = moduleSalesPitch(goldenModule);
  assert.ok(pitch.title.length > 2 && pitch.title.length <= 42, `${goldenModule.key} title must stay compact`);
  assert.ok(pitch.promise.length > 12 && pitch.promise.length <= 64, `${goldenModule.key} promise must stay scannable`);
  assert.equal(pitch.bullets.length, 2);
  for (const bullet of pitch.bullets) {
    assert.ok(bullet.length > 5 && bullet.length <= 40, `${goldenModule.key} benefit bullet must stay compact`);
  }
  assert.doesNotMatch(
    `${pitch.title} ${pitch.promise} ${pitch.bullets.join(" ")}`,
    /src\/|\.ts\b|fingerprint|sha-?256|P\d+-\d+|implementation/iu,
    `${goldenModule.key} collapsed copy must sell the benefit rather than expose implementation prose`,
  );
}

console.log("Golden module sales-pitch copy tests passed");
