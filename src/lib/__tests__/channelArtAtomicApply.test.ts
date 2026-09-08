import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const channels = await readFile(
    new URL("../../../convex/channels.ts", import.meta.url),
    "utf8",
  );
  const start = channels.indexOf("export const applyChannelArtAsset");
  const end = channels.indexOf("export const updateChannel", start);
  assert(start >= 0 && end > start, "the dedicated atomic channel-art mutation must exist");
  const mutation = channels.slice(start, end);

  assert.match(mutation, /requireStudioServiceIdentity\(ctx, args\.ownerId/,
    "browser clients must not be able to manufacture trusted art provenance");
  assert.match(mutation, /currentKey !== args\.expectedAssetKey/,
    "the mutation must compare the pre-render asset revision inside the write transaction");
  assert.match(mutation, /mergeChannelArtProvenance\(/,
    "the mutation must preserve unrelated current identity and sibling art proof");
  assert.match(mutation, /assessChannelArtFreshness\(/,
    "direction, output, prompt, and approval bindings must be rechecked at write time");
  assert.match(mutation, /patchChannelRespectingLock\(/,
    "a channel lock must still win if it is applied while the provider is rendering");
  assert.doesNotMatch(mutation, /\.\.\.args\.identity/,
    "the caller must not submit a pre-render identity snapshot for replay");

  for (const [path, pattern] of [
    ["../../app/api/channel-art/refresh/route.ts", /api\.channels\.applyChannelArtAsset/],
    ["../../trigger/designChannelInception.ts", /api\.channels\.applyChannelArtAsset/],
    ["../../../scripts/refresh-channel-banners.ts", /api\.channels\.applyChannelArtAsset/],
  ] as const) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, pattern, `${path} must consume the atomic art apply mutation`);
  }

  console.log("CHANNEL ART ATOMIC APPLY PASS");
}

void main();
