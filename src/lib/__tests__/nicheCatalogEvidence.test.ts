import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NICHE_CATALOG_EVIDENCE, NICHES } from "@/lib/nicheCatalog";

assert.equal(NICHE_CATALOG_EVIDENCE.status, "curated_planning_seed");
assert.equal(NICHE_CATALOG_EVIDENCE.measured, false);
assert.match(NICHE_CATALOG_EVIDENCE.label, /validate demand and RPM/i);
assert(NICHES.length > 0, "the catalog must retain its deterministic planning choices");

const creatorPath = join(process.cwd(), "src/app/(app)/channels/new/page.tsx");
const creatorSource = readFileSync(creatorPath, "utf8");
assert.match(creatorSource, /NICHE_CATALOG_EVIDENCE\.label/);
assert.doesNotMatch(creatorSource, /\$\{n\.rpm\}\s*RPM/);
assert.doesNotMatch(creatorSource, /s\.searchVolume/);
assert.doesNotMatch(creatorSource, /s\.rpm/);

const settingsPath = join(process.cwd(), "src/app/(app)/channels/[slug]/page.tsx");
const settingsSource = readFileSync(settingsPath, "utf8");
assert.match(settingsSource, /NICHE_CATALOG_EVIDENCE\.label/);
assert.doesNotMatch(settingsSource, /s\.searchVolume/);
assert.doesNotMatch(settingsSource, /s\.rpm/);

console.log("niche catalog seed-evidence display tests passed");
