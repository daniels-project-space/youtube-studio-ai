import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./ConvexClientProvider.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /const fetchAccessToken = useCallback\(/,
  "Convex auth token callback must keep a stable identity to avoid repeated token requests",
);
assert.doesNotMatch(
  source,
  /fetchAccessToken:\s*\(\{/,
  "do not recreate the Convex auth callback in the hook return object",
);
assert.match(
  source,
  /<StudioConvexAuthGate>\{children\}<\/StudioConvexAuthGate>/,
  "authenticated queries must remain unmounted until Convex confirms the token",
);

console.log("Convex client auth gate regression tests passed");
