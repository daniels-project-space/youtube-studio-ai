import assert from "node:assert/strict";
import { orderLibraryVideos } from "../libraryOrder";

const rows = Object.freeze([
  Object.freeze({ _id: "b", createdAt: 200, estimatedViews: 28_000_000 }),
  Object.freeze({ _id: "c", createdAt: 100, estimatedViews: 1 }),
  Object.freeze({ _id: "a", createdAt: 200, estimatedViews: 0 }),
  Object.freeze({ _id: "d", createdAt: 300, estimatedViews: undefined }),
]);
assert.deepEqual(orderLibraryVideos(rows, "date").map(row => row._id), ["d", "a", "b", "c"]);
assert.deepEqual(orderLibraryVideos(rows, "oldest").map(row => row._id), ["c", "a", "b", "d"]);
assert.deepEqual(rows.map(row => row._id), ["b", "c", "a", "d"], "sorting cannot reorder the shared query result");
assert.deepEqual(orderLibraryVideos([], "date"), []);
assert.deepEqual(orderLibraryVideos(rows.slice(0, 1), "oldest"), rows.slice(0, 1));
assert.deepEqual(orderLibraryVideos([...rows].reverse(), "date").map(row => row._id), ["d", "a", "b", "c"], "equal timestamps have stable record-ID ordering");
for (const row of orderLibraryVideos(rows, "date")) assert.equal(row, rows.find(original => original._id === row._id), "sorting must preserve exact source records and historical metadata");
console.log("Library date ordering passes: both directions, ties, no forecasts, immutable input and exact source rows");
