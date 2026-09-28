import assert from "node:assert/strict";
import { classifyLegacyR2Key, planLegacyR2Retention, referencesInDocument, validateLegacyInventory } from "../legacyR2RetentionCensus";

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 28);
const record = (key: string, ageDays: number) => ({
  bucket: "youtube-studio-ai", key, size: 10, etag: `etag-${key}`,
  lastModified: new Date(now - ageDays * day).toISOString(),
});
const generated = "owner/a/channel/b/footage/run/r/clip_1.mp4";
const final = "videocraft/story/final_2k.mp4";
const fixedFinal = "owner/a/channel/b/runs/r/final.mp4";
const thumb = "owner/a/channel/b/runs/r/thumbnail.png";
const reusable = "owner/a/channel/b/library/reusable-media/v1/abc.mp4";

assert.equal(classifyLegacyR2Key(fixedFinal), "possible_final");
assert.equal(classifyLegacyR2Key(thumb), "protected");
assert.equal(classifyLegacyR2Key(reusable), "protected");
assert.equal(classifyLegacyR2Key("imagecraft/test/img1.png"), "protected");
const refs = referencesInDocument({ _id: "row1", nested: { media: `https://example.test/${encodeURIComponent(generated)}` } }, "assets", [generated]);
assert.deepEqual(refs.get(generated), [{ table: "assets", id: "row1", path: "nested.media" }]);
const protectedRefs = referencesInDocument({ _id: "old1", thumb }, "historicalTable", [thumb]);
assert.deepEqual(protectedRefs.get(thumb), [{ table: "historicalTable", id: "old1", path: "thumb" }]);
const rows = planLegacyR2Retention([
  record(generated, 31), record(final, 181), record(fixedFinal, 181),
  record(thumb, 400), record(reusable, 400), record("lustig/film/clips/x.mp4", 29),
], new Map([...refs, ...protectedRefs]), now);
assert.equal(rows[0].decision, "preserve");
assert.match(rows[0].reason, /referenced/u);
assert.equal(rows[1].decision, "preserve");
assert.match(rows[1].reason, /release timestamp/u);
assert.equal(rows[2].decision, "preserve");
assert.equal(rows[3].decision, "preserve");
assert.equal(rows[3].references.length, 1);
assert.equal(rows[4].decision, "preserve");
assert.equal(rows[5].decision, "preserve");
assert.equal(planLegacyR2Retention([record(generated, 31)], new Map(), now)[0].decision, "review_unreferenced");
assert.throws(() => validateLegacyInventory([record(generated, 31), record(generated, 31)]), /duplicate/u);
assert.throws(() => validateLegacyInventory([{ ...record(generated, 31), bucket: "personal-travel-film-editor" }]), /Studio bucket/u);
console.log("legacy R2 census boundaries passed");
