import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/plan-week/bulk/route.ts"), "utf8");
assert.match(source, /export async function GET/);
assert.match(source, /requireStudioActor\(request\)/);
assert.match(source, /ownerId: actor\.ownerId/);
assert.match(source, /api\.channels\.listChannels/);
assert.match(source, /channel access denied/);
assert.doesNotMatch(source, /ownerId: OWNER_ID/,
  "bulk admission must use the authenticated operator's owner scope, not a process-global fallback");
assert.match(source, /api\.planWeekBulkOrders\.getByFingerprint/);
assert.match(source, /api\.planWeekBulkOrders\.getByRequestKey/);
assert.match(source, /Cache-Control.*private, no-store/);
assert.match(source, /bulk order not found/);
assert.match(source, /fingerprint: order\.fingerprint/);
assert.match(source, /completed:.*succeeded/);
assert.match(source, /startedAt: child\.startedAt/);
assert.match(source, /finishedAt: child\.finishedAt/);
console.log("plan-week bulk status route contracts passed");
