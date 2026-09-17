import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../../../convex/schema.ts", import.meta.url), "utf8");
const convex = readFileSync(new URL("../../../convex/studioAssetLibrary.ts", import.meta.url), "utf8");

assert.match(schema, /studioAssetLibraryEntries: defineTable/);
assert.match(schema, /\.index\("by_owner_scope", \["ownerId", "scope"\]\)/);
assert.match(
  convex,
  /export const listForChannel = query[\s\S]*?withIndex\("by_owner_scope"[\s\S]*?eq\("scope", "owned_studio"\)[\s\S]*?withIndex\("by_channel"/,
  "channel asset inventory should merge indexed studio and channel scopes",
);
assert.doesNotMatch(
  convex.slice(convex.indexOf("export const listForChannel = query"), convex.indexOf("export const listInventory = query")),
  /withIndex\("by_owner", \(q\) => q\.eq\("ownerId", args\.ownerId\)\)\n\s*\.collect\(\)/,
  "channel asset inventory must not scan every owner asset",
);

console.log("STUDIO ASSET LIBRARY READ CONTRACTS PASS");
