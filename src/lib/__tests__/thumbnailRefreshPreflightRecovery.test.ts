import assert from "node:assert/strict";

import { canRetryThumbnailPreflight } from "../thumbnailRefreshPreflightRecovery";

assert.equal(canRetryThumbnailPreflight({
  status: "failed", costTotal: 0, error: "thumbnail_gen: no configured production QA provider",
}), true);
assert.equal(canRetryThumbnailPreflight({
  status: "failed", costTotal: 0, error: "bootstrap: CRITICAL keys missing after vault hydration: OPENROUTER_API_KEY — refusing to run",
}), true);
assert.equal(canRetryThumbnailPreflight({
  status: "failed", costTotal: 0.01, error: "thumbnail_gen: no configured production QA provider",
}), false, "a possibly paid attempt must never be replayed");
assert.equal(canRetryThumbnailPreflight({
  status: "failed", costTotal: 0, error: "FAL request timed out after acceptance",
}), false, "unknown provider delivery is not safely retryable");
assert.equal(canRetryThumbnailPreflight({
  status: "ok", costTotal: 0, error: "thumbnail_gen: no configured production QA provider",
}), false);

console.log("thumbnail preflight recovery policy: PASS");
