import assert from "node:assert/strict";
import {
  assertAutomaticVideoPlan,
  createAutomaticVideoPlan,
} from "@/lib/automaticVideoPlan";

const plan = createAutomaticVideoPlan({
  moduleIds: ["upload_draft", "metadata", "script_gen", "thumbnail_gen", "qa_visual"],
  family: "narrated_stock",
  contentLane: "narrated_stock",
  niche: "history documentary",
});

assert.equal(plan.mode, "fully_automatic");
assert.equal(plan.titleProfile, "searchable_long");
assert.equal(plan.frameStrategy.discoverySurface, "search");
assert.equal(plan.frameStrategy.scriptEvidenceRequired, true);
assert.equal(plan.artifactPolicy.ownership, "content_addressed_no_overwrite");
assert.equal(plan.controlPolicy.mode, "fully_automatic");
assert.equal(plan.controlPolicy.resume.exactRun, true);
assert.equal(plan.controlPolicy.reuse.strategy, "content_addressed");
assert.equal(plan.controlPolicy.preflight.unified, true);
assert.equal(plan.controlPolicy.deduplication.crossChannel, true);
assert.equal(plan.controlPolicy.batching.maxConcurrent, 3);
assert.equal(plan.controlPolicy.bulkActions.undoable, true);
assert.deepEqual(assertAutomaticVideoPlan(plan), plan);
assert.throws(() => assertAutomaticVideoPlan({ ...plan, fingerprint: "bad" }), /fingerprint mismatch/);
assert.throws(
  () => createAutomaticVideoPlan({ moduleIds: ["metadata", "metadata"] }),
  /automatic video plan module list is invalid|automatic video plan requires compiled modules/,
);

const lofi = createAutomaticVideoPlan({
  moduleIds: ["metadata", "music", "assemble"],
  family: "lofi",
  niche: "seaside ghibli lofi",
});
assert.equal(lofi.titleProfile, "music_loop");
assert.equal(lofi.frameStrategy.format, "music_loop");
assert.equal(lofi.frameStrategy.audienceIntent, "experience");

console.log("automatic video plan contracts passed");
