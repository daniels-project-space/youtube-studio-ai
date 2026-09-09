import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Actual carousel and preview components; only data transport, signing and CSS
// are substituted. Interactive playback is covered by the native browser proof.
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load;
const require = createRequire(import.meta.url);
const calls: unknown[] = [];
let rows: unknown[] | undefined;
loader._load = function (...args: unknown[]) {
  const name = String(args[0]);
  if (name.endsWith(".module.css")) return { __esModule: true,
    default: new Proxy({}, { get: (_, key) => String(key) }) };
  if (name === "convex/react") return { useQuery: (_query: unknown, input: unknown) => {
    calls.push(input); return rows;
  } };
  if (name === "@/lib/asset-url") return { useAssetUrlState: () => ({ url: null, status: "loading" }) };
  return originalLoad.apply(this, args);
};
const failures: string[] = [];
try {
  const { RecentVideos } = require("./RecentVideos") as typeof import("./RecentVideos");
  const render = () => renderToStaticMarkup(createElement(RecentVideos, { ownerId: "fixture-owner", limit: 8 }));
  rows = [];
  assert.equal(render(), "", "no empty rendered-master panel");
  rows = [{ _id: "not-a-master", title: "Unrendered plan" }];
  assert.equal(render(), "", "unrendered plans cannot open a nonexistent master");
  rows = undefined;
  assert.equal((render().match(/aria-hidden="true"/g) ?? []).length, 3);
  for (const [durationSec, expected] of [[30, "0:30"], [180, "3:00"], [200.551, "3:20"],
    [59.999, "0:59"], [3599.999, "59:59"], [3600, "1:00:00"],
    [28831, "8:00:31"], [-10, null], [Number.NaN, null], [Infinity, null]] as const) {
    rows = [{ _id: "saved-master", title: "A complete saved video title", channelName: "Seaside Study",
      videoKey: "owner/fixture/run/final.mp4", createdAt: 0, durationSec }];
    const html = render();
    try {
      assert.match(html, /aria-label="Open saved video: A complete saved video title"/);
      assert.match(html, /<time dateTime="1970-01-01T00:00:00.000Z">1 Jan<\/time>/);
      assert.match(html, /<span>Seaside Study<\/span>/);
      assert.doesNotMatch(html, /R2 masters|>R2 /, "storage implementation isn't interface copy");
      if (expected) assert.ok(html.includes(`class="duration">${expected}</span>`), `duration ${durationSec} must show ${expected}`);
      else assert.doesNotMatch(html, /class="duration"/, "invalid durations must not become evidence");
    } catch (error) { failures.push(String(error)); }
  }
  assert.ok(calls.every(call => JSON.stringify(call) === '{"ownerId":"fixture-owner","limit":8}'),
    "presentation changes add no query and preserve exact data scope");
} finally { loader._load = originalLoad; }
assert.deepEqual(failures, []);
console.log("Recent videos: actual master filtering, scoped query, full title, useful metadata and hour-scale duration passed");
