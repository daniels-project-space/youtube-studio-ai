import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ChannelArt's fallback glyph is a real CSS-module component. Keep this
// server contract test executable under tsx without pretending CSS is JS.
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
loader._load = function (...args: unknown[]) {
  if (String(args[0]).endsWith(".module.css")) {
    return { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) };
  }
  return originalLoad.apply(this, args);
};

try {
  const { ChannelBanner, orderedAssetKeys } = require("./ChannelArt") as typeof import("./ChannelArt");

  assert.deepEqual(
    orderedAssetKeys([null, "", " identity.png ", "latest.jpg", " identity.png ", undefined]),
    [" identity.png ", "latest.jpg"],
    "asset candidates stay ordered and duplicate keys are removed",
  );

  const banner = renderToStaticMarkup(
    createElement(ChannelBanner, {
      name: "Test channel",
      aspectRatio: "16 / 9",
      palette: ["#111111", "#222222"],
    }),
  );
  assert.match(banner, /aspect-ratio:16 \/ 9/);
  assert.match(banner, /linear-gradient\(135deg, #111111, #222222\)/);
} finally {
  loader._load = originalLoad;
}

console.log("channel art tests passed");
