import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "convex/analytics.ts"), "utf8");
const trend = source.slice(source.indexOf("export const channelTrend"), source.indexOf("export const overview"));

assert.match(trend, /const channel = await ctx\.db\.get\(args\.channelId\)/);
assert.match(trend, /channel\.ownerId !== args\.ownerId/);
assert.match(trend, /\.order\("desc"\)/);
assert.match(trend, /\.take\(window\)/);
assert.match(trend, /Math\.min\(Math\.floor\(args\.days\), 365\)/);
assert.doesNotMatch(trend, /\.collect\(\)/, "channelTrend must not collect unbounded history");

console.log("analytics channel trend bounded-read contract passed");
