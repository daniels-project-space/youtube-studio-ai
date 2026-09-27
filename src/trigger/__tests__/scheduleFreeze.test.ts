import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const expected = new Set([
  "automatic-thumbnail-replacement-dispatcher", "bundle-fanout-dispatcher",
  "factual-review-continuation-dispatcher", "generation-scheduler", "learning-refresh",
  "music-audition-continuation-dispatcher", "openrelay-h3-idle-reaper",
  "openrelay-qwen-idle-reaper", "pipeline-doctor", "publish-intent-scheduler",
  "r2-asset-retention-sweeper", "refresh-niche-research-weekly",
  "reviewed-data-story-initial-dispatcher", "route-qualification-benchmark-dispatcher",
  "run-artifact-retention-sweeper", "seo-reoptimize", "serialized-program-episode-retry-dispatcher",
  "stats-refresh-6h", "thumbnail-performance-pull",
  "thumbnail-refresh-dispatcher", "title-ctr-swap", "weekly-operations-digest",
  "weekly-plan-ahead", "weekly-plan-ahead-recovery",
]);

const found: string[] = [];
for (const file of readdirSync(join(process.cwd(), "src/trigger")).filter(name => name.endsWith(".ts"))) {
  const source = ts.createSourceFile(file, readFileSync(join(process.cwd(), "src/trigger", file), "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "schedules.task") {
      const options = node.arguments[0];
      assert.ok(ts.isObjectLiteralExpression(options), `${file}: schedule options must be inspectable`);
      const id = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "id");
      assert.ok(id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer), `${file}: schedule must have a literal ID`);
      found.push(id.initializer.text);
      assert.ok(options.properties.every(property => !ts.isSpreadAssignment(property) &&
        !(ts.isPropertyAssignment(property) && property.name.getText(source) === "cron")),
      `${file}: ${id.initializer.text} must remain without a declarative cron while Studio is paused`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(new Set(found), expected, "new or removed schedules require an explicit freeze review");
assert.equal(found.length, expected.size, "schedule IDs must remain unique");
for (const [file, id] of [
  ["novita4090Reaper.ts", "novita-4090-reaper"],
  ["sharedDeliveryRecovery.ts", "shared-delivery-recovery"],
]) {
  const source = readFileSync(join(process.cwd(), "src/trigger", file), "utf8");
  assert.match(source, new RegExp(`export const \\w+ = task\\(\\{\\s*id: "${id}"`),
    `${id} must remain an on-demand task`);
  assert.doesNotMatch(source, /\bcron\s*:/, `${id} must remain without a declarative cron`);
}
