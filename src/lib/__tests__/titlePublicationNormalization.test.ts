import assert from "node:assert/strict";

import { normalizeTitleForPublication } from "@/lib/titlePublicationNormalization";

assert.equal(
  normalizeTitleForPublication("Inked Histories: Chernobyl Failed One Safety Test", "Inked Histories"),
  "Chernobyl Failed One Safety Test",
);
assert.equal(
  normalizeTitleForPublication("Chernobyl Failed One Safety Test — Inked Histories", "Inked Histories"),
  "Chernobyl Failed One Safety Test",
);
assert.equal(
  normalizeTitleForPublication("Why Inked Histories Still Matter", "Inked Histories"),
  "Why Still Matter",
);
assert.equal(
  normalizeTitleForPublication("A (Test) Channel: A Clear Promise", "A (Test) Channel"),
  "A Clear Promise",
);
assert.equal(normalizeTitleForPublication("A Clear Promise", "this channel"), "A Clear Promise");
assert.equal(normalizeTitleForPublication("  A Clear Promise  "), "A Clear Promise");

console.log("titlePublicationNormalization: selection and publication share one normalized title");
