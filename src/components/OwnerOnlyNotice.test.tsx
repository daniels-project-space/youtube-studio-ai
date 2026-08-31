import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerOnlyNotice } from "./OwnerOnlyNotice";

const locked = renderToStaticMarkup(
  createElement(OwnerOnlyNotice, {
    access: "viewer",
    desk: "the render console",
  }),
);
assert.match(locked, /Owner-only desk/);
assert.match(locked, /Operations are locked/);
assert.match(locked, /No private data request was sent/);
assert.match(locked, /data-access-state="viewer"/);

const checking = renderToStaticMarkup(
  createElement(OwnerOnlyNotice, {
    access: "checking",
    desk: "the evidence desk",
  }),
);
assert.match(checking, /Checking owner access/);
assert.match(checking, /aria-live="polite"/);
assert.doesNotMatch(checking, /Operations are locked/);

console.log("Owner-only notice presentation tests passed");
