import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeChildrenReviewDraft } from "../childrenReviewIntake";

const draft = {
  channelName: "  Little Lantern  ",
  ageBand: "preschool" as const,
  learningObjective: "  Sort objects by color  ",
  curriculumDraft: "A first lesson about colors with three spoken examples and a sorting prompt.",
  showBibleDraft: "Original gentle guide, original lantern world, repeated invitation, and recall.",
};

assert.equal(normalizeChildrenReviewDraft(draft, false).channelName, "Little Lantern");
assert.equal(normalizeChildrenReviewDraft(draft, true).learningObjective, "Sort objects by color");
assert.doesNotThrow(() => normalizeChildrenReviewDraft({ ...draft, learningObjective: "" }, false));
assert.throws(() => normalizeChildrenReviewDraft({ ...draft, learningObjective: "" }, true), /review handoff needs/);
assert.throws(() => normalizeChildrenReviewDraft({ ...draft, curriculumDraft: "brief" }, true), /review handoff needs/);
assert.throws(() => normalizeChildrenReviewDraft({ ...draft, channelName: "x" }, false), /Enter a channel name/);
assert.throws(() => normalizeChildrenReviewDraft({ ...draft, showBibleDraft: "x".repeat(4_001) }, false), /exceeds 4000/);
assert.throws(() => normalizeChildrenReviewDraft({ ...draft, ageBand: "teen" as "preschool" }, false), /supported child age band/);

const root = process.cwd();
const schema = readFileSync(join(root, "convex/schema.ts"), "utf8");
const backend = readFileSync(join(root, "convex/childrenReviewIntakes.ts"), "utf8");
const wizard = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");
const desk = readFileSync(join(root, "src/app/(app)/children-review/page.tsx"), "utf8");
const capability = readFileSync(join(root, "src/engine/channelInceptionCapability.ts"), "utf8");

assert.match(schema, /childrenReviewIntakes: defineTable\(/);
assert.match(schema, /\.index\("by_owner_updated", \["ownerId", "updatedAt"\]\)/);
assert.match(backend, /requireOwner\(ctx, args\.ownerId\)/);
assert.match(backend, /\.take\(24\)/);
assert.match(backend, /existing\.ownerId !== args\.ownerId/);
assert.match(backend, /normalizeChildrenReviewDraft\(args, args\.readyForReview\)/);
assert.doesNotMatch(backend, /insert\("channels"|insert\("runs"|publish|approval/i);
assert.match(capability, /reviewHref: "\/children-review"/);
assert.match(wizard, /reviewHandoffHref/);
assert.match(desk, /api\.childrenReviewIntakes\.listMine/);
assert.match(desk, /api\.childrenReviewIntakes\.saveMine/);
assert.match(desk, /No review, approval, notification, render, or release has occurred/);
assert.match(desk, /Sign in as the workspace owner to save a private review draft/);
assert.match(desk, /disabled=\{!owner\}/, "a non-owner must not receive controls that appear writable");

for (const path of [
  "src/trigger/runPipeline.ts",
  "convex/runs.ts",
  "convex/contentPlan.ts",
  "src/engine/pipelineCompiler.ts",
]) {
  assert.doesNotMatch(
    readFileSync(join(root, path), "utf8"),
    /childrenReviewIntakes|normalizeChildrenReviewDraft/,
    `${path} must not consume unapproved child-review drafts`,
  );
}

console.log("Children review-only intake validation and wiring pass");
