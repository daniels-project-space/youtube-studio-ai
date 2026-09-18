import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const preview = readFileSync(resolve(root, "src/components/ThumbnailRefreshInventoryPanel.tsx"), "utf8");
const audit = readFileSync(resolve(root, "scripts/ui-fifth-pass-audit.mjs"), "utf8");

assert.match(preview, /data-preview-state=\{previewState\}/);
assert.match(preview, /loadedPreviewUrl === src/,
  "a resolved preview URL must not be reported ready before its image completes");
assert.match(preview, /onLoad=\{\(\) => setLoadedPreviewUrl\(src\)\}/);
assert.match(preview, /"ready" : "loading"/);
assert.match(preview, /"unavailable"/);
assert.match(preview, /data-thumbnail-review-inventory-state=/);
assert.match(audit, /data-thumbnail-review-inventory-state="loading"/,
  "the visual audit must wait for inventory hydration before checking thumbnail images");

console.log("THUMBNAIL REFRESH PREVIEW STATE CONTRACT PASS");
