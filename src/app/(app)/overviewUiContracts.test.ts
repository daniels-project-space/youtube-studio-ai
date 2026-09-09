import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

// Actual page, overview model and presentation components. Only the transport,
// contexts and CSS loader are fixtures; browser tests cover layout/live data.
const channels = [
  { _id: "alpha", name: "Alpha", slug: "alpha", status: "active", template: "history" },
  { _id: "beta", name: "Beta DE", slug: "beta", status: "active", template: "history", groupId: "family", folder: "Languages" },
  { _id: "paused", name: "Paused", slug: "paused", status: "paused", template: "history" },
  { _id: "orphan", name: "Orphan", slug: "orphan", status: "draft", template: "history", groupId: "incomplete" },
];
const runs = [0,1,2,3,4,5].map(i => ({ _id: `run${i}`, status: "failed", costTotal: .25, channelName: "Alpha", channelSlug: "alpha" }));
const summaries = channels.map((c,i) => ({ channelId: c._id, slug: c.slug, name: c.name,
  subscriberCount: i+1, totalViews: i === 2 ? 9000 : i === 0 ? 0 : 20,
  costTotal: i+1, videoCount: i+1 }));
const ready = { _id: "plan1", channelId: "alpha", channelName: "Alpha", channelSlug: "alpha", topic: "An actual planned topic", status: "ready" };
const data: Record<string, unknown> = {
  "channels:listChannels": channels, "runs:listRecent": runs, "runs:listActive": [],
  "contentPlan:listPlanByOwner": [ready], "analytics:channelSummary": summaries,
  "youtubeAuth:linkStatus": [], "videos:listVideos": [],
};
let selectedSlug: string | null = null;
const calls: string[] = [];
const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = loader._load, require = createRequire(import.meta.url);
loader._load = function (...args: unknown[]) {
  const name = args[0];
  if (name === "convex/react") return { useQuery: (query: Parameters<typeof getFunctionName>[0]) => {
    const key = getFunctionName(query); calls.push(key);
    assert.ok(Object.hasOwn(data,key), `unexpected query ${key}`); return data[key];
  } };
  if (name === "@/lib/owner-context") return { useOwnerId: () => "test-owner" };
  if (name === "@/lib/channel-context") return { useSelectedChannel: () => ({ selectedSlug }) };
  if (typeof name === "string" && name.endsWith(".module.css")) return { __esModule: true,
    default: new Proxy({}, { get: (_target, key) => String(key) }) };
  return originalLoad.apply(this,args);
};
try {
  const { default: Page } = require("./page") as typeof import("./page");
  const render = () => renderToStaticMarkup(createElement(Page));
  let html = render();
  assert.doesNotMatch(html, /50-run spend|ON AIR|Master controls|Live route|>Published</);
  for (const run of runs) assert.ok(html.includes(`data-issue-key="failed:${run._id}"`), "same-channel failures must all be reachable");
  assert.equal((html.match(/data-issue-key=/g) ?? []).length, 8, "six failures and both active connectors");
  assert.ok(html.includes('Recorded views</small><strong>20</strong>'), "only operating-channel analytics");
  assert.ok(html.includes('YouTube uploads</small><strong>3</strong>'), "upload IDs are not public-release proof");
  assert.match(html, /--bar-width:0%/, "zero recorded views must not create a positive bar");
  assert.ok(html.includes('6 recent · $1.50'));
  assert.ok(html.includes('0% success · 6 completed'));
  assert.ok(html.includes('href="/channels/alpha?tab=week-ahead&amp;plan=plan1#plan-plan1"'));
  assert.match(html, /Needs a date/);
  assert.match(html, /data-channel-slug="alpha"/);
  assert.match(html, /data-channel-slug="orphan"/, "incomplete family assignment stays reachable");
  assert.doesNotMatch(html, /data-channel-slug="beta"/, "room members are not duplicated");
  assert.equal((html.match(/data-channel-slug=/g) ?? []).length, 3, "no animation clones");
  assert.equal(calls.filter(key => key.startsWith("analytics:")).length, 1, "one analytics subscription");

  selectedSlug = "beta"; html = render();
  assert.match(html, /data-channel-slug="beta"/, "selected family members remain accessible");
  assert.doesNotMatch(html, /data-channel-slug="alpha"|failed:run/);
  assert.ok(html.includes('YouTube uploads</small><strong>2</strong>'));
  assert.ok(html.includes('0 recent · $0.00'));
  selectedSlug = "paused"; html = render();
  assert.ok(html.includes('Recorded views</small><strong>9K</strong>'), "explicit paused selection works");
  assert.doesNotMatch(html, /data-issue-key=/);

  selectedSlug = null;
  const live = { ...runs[0], _id: "live", status: "running" };
  data["runs:listActive"] = [live];
  data["runs:listRecent"] = [{ ...live, stageProgress: { completed: 2, total: 5, totalKnown: true, currentBlock: "tts", currentStatus: "running" } }];
  html = render();
  assert.match(html, /<progress max="5" value="2"/);
  assert.match(html, /2\/5 stages/);
  data["runs:listRecent"] = [{ ...live, stageProgress: { completed: 2, total: 3, totalKnown: false } }];
  html = render();
  assert.doesNotMatch(html, /<progress/);
  assert.match(html, /2 stages completed · total unavailable/);
  data["runs:listRecent"] = [{ ...live, _id: "another-run", stageProgress: { completed: 2, total: 5, totalKnown: true } }];
  html = render();
  assert.doesNotMatch(html, /<progress/);
  assert.match(html, /Running · open for stage details/);
  data["runs:listActive"] = [];
  data["runs:listRecent"] = runs;

  selectedSlug = null; data["analytics:channelSummary"] = undefined; html = render();
  assert.ok(html.includes('Recorded views</small><strong>—</strong>'), "loading is not zero");
  data["channels:listChannels"] = undefined; html = render();
  assert.match(html, /Reading studio state/);
  assert.ok(html.includes('Plans ready</small><strong>—</strong>'));
  for (const key of Object.keys(data)) data[key] = [];
  html = render();
  assert.match(html, /Create a channel/);
  assert.doesNotMatch(html, /data-issue-key=/);
  assert.match(html, /No completed runs/);
  console.log("Studio actual-component contracts passed: scope, all issues, analytics, uploads, counts, family navigation, loading and empty states");
} finally { loader._load = originalLoad; }
