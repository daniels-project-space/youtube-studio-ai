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
const resolver = convex.slice(convex.indexOf("export const resolveForPipeline = query"));
assert.match(
  resolver,
  /withIndex\("by_owner_scope"[\s\S]*?eq\("scope", "owned_studio"\)[\s\S]*?withIndex\("by_channel"[\s\S]*?eq\("channelId", request\.channelId(?: as Id<"channels">)?\)/,
  "pipeline resolution should merge indexed portable and channel-scoped assets",
);
assert.doesNotMatch(
  resolver,
  /withIndex\("by_owner", \(q\) => q\.eq\("ownerId", args\.ownerId\)\)\n\s*\.collect\(\)/,
  "pipeline resolution must not scan every historical owner asset",
);
assert.match(
  resolver,
  /export const resolveManyForPipeline = query[\s\S]*?withIndex\("by_owner_scope"[\s\S]*?withIndex\("by_channel"[\s\S]*?withIndex\("by_owner_context"/,
  "batch resolution should share the indexed catalog while keeping context observations scoped",
);

console.log("STUDIO ASSET LIBRARY READ CONTRACTS PASS");
