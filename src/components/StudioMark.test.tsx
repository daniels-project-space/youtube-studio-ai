import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioMark } from "./StudioMark";

const decorative = renderToStaticMarkup(<StudioMark />);
assert.match(decorative, /data-studio-mark="pipeline"/);
assert.match(decorative, /aria-hidden="true"/);
assert.equal((decorative.match(/data-node="source"/g) ?? []).length, 3);
assert.equal((decorative.match(/data-node="artifact"/g) ?? []).length, 1);
assert.equal((decorative.match(/data-node="release"/g) ?? []).length, 1);

const labelled = renderToStaticMarkup(<StudioMark title="AutoStudio" />);
assert.match(labelled, /role="img"/);
assert.match(labelled, /<title>AutoStudio<\/title>/);
assert.doesNotMatch(labelled, /aria-hidden/);

console.log("Studio pipeline mark contracts passed");
