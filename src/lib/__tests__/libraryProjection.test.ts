import assert from "node:assert/strict";
import {
  libraryRunCreatedAt,
  matchesLibraryRunScope,
  matchesLibraryTitle,
} from "../libraryProjection";

const base = {
  ownerId: "owner-a",
  status: "ok",
  _creationTime: 100,
};

assert.equal(libraryRunCreatedAt(base), 100);
assert.equal(libraryRunCreatedAt({ ...base, startedAt: 125 }), 125);
assert.equal(libraryRunCreatedAt({ ...base, startedAt: 0 }), 0);

assert.equal(matchesLibraryRunScope(base, { ownerId: "owner-a" }), true);
assert.equal(matchesLibraryRunScope({ ...base, ownerId: "owner-b" }, { ownerId: "owner-a" }), false);
assert.equal(matchesLibraryRunScope({ ...base, status: "failed" }, { ownerId: "owner-a", status: "ok" }), false);
assert.equal(matchesLibraryRunScope({ ...base, libraryState: "archived" }, { ownerId: "owner-a" }), false);
assert.equal(matchesLibraryRunScope({ ...base, libraryState: "archived" }, { ownerId: "owner-a", includeArchived: true }), true);
assert.equal(matchesLibraryRunScope({ ...base, startedAt: 220 }, { ownerId: "owner-a", from: 200 }), true);
assert.equal(matchesLibraryRunScope({ ...base, startedAt: 220 }, { ownerId: "owner-a", to: 200 }), false);

assert.equal(matchesLibraryTitle("Taxation Isn't Complex", "taxation"), true);
assert.equal(matchesLibraryTitle("Taxation Isn't Complex", "lofi"), false);
assert.equal(matchesLibraryTitle("Taxation Isn't Complex", ""), true);

console.log("Library projection scope and filter tests passed");
