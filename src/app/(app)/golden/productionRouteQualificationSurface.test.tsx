import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = (module) => {
    const classes = new Proxy({}, { get: (_target, key) => String(key) });
    module.exports = { __esModule: true, default: classes };
  };
  const { default: GoldenPipelinePage } = await import("./page");
  const html = renderToStaticMarkup(createElement(GoldenPipelinePage));

  assert.match(html, /Route qualification/);
  assert.match(html, /NO RECEIPT CONNECTED/);
  assert.match(html, /No persisted per-channel qualification receipt is connected to the Golden catalog/i);
  assert.match(html, /Family admission is policy-level information/i);
}

main().then(() => console.log("golden production route qualification surface tests passed"));
