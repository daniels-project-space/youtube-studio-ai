import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import GoldenPipelinePage from "./page";

const html = renderToStaticMarkup(createElement(GoldenPipelinePage));

assert.match(html, /Route qualification/);
assert.match(html, /NO RECEIPT CONNECTED/);
assert.match(html, /No persisted per-channel qualification receipt is connected to the Golden catalog/i);
assert.match(html, /Family admission is policy-level information/i);

console.log("golden production route qualification surface tests passed");
