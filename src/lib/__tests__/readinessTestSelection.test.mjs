import assert from "node:assert/strict";
import { test } from "node:test";
import { selectReadinessTests } from "../../../scripts/readiness-test-selection.mjs";

const files = ["src/lib/music.test.ts", "src/lib/thumbnailBatch.test.ts", "src/app/thumbnail-refresh/route.test.ts", "src/lib/goldenThumbnail.test.ts", "scripts/assembly-parity.ts"];
test("default production readiness keeps every test", () => {
  assert.deepEqual(selectReadinessTests(files, []), { tests: files, excluded: [], partial: false });
});
test("explicit thumbnail exclusion is partial and keeps non-thumbnail checks", () => {
  assert.deepEqual(selectReadinessTests(files, ["--exclude-thumbnail"]), {
    tests: [files[0], files[4]], excluded: files.slice(1, 4), partial: true,
  });
});
test("misspelled or repeated flags fail instead of silently changing coverage", () => {
  for (const argv of [["--skip"], ["--exclude-thumbnail", "--exclude-thumbnail"], ["--exclude-thumbnail", "music"]]) {
    assert.throws(() => selectReadinessTests(files, argv), /Usage/);
  }
});
