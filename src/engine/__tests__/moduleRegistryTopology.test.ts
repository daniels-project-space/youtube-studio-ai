import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerAllBlocks } from "@/engine/blocks";
import { designPipeline } from "@/engine/designer";
import { FAMILY_KEYS, familyDurationContract } from "@/engine/families";
import { MODULE_REGISTRY, moduleCard, moduleSurface } from "@/engine/moduleRegistry";
import { allManifests } from "@/engine/registry";
import { resolvePipelineModuleConfig } from "@/engine/runtimeModuleConfig";

/**
 * The browser-safe module registry is the topology a creator and the future
 * Pipeline Architect can reason about. A module without a card may still run,
 * but it is invisible to composition, locking, and operator explanation — a
 * structural lie. Check every executable manifest, then every currently
 * designed family graph, rather than keeping a brittle hand-maintained subset.
 */
registerAllBlocks();

const executableIds = allManifests().map((manifest) => manifest.id).sort();
const missingExecutableCards = executableIds.filter((blockId) => !moduleCard(blockId));
assert.deepEqual(
  missingExecutableCards,
  [],
  "every registered executable block must have a browser-safe module card",
);

const intentionalVirtualCards = new Set(["show-bible"]);
const staleRegistryCards = Object.keys(MODULE_REGISTRY)
  .filter((blockId) => !executableIds.includes(blockId) && !intentionalVirtualCards.has(blockId))
  .sort();
assert.deepEqual(
  staleRegistryCards,
  [],
  "registry cards must either describe a registered executable or an explicit virtual configuration module",
);

for (const [blockId, card] of Object.entries(MODULE_REGISTRY)) {
  assert.ok(card.role, `${blockId} must declare one bounded pipeline responsibility`);
  assert.ok(card.title.trim(), `${blockId} must have a human-readable title`);
  assert.ok(card.does?.trim(), `${blockId} must explain its bounded responsibility`);
}

const sharedReleaseFoundation = ["package_to_opening_plan", "thumbnail_gen", "qa_visual", "upload_draft"];

for (const family of FAMILY_KEYS) {
  const design = designPipeline({
    family,
    nicheKey: "history",
    lengthMinutes: familyDurationContract(family).defaultSeconds / 60,
    publishMode: "draft",
  });
  if (!design.available) continue;

  const blocks = design.pipeline.map((entry) => entry.block);
  for (const blockId of blocks) {
    assert.ok(
      moduleCard(blockId),
      `${family} emits ${blockId}, but the module topology has no card for it`,
    );
  }
  for (const blockId of sharedReleaseFoundation) {
    assert.ok(blocks.includes(blockId), `${family} must retain the shared ${blockId} release foundation`);
  }
  assert.ok(
    blocks.indexOf("package_to_opening_plan") < blocks.indexOf("thumbnail_gen") &&
      blocks.indexOf("thumbnail_gen") < blocks.indexOf("qa_visual") &&
      blocks.indexOf("qa_visual") < blocks.indexOf("upload_draft"),
    `${family} must package before thumbnailing, review the final master, then deliver`,
  );

  // Creation resolves controls before persistence. Exercise a real selected
  // knob for every family and prove the validated choice reaches the frozen
  // config exactly once; no route can quietly drop it at this boundary.
  const configurable = design.pipeline
    .map((entry) => ({ entry, surface: moduleSurface(entry.block) }))
    .find((candidate) => (candidate.surface?.knobs.length ?? 0) > 0);
  assert.ok(configurable, `${family} must expose at least one selected configurable module`);
  const knob = configurable!.surface!.knobs[0]!;
  const resolved = resolvePipelineModuleConfig({
    entries: design.pipeline,
    moduleConfig: {
      [configurable!.entry.block]: { [knob.id]: knob.default },
    },
  });
  assert.deepEqual(resolved.skippedBlockIds, []);
  assert.deepEqual(
    resolved.frozenModuleConfig[configurable!.entry.block],
    { [knob.id]: knob.default },
    `${family} must retain the selected ${configurable!.entry.block}.${knob.id} control through creation resolution`,
  );
}

console.log(
  `MODULE REGISTRY TOPOLOGY PASS — ${executableIds.length} executable cards, ${FAMILY_KEYS.length} family graphs`,
);

// Convex owns the final persistence boundary. Preview resolution already
// rejects unknown controls; keep the mutation equally strict so a direct or
// stale client cannot make a visible configuration disappear at write time.
const channelMutation = readFileSync(join(process.cwd(), "convex", "channels.ts"), "utf8");
assert.match(
  channelMutation,
  /if \(!configurable\.has\(blockId\)\) \{\s*throw new Error\(`moduleConfig: '\$\{blockId\}' is unknown or non-configurable`\);\s*\}/,
  "createChannel must fail closed for unknown or non-configurable moduleConfig keys",
);
assert.doesNotMatch(
  channelMutation,
  /if \(!configurable\.has\(blockId\)\) continue/,
  "createChannel must never silently drop a submitted moduleConfig key",
);
