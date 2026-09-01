import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudioOverview,
  planWorkspaceHref,
  type StudioOverviewChannel,
  type StudioOverviewPlan,
  type StudioOverviewRun,
} from "../studioOverviewModel";

const channels: StudioOverviewChannel[] = [
  { _id: "channels:one", name: "Quiet Signal", slug: "quiet-signal", status: "active" },
  { _id: "channels:paused", name: "Paused", slug: "paused", status: "paused" },
];

const failedRun: StudioOverviewRun = {
  _id: "runs:failed",
  status: "failed",
  costTotal: 1.25,
  channelName: "Quiet Signal",
  channelSlug: "quiet-signal",
};

const readyPlan: StudioOverviewPlan = {
  _id: "plans:ready",
  channelName: "Quiet Signal",
  channelSlug: "quiet-signal",
  topic: "A real plan",
  status: "ready",
  scheduledAt: 2_000,
};

test("plan links open the exact channel week-ahead item", () => {
  assert.equal(
    planWorkspaceHref(readyPlan),
    "/channels/quiet-signal?tab=week-ahead&plan=plans%3Aready#plan-plans%3Aready",
  );
});

test("the overview derives issues only from real actionable state", () => {
  const snapshot = buildStudioOverview({
    channels,
    recentRuns: [
      failedRun,
      { ...failedRun, _id: "runs:stalled", status: "running", costTotal: 0.5 },
      { ...failedRun, _id: "runs:ok", status: "ok", costTotal: 0.25 },
    ],
    activeRuns: [],
    plan: [readyPlan, { ...readyPlan, _id: "plans:failed", status: "failed" }],
    youtubeLinks: [],
    now: 3_000,
    publishedCount: 7,
  });

  assert.equal(snapshot.activeChannelCount, 1, "paused channels are not treated as operating");
  assert.equal(snapshot.stalledRuns.length, 1, "an expired active-status run is visible as stalled");
  assert.equal(snapshot.failedRuns.length, 1);
  assert.equal(snapshot.failedPlans.length, 1);
  assert.equal(snapshot.overduePlans.length, 1);
  assert.equal(snapshot.disconnectedChannels.length, 1, "only the active channel needs a connector");
  assert.equal(snapshot.issues.length, 5);
  assert.equal(snapshot.decision.href, "/runs/runs%3Astalled");
  assert.equal(snapshot.recordedSpend, 2);
  assert.equal(snapshot.successRate, 50);
  assert.equal(snapshot.publishedCount, 7);
});

test("a healthy connector and live run produce a precise monitor decision", () => {
  const liveRun = { ...failedRun, _id: "runs:live", status: "running" };
  const snapshot = buildStudioOverview({
    channels: channels.slice(0, 1),
    recentRuns: [liveRun],
    activeRuns: [liveRun],
    plan: [],
    youtubeLinks: [{
      channelId: "channels:one",
      status: "active",
      scopeHealth: "healthy",
      ytChannelId: "UC-real",
    }],
    now: 3_000,
  });

  assert.deepEqual(snapshot.issues, []);
  assert.equal(snapshot.runningCount, 1);
  assert.equal(snapshot.decision.href, "/runs/runs%3Alive");
  assert.equal(snapshot.decision.action, "Monitor run");
});

test("ready work without a date is described as editorially ready, not scheduled", () => {
  const unscheduled = { ...readyPlan, scheduledAt: undefined };
  const snapshot = buildStudioOverview({
    channels: channels.slice(0, 1),
    recentRuns: [],
    activeRuns: [],
    plan: [unscheduled],
    youtubeLinks: [{
      channelId: "channels:one",
      status: "active",
      scopeHealth: "healthy",
      ytChannelId: "UC-real",
    }],
    now: 3_000,
  });

  assert.equal(snapshot.readyPlanCount, 1);
  assert.equal(snapshot.scheduledPlanCount, 0);
  assert.equal(snapshot.unscheduledPlanCount, 1);
  assert.match(snapshot.decision.detail, /ready for a date/);
});
