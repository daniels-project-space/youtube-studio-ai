import assert from "node:assert/strict";
import { measureHookWindow, MEASURED_HOOK_WINDOW_SEC } from "@/lib/hookcraft";

// measureHookWindow is the GENUINE MEASURED hook gate added alongside
// lintHook's estimated-duration heuristic (hookcraft.ts): where lintHook
// guesses hook length from word count / WPS before any shot is planned,
// measureHookWindow reads the real t0/t1 shot or beat boundaries a Story
// Spine produces post-narration-alignment and checks whether something
// actually, visibly changes within the first ~10 real seconds. This test
// exercises both the pass and fail branches, plus the deliberate
// non-coupling to any on-screen text/card concept (the function only ever
// looks at timing, never at shot kind/content).

// --- 1. A shot list with an early transition passes -----------------------
const withEarlyTransition = [
  { id: "shot-0001", t0: 0, t1: 6 },
  { id: "shot-0002", t0: 6, t1: 14 },
  { id: "shot-0003", t0: 14, t1: 30 },
];
{
  const result = measureHookWindow(withEarlyTransition);
  assert.equal(result.pass, true, "a shot boundary at 6s (inside the 10s window) must pass the measured gate");
  assert.equal(result.transitionsInWindow, 1, "exactly one boundary (t0=6) falls inside (0, 10]");
  assert.equal(result.firstTransitionSec, 6, "firstTransitionSec must report the earliest in-window boundary");
  assert.equal(result.windowSec, MEASURED_HOOK_WINDOW_SEC, "default window must be the exported 10s constant");
  assert.equal(result.issues.length, 0, "a passing result must carry no issues");
}

// --- 2. A shot list that holds on ONE static shot past 10s fails ----------
const noEarlyTransition = [
  { id: "shot-0001", t0: 0, t1: 22 },
  { id: "shot-0002", t0: 22, t1: 40 },
];
{
  const result = measureHookWindow(noEarlyTransition);
  assert.equal(result.pass, false, "a single 22s-long opening shot must FAIL the measured gate — nothing changes before 10s");
  assert.equal(result.transitionsInWindow, 0, "no boundary lands inside (0, 10]");
  assert.equal(result.firstTransitionSec, null, "no transition found means firstTransitionSec is null");
  assert.ok(
    result.issues.some((i) => i.includes("10s")),
    "the failure issue must name the real window that was missed",
  );
}

// --- 3. A boundary landing EXACTLY at the 10s edge still counts -----------
{
  const result = measureHookWindow([
    { id: "shot-0001", t0: 0, t1: 10 },
    { id: "shot-0002", t0: 10, t1: 20 },
  ]);
  assert.equal(result.pass, true, "a boundary exactly at the window edge (t0=10, <= windowSec) must still count");
}

// --- 4. A boundary just past the window fails ------------------------------
{
  const result = measureHookWindow([
    { id: "shot-0001", t0: 0, t1: 10.5 },
    { id: "shot-0002", t0: 10.5, t1: 20 },
  ]);
  assert.equal(result.pass, false, "a boundary at 10.5s (past the 10s window) must NOT count");
}

// --- 5. Custom window size is respected ------------------------------------
{
  const result = measureHookWindow(
    [
      { id: "shot-0001", t0: 0, t1: 12 },
      { id: "shot-0002", t0: 12, t1: 20 },
    ],
    { windowSec: 15 },
  );
  assert.equal(result.pass, true, "a 12s boundary must pass under a widened 15s window");
  assert.equal(result.windowSec, 15, "windowSec must reflect the caller override");
}

// --- 6. Empty input fails loudly, never silently passes --------------------
{
  const result = measureHookWindow([]);
  assert.equal(result.pass, false, "an empty timed-item list must fail closed, never pass by default");
  assert.ok(result.issues.length > 0, "empty input must report why it failed");
}

// --- 7. Out-of-order input is tolerated (sorted internally) ----------------
{
  const result = measureHookWindow([
    { id: "shot-0002", t0: 6, t1: 20 },
    { id: "shot-0001", t0: 0, t1: 6 },
  ]);
  assert.equal(result.pass, true, "input order must not matter — the function sorts by t0 before scanning boundaries");
}

// --- 8. This gate is timing-only: it never inspects shot kind/content, so ---
//        it cannot accidentally require a text/rhetorical-question card in
//        the first window — any item shape with t0/t1 is accepted regardless
//        of what "kind" of shot it is.
{
  const textCardLater = [
    { id: "shot-0001", t0: 0, t1: 8, kind: "cold_open_scene" },
    { id: "shot-0002", t0: 8, t1: 50, kind: "b_roll" },
    { id: "shot-0003", t0: 50, t1: 55, kind: "quote_card_rhetorical_question" },
  ];
  const result = measureHookWindow(textCardLater);
  assert.equal(
    result.pass,
    true,
    "the gate passes on the real 8s shot-boundary transition alone — a text/rhetorical-question card landing at 50s (long after the window) is irrelevant to it",
  );
}

console.log(
  "hookcraftMeasuredGate.test.ts: measureHookWindow pass/fail/edge/order/decoupling-from-text-cards all verified",
);
