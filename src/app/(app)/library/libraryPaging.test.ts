import assert from "node:assert/strict";
import { LIBRARY_PAGE_SIZE, pageLibraryGroup } from "./libraryPaging";

const archive = Array.from({ length: 11 }, (_, index) => `video-${index + 1}`);

const initial = pageLibraryGroup(archive);
assert.deepEqual(initial.visible, archive.slice(0, 8));
assert.equal(initial.total, 11);
assert.equal(initial.remaining, 3);
assert.equal(initial.nextBatchSize, 3);

const expanded = pageLibraryGroup(archive, LIBRARY_PAGE_SIZE * 2);
assert.deepEqual(expanded.visible, archive);
assert.equal(expanded.remaining, 0);
assert.equal(expanded.nextBatchSize, 0);

const complete = pageLibraryGroup(archive, 40);
assert.deepEqual(complete.visible, archive);
assert.equal(complete.remaining, 0);
assert.equal(complete.nextBatchSize, 0);

const invalid = pageLibraryGroup(archive, Number.NaN);
assert.equal(invalid.visible.length, LIBRARY_PAGE_SIZE);

console.log("Library progressive archive paging tests passed");
