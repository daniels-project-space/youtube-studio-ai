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
assert.doesNotMatch(
  source,
  /operator-login|Sign in again|Operator access/,
  "public viewer recovery must never send the browser back to an operator gate",
);
assert.match(
  source,
  /onClick=\{\(\) => window\.location\.reload\(\)\}/,
  "Retry must perform a real token/subscription reload",
);
assert.match(
  source,
  /Rendering and publishing remain paused until it reconnects\./,
  "the connection fallback must state that it does not fabricate or start work",
);
assert.match(
  source,
  /<StudioSessionGate state="loading" \/>/,
  "loading and unavailable states should use the same compact, scoped shell",
);
assert.doesNotMatch(source, /StudioMark|styles\.orbit|styles\.rail|glass-shine/,
  "the connection state must remain a compact utility, not a decorative screen");

console.log("Convex client auth gate regression tests passed");
