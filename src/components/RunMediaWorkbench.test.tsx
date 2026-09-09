import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual component; substitute only URL signing and the CSS loader.
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
const requested: string[] = [];
let status: "ready" | "loading" | "error" = "ready";
loader._load = function (...args: unknown[]) {
  const request = String(args[0]);
  if (request.endsWith(".module.css")) return {
    __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }),
  };
  if (request === "@/lib/asset-url") return { useAssetUrlState(key?: string | null) {
    if (key) requested.push(key);
    return { status, url: key && status === "ready" ? `https://media.example.test/${key}` : null };
  } };
  return originalLoad.apply(this, args);
};

try {
  const { RunMediaWorkbench } = require("./RunMediaWorkbench") as typeof import("./RunMediaWorkbench");
  const assets = [
    { _id: "captions", _creationTime: 4, kind: "captions", r2Key: "captions.srt", meta: { cues: 114 } },
    { _id: "master", _creationTime: 3, kind: "video", r2Key: "final.mp4" },
    { _id: "narration", _creationTime: 2, kind: "narration", r2Key: "voice.mp3" },
    { _id: "old", _creationTime: 1, kind: "thumbnail", r2Key: "old.png" },
  ];
  const render = (records = assets) => renderToStaticMarkup(createElement(RunMediaWorkbench, {
    assets: records, stages: [], runStatus: "failed", selectedVideoAssetId: "master",
    currentThumbnail: { title: "Actual stored run", thumbnailKey: "current.png", videoKey: "final.mp4" },
  }));
  const html = render();
  assert.ok(html.indexOf('data-media-type="video"') < html.indexOf('data-current-thumbnail='),
    "selected master comes first in reading and keyboard order");
  assert.equal((html.match(/<video /g) ?? []).length, 1);
  assert.equal((html.match(/<audio /g) ?? []).length, 1);
  const file = html.match(/<article[^>]*data-media-type="file"[\s\S]*?<\/article>/)?.[0];
  assert.ok(file);
  assert.doesNotMatch(file, /class="preview"|<video|<audio|<img|Saved captions file/,
    "documents have actions and metadata, not an empty media-preview stage");
  assert.match(file, /href="https:\/\/media.example.test\/captions.srt"/);
  assert.match(file, /aria-label="Open captions source: captions.srt"/);
  assert.match(file, /Cues 114/);
  assert.match(file, /<summary>Storage<\/summary>/);
  assert.doesNotMatch(html, /masterFlag/, "the master label must not cover footage");
  assert.deepEqual(requested.sort(), ["captions.srt", "current.png", "final.mp4", "voice.mp3"].sort(),
    "one resolver per visible asset; collapsed historical images stay unsigned");

  for (const state of ["loading", "error"] as const) {
    status = state;
    const pending = render().match(/<article[^>]*data-media-type="file"[\s\S]*?<\/article>/)?.[0];
    assert.ok(pending);
    assert.doesNotMatch(pending, /href=/, "no fake or stale source link during URL failure/loading");
    assert.match(pending, state === "loading" ? /Preparing file link/ : /File link unavailable/);
  }
  status = "ready";
  assert.doesNotMatch(render(assets.filter((asset) => asset.kind !== "video")), /data-has-master="true"/);
  const many = [...assets, ...Array.from({ length: 20 }, (_, index) => ({
    _id: `scene-${index}`, _creationTime: 10 + index, kind: "image", r2Key: `scene-${index}.png`,
  }))];
  const paged = render(many);
  assert.equal((paged.match(/data-media-type=/g) ?? []).length, 12);
  assert.match(paged, /final.mp4/, "selected master stays mounted even when older than recent media");
  assert.match(paged, /Show all 23/);
} finally { loader._load = originalLoad; }

console.log("Run media ordering, compact documents, signed links and bounded rendering contracts passed");
