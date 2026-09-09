import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VideoRow } from "@/lib/types";

// Exercise the real player and signed-player JSX; transport/CSS are the only seams.
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
const calls: unknown[] = [];
let state = { url: null as string | null, status: "loading" };
loader._load = function (...args: unknown[]) {
  const name = String(args[0]);
  if (name.endsWith(".module.css")) return { __esModule: true,
    default: new Proxy({}, { get: (_, key) => String(key) }) };
  if (name === "@/lib/asset-url") return {
    useAssetUrlState: (key: unknown) => { calls.push(key); return state; },
    useAssetUrl: (key: unknown) => { calls.push(key); return state.url; },
    youtubeEmbed: (id: string) => `https://www.youtube.com/embed/${id}`,
  };
  return originalLoad.apply(this, args);
};
try {
  const { VideoPlayer } = require("./VideoPlayer") as typeof import("./VideoPlayer");
  const video = { _id: "saved-run", title: "Private saved master", videoKey: "owner/fixture/run/final.mp4", youtubeVideoId: "legacy-id" } as VideoRow;
  const render = (value = video) => renderToStaticMarkup(createElement(VideoPlayer, { video: value, embedTabIndex: -1 }));
  const loading = render();
  assert.match(loading, /Loading video/);
  assert.doesNotMatch(loading, /<iframe|No playable source/, "an upload ID must not hide an available saved master or a pending request");
  state = { url: null, status: "error" };
  const failed = render();
  assert.match(failed, /Retry video/);
  assert.doesNotMatch(failed, /<iframe/, "a signing failure must not silently switch sources");
  state = { url: "/saved-master.mp4", status: "ready" };
  const saved = render();
  assert.match(saved, /data-signed-video-state="ready"/);
  assert.match(saved, /aria-label="Private saved master"/);
  assert.match(saved, /src="\/saved-master.mp4"/);
  assert.doesNotMatch(saved, /<iframe/);
  assert.deepEqual(calls, [video.videoKey, video.videoKey, video.videoKey], "only the exact saved key is signed");
  const youtubeOnly = render({ ...video, videoKey: null });
  assert.match(youtubeOnly, /<iframe/);
  assert.match(youtubeOnly, /tabindex="-1"/);
  assert.equal(calls.length, 3, "YouTube-only fallback does not ask for a signed URL");
  const absent = render({ ...video, videoKey: null, youtubeVideoId: undefined });
  assert.match(absent, /No playable source/);
  assert.doesNotMatch(absent, /<video|<iframe|Retry video/);
  assert.equal(calls.length, 3, "missing media does not trigger a request");
} finally { loader._load = originalLoad; }
console.log("VideoPlayer actual source selection, loading/error/retry and native recovery integration passed");
