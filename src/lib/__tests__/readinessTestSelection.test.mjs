import assert from "node:assert/strict";
import { test } from "node:test";
import { selectReadinessTests } from "../../../scripts/readiness-test-selection.mjs";

const files = ["src/lib/music.test.ts", "src/lib/thumbnailBatch.test.ts", "src/app/thumbnail-refresh/route.test.ts", "src/lib/goldenThumbnail.test.ts", "scripts/assembly-parity.ts"];
test("default production readiness keeps every test", () => {
  assert.deepEqual(selectReadinessTests(files, []), { tests: files, excluded: [], partial: false });
});
test("explicit thumbnail exclusion is partial and keeps non-thumbnail checks", () => {
  assert.deepEqual(selectReadinessTests(files, ["--exclude-thumbnail"], () => "safe fixture"), {
    tests: [files[0], files[4]], excluded: files.slice(1, 4), partial: true,
  });
});
test("mixed files with direct thumbnail references are excluded before execution", () => {
  const paths = ["mixed-recovery.test.ts", "safe-music.test.ts"];
  const readSource = path => path === paths[0] ? 'runLegacyThumbnailFixture()' : 'runMusicFixture()';
  assert.deepEqual(selectReadinessTests(paths, ["--exclude-thumbnail"], readSource), {
    tests: [paths[1]], excluded: [paths[0]], partial: true,
  });
});
test("default gate never consults exclusion content and partial reads fail closed", () => {
  const unreadable = () => { throw new Error("read failed"); };
  assert.deepEqual(selectReadinessTests(files, [], unreadable).tests, files);
  assert.throws(() => selectReadinessTests(files, ["--exclude-thumbnail"], unreadable), /read failed/);
});
test("misspelled or repeated flags fail instead of silently changing coverage", () => {
  for (const argv of [["--skip"], ["--exclude-thumbnail", "--exclude-thumbnail"], ["--exclude-thumbnail", "music"]]) {
    assert.throws(() => selectReadinessTests(files, argv), /Usage/);
  }
});
