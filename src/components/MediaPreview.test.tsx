import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaPreviewPresentation } from "./MediaPreview";

// Exercise the real components and selection logic without signing private URLs.
// Only the browser URL hook and CSS loader are replaced in this server-render test.
const requestedKeys: string[] = [];
const currentKey = "owner/test/channel/taxes/runs/current/thumbnail.png";
const oldKey = "owner/test/channel/taxes/runs/original/thumbnail.jpg";
const source = "https://media.example.test/current.png";
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
loader._load = function (...args: unknown[]) {
  const request = String(args[0]);
  if (request.endsWith(".module.css")) {
    return { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) };
  }
  if (request === "@/lib/asset-url") {
    return {
      useAssetUrlState(key?: string | null) {
        if (key) requestedKeys.push(key);
        return { url: key ? source : null, status: key ? "ready" : "idle" };
      },
    };
  }
  return originalLoad.apply(this, args);
};

try {
  const { MediaPreview } = require("./MediaPreview") as typeof import("./MediaPreview");
  const { RunMediaWorkbench } = require("./RunMediaWorkbench") as typeof import("./RunMediaWorkbench");
  const presentations: MediaPreviewPresentation[] = [];
  const markup = renderToStaticMarkup(createElement("article", null, createElement(MediaPreview, {
    assetKey: currentKey,
    alt: "Current thumbnail",
    footer: (presentation) => {
      presentations.push(presentation);
      return createElement("footer", null,
        createElement("a", { href: presentation.src ?? undefined }, "Open source"));
    },
  })));
  assert.equal(presentations.length, 1);
  assert.equal(presentations[0].src, source, "footer receives the same resolved source as the artwork");
  assert.match(markup, /<img[^>]+src="https:\/\/media\.example\.test\/current\.png"/);
  assert.match(markup, /<\/div><footer><a href="https:\/\/media\.example\.test\/current\.png">Open source<\/a><\/footer>/,
    "source controls are a sibling after the artwork, never an overlay inside it");
  assert.deepEqual(requestedKeys, [currentKey], "footer composition adds no second active source resolver");

  requestedKeys.length = 0;
  const assets = [{ _id: "old-thumbnail", _creationTime: 1, kind: "thumbnail", r2Key: oldKey }];
  const runMarkup = renderToStaticMarkup(createElement(RunMediaWorkbench, {
    assets,
    stages: [],
    runStatus: "ok",
    currentThumbnail: {
      title: "Taxes decoded",
      thumbnailKey: currentKey,
      thumbnailPresentation: "current_golden_candidate",
      videoKey: null,
    },
  }));
  assert.match(runMarkup, /<\/div><div class="assetBody"><div class="assetHeading"><p class="assetKind">Current thumbnail<\/p>/);
  assert.doesNotMatch(runMarkup, /currentSourceLink/);
  assert.doesNotMatch(runMarkup, /data-historical-thumbnail=/, "old media stays unmounted until History opens");
  assert.match(runMarkup, /Historical thumbnails/);
  assert.deepEqual(requestedKeys, [currentKey], "current card resolves once and does not sign collapsed history");

  requestedKeys.length = 0;
  const videoKey = "owner/test/channel/lofi/runs/source/final.mp4";
  const frameMarkup = renderToStaticMarkup(createElement(RunMediaWorkbench, {
    assets,
    stages: [],
    runStatus: "ok",
    currentThumbnail: {
      title: "Seaside calm",
      thumbnailKey: null,
      thumbnailPresentation: "lofi_frame_pending",
      videoKey,
    },
  }));
  assert.match(frameMarkup, /<video /);
  assert.match(frameMarkup, /<p class="assetKind">Source video frame<\/p>/);
  assert.doesNotMatch(frameMarkup, /15-second source frame/,
    "short legacy clips must not be described as an exact 15-second frame");
  assert.deepEqual(requestedKeys, [videoKey], "LoFi frame also uses one active resolver");

  for (const skipped of [0, 4, 16]) {
    const stageMarkup = renderToStaticMarkup(createElement(RunMediaWorkbench, {
      assets: [],
      stages: Array.from({ length: 16 }, (_, index) => ({
        block: "stage-" + index, status: index < skipped ? "skipped" : "ok",
      })),
      runStatus: "ok",
      currentThumbnail: null,
    }));
    assert.ok(stageMarkup.includes(`<dt>Completed stages</dt><dd title="${16 - skipped}/16">${16 - skipped}/16</dd>`));
    assert.ok(stageMarkup.includes(`<dt>Skipped</dt><dd title="${skipped}">${skipped}</dd>`));
    assert.ok(!stageMarkup.includes("Verified"), "finished execution alone never grants quality approval");
  }
} finally {
  loader._load = originalLoad;
}

console.log("MediaPreview footer and run thumbnail rendering contracts passed");
