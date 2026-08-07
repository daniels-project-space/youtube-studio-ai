import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelBanner, orderedAssetKeys } from "./ChannelArt";

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

console.log("channel art tests passed");
