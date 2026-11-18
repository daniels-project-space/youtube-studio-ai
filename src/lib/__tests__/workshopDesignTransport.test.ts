import assert from "node:assert/strict";
import { canonicalJson } from "../canonicalJson";
import { sha256Hex } from "../sha256";
import { parseWorkshopDesignTransport } from "../workshopDesignTransport";

const content = {
  version: "workshop-design-snapshot/v1" as const,
  name: "History draft",
  family: "narrated",
  entries: [{ block: "script_gen", version: "1.0.0", params: { style: "essay", recap: false } }],
};
const design = { ...content, fingerprint: sha256Hex(canonicalJson(content)) };

assert.deepEqual(parseWorkshopDesignTransport(design), design);
assert.throws(() => parseWorkshopDesignTransport({ ...design, name: "Changed" }), /fingerprint/);
assert.throws(() => parseWorkshopDesignTransport({ ...design, approved: true }));
assert.throws(() => parseWorkshopDesignTransport({ ...design, entries: [] }));
assert.throws(() => parseWorkshopDesignTransport({ ...design, family: "../other" }));
assert.throws(() => parseWorkshopDesignTransport({ ...design, fingerprint: "invalid" }));
const largeContent = { ...content, entries: [{ block: "script_gen", params: { note: "\u6587".repeat(41_000) } }] };
assert.throws(() => parseWorkshopDesignTransport({ ...largeContent, fingerprint: sha256Hex(canonicalJson(largeContent)) }), /size limit/);

const reordered = { ...design, entries: [{ ...content.entries[0], params: { recap: false, style: "essay" } }] };
assert.deepEqual(parseWorkshopDesignTransport(reordered), reordered);

const contentV2 = { ...content, version: "workshop-design-snapshot/v2" as const, channelDesign: { revision: 2, name: "History", niche: "Science", persona: "Curious", palette: ["#123456"] } };
const designV2 = { ...contentV2, fingerprint: sha256Hex(canonicalJson(contentV2)) };
assert.deepEqual(parseWorkshopDesignTransport(designV2), designV2);
for (const channelDesign of [
  { ...contentV2.channelDesign, persona: "Tampered" },
  { ...contentV2.channelDesign, revision: 0 },
  { ...contentV2.channelDesign, palette: ["red"] },
  { ...contentV2.channelDesign, approved: true },
]) assert.throws(() => parseWorkshopDesignTransport({ ...designV2, channelDesign }));
assert.throws(() => parseWorkshopDesignTransport({ ...designV2, channelDesign: undefined }));
assert.throws(() => parseWorkshopDesignTransport({ ...designV2, version: "workshop-design-snapshot/v3" }));
