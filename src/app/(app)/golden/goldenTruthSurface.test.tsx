import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import GoldenPipelinePage from "./page";

function main(): void {
  const html = renderToStaticMarkup(createElement(GoldenPipelinePage));

  assert.match(html, /Golden evidence and channel admission truth/);
  assert.match(html, /NO GOLDEN PROMOTIONS RECORDED/);
  assert.match(html, /Creator channel admission/);
  assert.match(html, /Universal video foundation/);
  assert.match(html, /8 NON-NEGOTIABLE STAGES/);
  assert.match(html, /Package-to-opening binding/);
  assert.match(html, /Final-master review/);
  assert.match(html, /Automatic/);
  assert.match(html, /Supervised \/ private/);
  assert.match(html, /CATALOG ONLY/);
  assert.match(html, /Studio Asset Library/);
  assert.match(html, /IC controls remain unavailable until exact workflow/);
  assert.match(html, /MANIFEST REFERENCE/);
  assert.match(html, /Legacy video successor queue/);
  assert.match(html, /NO YOUTUBE REPLACEMENT ACTION/);
  assert.match(html, /documotion-fordlandia-video/);
  assert.match(html, /SHA-256/);
  assert.equal(
    html.match(/<details/g)?.length,
    7,
    "five catalog disciplines plus foundation and audit evidence stay collapsed by default",
  );
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.equal(
    html.match(/role="heading" aria-level="2"/g)?.length,
    5,
    "each catalog discipline labels its module-card heading level",
  );
  assert.match(html, /aria-label="Video Engines Golden modules"/);
}

main();
console.log("golden truth surface tests passed");
