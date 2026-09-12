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
  const { ChannelBanner, fallbackPaletteFor, orderedAssetKeys } = require("./ChannelArt") as typeof import("./ChannelArt");

  assert.deepEqual(
    orderedAssetKeys([null, "", " identity.png ", "latest.jpg", " identity.png ", undefined]),
    [" identity.png ", "latest.jpg"],
    "asset candidates stay ordered and duplicate keys are removed",
  );

  const banner = renderToStaticMarkup(
    createElement(ChannelBanner, {
      name: "Test channel",
      niche: "history",
      aspectRatio: "16 / 9",
      palette: ["#111111", "#222222"],
    }),
  );
  assert.match(banner, /aspect-ratio:16 \/ 9/);
  assert.match(banner, /linear-gradient\(135deg, #111111, #222222\)/);
  assert.match(banner, /data-motif="book"/, "artwork-free banners keep the channel motif visible");

  const nameOnlyBanner = renderToStaticMarkup(
    createElement(ChannelBanner, { name: "Rainy Neon Lofi", aspectRatio: "16 / 9" }),
  );
  assert.match(nameOnlyBanner, /data-motif="lofi"/, "channel name still identifies a banner when niche metadata is descriptive");

  assert.deepEqual(
    fallbackPaletteFor({ name: "Inked Histories", niche: "history" }),
    ["#2a1d1b", "#654034", "#d0a46b"],
    "artwork-free history channels get a sepia book palette",
  );
  assert.deepEqual(
    fallbackPaletteFor({ name: "Seaside Ghibli Lofi", niche: "lofi" }),
    ["#10293d", "#236681", "#e0a56f"],
    "an explicit seaside identity takes precedence over the broad lofi niche",
  );
  assert.notDeepEqual(
    fallbackPaletteFor({ name: "Gratitude Springs" }),
    fallbackPaletteFor({ name: "Investory", niche: "finance" }),
    "unarted channels remain visually distinguishable by identity",
  );
} finally {
  loader._load = originalLoad;
}

console.log("channel art tests passed");
