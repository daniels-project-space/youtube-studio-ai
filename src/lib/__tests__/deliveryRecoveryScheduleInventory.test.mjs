import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
  INDIVIDUAL_DELIVERY_TASKS, SHARED_DELIVERY_TASK,
  verifyDeliveryRecoverySchedules, readScheduleInventory, observeDeliveryRecovery,
} from "../../../scripts/verify-delivery-recovery-schedules.mjs";

const environmentId = "environment-production";
const schedule = (task, overrides = {}) => ({
  id: `schedule-${task}`, task, type: "DECLARATIVE", active: true,
  generator: { type: "CRON", expression: "* * * * *" },
  environments: [{ id: environmentId, type: "PRODUCTION" }], ...overrides,
});
const individual = () => INDIVIDUAL_DELIVERY_TASKS.map(task => schedule(task));
const shared = () => [schedule(SHARED_DELIVERY_TASK)];
const verify = (inventory, mode = "shared") => verifyDeliveryRecoverySchedules({ inventory, mode, environmentId });

test("only the exact active topology receives a cadence estimate", () => {
  assert.equal(verify(individual(), "individual").scheduledStartsPer30Days, 259_200);
  assert.equal(verify(shared()).scheduledStartsPer30Days, 43_200);
  for (const rows of [[], individual(), [...individual(), ...shared()], [...shared(), schedule(SHARED_DELIVERY_TASK, { id: "duplicate" })]]) {
    const result = verify(rows);
    assert.equal(result.verified, false);
    assert.equal(result.scheduledStartsPer30Days, null);
  }
});

test("inactive and foreign schedules do not count; manual duplicates and wrong cadence fail", () => {
  assert.equal(verify([...shared(), ...individual().map(row => ({ ...row, active: false }))]).verified, true);
  assert.equal(verify([...shared(), schedule(INDIVIDUAL_DELIVERY_TASKS[0], {
    environments: [{ id: "environment-other", type: "PRODUCTION" }],
  })]).verified, true);
  for (const overrides of [
    { active: false }, { type: "IMPERATIVE" },
    { generator: { type: "CRON", expression: "*/5 * * * *" } },
    { environments: [{ id: "environment-other", type: "PRODUCTION" }] },
  ]) assert.equal(verify([schedule(SHARED_DELIVERY_TASK, overrides)]).verified, false);
  assert.equal(verify([...shared(), schedule("openrelay-qwen-idle-reaper"), schedule("thumbnail-refresh-dispatcher")]).verified, true,
    "unrelated safety and thumbnail tasks are outside the migration, not disabled by it");
});

test("missing evidence, duplicate IDs and non-production scope cannot pass", () => {
  for (const overrides of [
    { active: undefined }, { environments: undefined },
    { environments: [{ id: environmentId, type: "DEVELOPMENT" }] },
    { environments: [{ id: environmentId, type: "PRODUCTION" }, { id: environmentId, type: "PRODUCTION" }] },
  ]) assert.throws(() => verify([schedule(SHARED_DELIVERY_TASK, overrides)]));
  assert.throws(() => verify([...shared(), ...shared()]), /duplicate/);
  assert.throws(() => verify(shared(), "off"));
  assert.throws(() => verifyDeliveryRecoverySchedules({ inventory: shared(), mode: "shared", environmentId: "" }));
});

function responses(pages) {
  let calls = 0;
  return { calls: () => calls, fetchImpl: async (url, init) => {
    assert.match(url, /^https:\/\/api\.trigger\.dev\/api\/v1\/schedules\?page=\d+&perPage=100$/);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const page = pages[calls++];
    assert.ok(page, "unexpected extra provider request");
    return Response.json(page);
  } };
}
const page = (data, currentPage = 1, totalPages = 1, count = data.length) => ({
  data, pagination: { currentPage, totalPages, count },
});

test("reader consumes every bounded page before evaluating topology", async () => {
  const f = responses([page(individual().slice(0, 3), 1, 2, 6), page(individual().slice(3), 2, 2, 6)]);
  const rows = await readScheduleInventory({ token: "fixture", fetchImpl: f.fetchImpl });
  assert.equal(f.calls(), 2);
  assert.equal(verify(rows, "individual").verified, true);
  for (const pages of [
    [page(shared(), 1, 11, 1)], [page(shared(), 2, 2, 1)], [page(shared(), 1, 1, 2)],
    [page(shared(), 1, 2, 2), page(shared(), 2, 2, 3)],
  ]) {
    const bad = responses(pages);
    await assert.rejects(readScheduleInventory({ token: "fixture", fetchImpl: bad.fetchImpl }));
  }
});

test("two observations must agree and provider error bodies are never surfaced", async () => {
  const good = responses([page(shared()), page(shared())]);
  const result = await observeDeliveryRecovery({ mode: "shared", environmentId, token: "fixture", fetchImpl: good.fetchImpl });
  assert.equal(result.verified, true);
  assert.match(result.scope, /not delivery, load, billing, or deployment/);
  assert.equal(good.calls(), 2);
  const changing = responses([page(shared()), page(individual())]);
  await assert.rejects(observeDeliveryRecovery({ mode: "shared", environmentId, token: "fixture", fetchImpl: changing.fetchImpl }), /disagree/);
  await assert.rejects(readScheduleInventory({ token: "fixture", fetchImpl: async () => {
    return new Response("SECRET_SENTINEL", { status: 403 });
  } }), error => {
    assert.equal(error.message, "Trigger schedule inventory request failed");
    return true;
  });
});

test("verifier inventory tracks actual scheduled task declarations", () => {
  const files = ["bundleFanoutDispatcher", "factualReviewContinuationDispatcher", "musicAuditionContinuationDispatcher",
    "reviewedDataStoryInitialDispatcher", "routeQualificationBenchmarkDispatcher", "serializedProgramEpisodeRetryDispatcher", "sharedDeliveryRecovery"];
  const ids = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(`src/trigger/${file}.ts`, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "schedules.task") {
        const options = node.arguments[0];
        assert.ok(ts.isObjectLiteralExpression(options));
        const id = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "id");
        assert.ok(id && ts.isStringLiteral(id.initializer));
        ids.push(id.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(ids.sort(), [...INDIVIDUAL_DELIVERY_TASKS, SHARED_DELIVERY_TASK].sort());
});
