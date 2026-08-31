import assert from "node:assert/strict";
import {
  isLibraryGroupExpanded,
  LIBRARY_PAGE_SIZE,
  pageLibraryGroup,
} from "./libraryPaging";

const archive = Array.from({ length: 11 }, (_, index) => `video-${index + 1}`);

const initial = pageLibraryGroup(archive);
assert.deepEqual(initial.visible, archive.slice(0, 4));
assert.equal(initial.total, 11);
assert.equal(initial.remaining, 7);
assert.equal(initial.nextBatchSize, 4);

const expanded = pageLibraryGroup(archive, LIBRARY_PAGE_SIZE * 2);
assert.deepEqual(expanded.visible, archive.slice(0, 8));
assert.equal(expanded.remaining, 3);
assert.equal(expanded.nextBatchSize, 3);

const complete = pageLibraryGroup(archive, 40);
assert.deepEqual(complete.visible, archive);
assert.equal(complete.remaining, 0);
assert.equal(complete.nextBatchSize, 0);

const invalid = pageLibraryGroup(archive, Number.NaN);
assert.equal(invalid.visible.length, LIBRARY_PAGE_SIZE);

assert.equal(isLibraryGroupExpanded(0), true);
assert.equal(isLibraryGroupExpanded(1), false);
assert.equal(isLibraryGroupExpanded(0, false), false);
assert.equal(isLibraryGroupExpanded(4, true), true);

console.log("Library progressive archive paging tests passed");
