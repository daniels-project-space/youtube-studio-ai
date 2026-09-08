import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dailyBuckets, hasBucketActivity } from "@/lib/runStats";

const now = Date.UTC(2026, 8, 8, 12);
const recent = dailyBuckets([{ status: "ok", startedAt: now, costTotal: 0.25 }], 14, now);
assert.equal(hasBucketActivity(recent), true, "a recent run must keep the activity charts visible");

const stale = dailyBuckets([{ status: "failed", startedAt: now - 40 * 86_400_000 }], 14, now);
assert.equal(hasBucketActivity(stale), false, "old runs must not produce empty recent charts");

const here = fileURLToPath(new URL(".", import.meta.url));
const component = readFileSync(`${here}/StatsCharts.tsx`, "utf8");
assert.match(component, /if \(runs\.length === 0\) return null/);
assert.match(component, /\{hasRecentActivity \? \(/);
assert.match(component, /data-recent-activity=\{hasRecentActivity\}/);
assert.match(component, /<OutcomeCard/);

console.log("StatsCharts density contracts passed");
