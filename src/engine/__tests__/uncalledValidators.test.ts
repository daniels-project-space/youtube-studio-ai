/**
 * Four validators existed and nothing ever ran them.
 *
 * The inertness audit surfaced them as unreferenced exports, and each one is the
 * same shape: a function written to enforce an invariant, exported, and then
 * never called from anywhere — production or test. One of them
 * (assertCertifiedChannelProgramRouteCatalog) even documents itself as "exposed
 * for catalog tests", and no catalog test existed.
 *
 * An unenforced invariant is not a weaker invariant, it is no invariant. The
 * catalogue could have grown a duplicate selector or a route with no required
 * blocks at any point and nothing would have said so.
 *
 * All four pass today — verified before writing this, so it records a state
 * rather than fixing a break. What changes is that they now hold.
 *
 * ONE LIMIT, STATED. assertCertifiedChannelProgramRouteCatalog takes no
 * argument: it reads the module's own constant, so this can prove the real
 * catalogue is clean but cannot prove the CHECK still works. Adding a duplicate
 * route to the catalogue does fail this test, which is the property that
 * matters; disabling the duplicate check while no duplicate exists does not,
 * and no test without a seam into that function could tell. Worth knowing
 * before trusting it further than it goes.
 */
import assert from "node:assert/strict";

import { assertCertifiedChannelProgramRouteCatalog } from "@/engine/channelProgramRoute";
import { isProductionRouteQualified } from "@/engine/productionRouteQualification";
import {
  assertRoutePreflightReadyReceiptWire,
  assertRouteReleaseQualifiedReceiptWire,
} from "@/engine/productionRouteQualificationReceiptWire";

function main(): void {
  // ---- the certified route catalogue polices itself -----------------------
  // No duplicate selector, and no route that declares zero required blocks —
  // a route with no required blocks would admit any pipeline at all.
  assert.doesNotThrow(
    () => assertCertifiedChannelProgramRouteCatalog(),
    "the certified channel-program route catalogue must satisfy its own integrity rules",
  );

  // ---- qualification is not assumed from a shape --------------------------
  // isProductionRouteQualified is a boolean gate, so the dangerous direction is
  // returning true for something it did not actually parse.
  assert.equal(isProductionRouteQualified(undefined), false, "nothing is not qualified");
  assert.equal(isProductionRouteQualified(null), false, "null is not qualified");
  assert.equal(isProductionRouteQualified({}), false, "an empty object is not qualified");
  assert.equal(isProductionRouteQualified({ status: "qualified" }), false,
    "a bare status field must not qualify a route — the whole receipt has to parse");
  assert.equal(isProductionRouteQualified("qualified"), false, "a string must not qualify a route");

  // ---- the receipt wires reject what they cannot verify -------------------
  for (const [name, assertWire] of [
    ["preflight-ready", assertRoutePreflightReadyReceiptWire],
    ["release-qualified", assertRouteReleaseQualifiedReceiptWire],
  ] as const) {
    for (const [label, value] of [
      ["undefined", undefined],
      ["null", null],
      ["an empty object", {}],
      ["a plausible-looking stub", { version: "wrong", status: "qualified" }],
      ["an array", []],
      ["a string", "qualified"],
    ] as const) {
      assert.throws(
        () => assertWire(value),
        `the ${name} receipt wire must reject ${label} rather than pass it downstream`,
      );
    }
  }

  console.log("UNCALLED VALIDATORS PASS — four unenforced invariants now hold");
}

main();
