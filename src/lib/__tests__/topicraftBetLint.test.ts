import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintBet, normTopic, type TopicBet, type TopicEvidence } from "@/lib/topicraft";

// P2-6 (GOLDEN_MODULE_AUDIT_2026-08.md): "topic-intel has no dedicated unit
// test for topicraft.ts's citation/dedupe/judge logic — only
// scripts/topicraft-ab.ts, a comparison script." lintBet() (topicraft.ts,
// cited 213-282) is the exported, pure citation+dedupe lint that gates every
// topic bet before it ever reaches the live judge call. This test exercises
// it with realistic bets and evidence. The JUDGE half (demand/freshness/
// fit/packageability >=7, cited 318-355/526) lives inside craftTopics()'s
// live Gemini round trip and cannot run without network — it is pinned
// against the real source at the bottom of this file instead.

const evidence: TopicEvidence = {
  outliers: [{
    title: "The Bridge That Doomed A Nation",
    channelTitle: "History Lens",
    views: 1_200_000,
    subs: 5_000,
    score: 15,
    videoId: "vid-1",
    publishedAt: "2026-01-01",
    durationSec: 600,
  }],
  trends: [{ title: "why did the old crossing collapse", score: 8_400, subreddit: "history" }],
  suggests: ["bridge collapse history", "1907 bridge disaster"],
  competitors: [{ title: "Great Engineering Disasters", views: 800_000 }],
};

function baseBet(overrides: Partial<TopicBet> = {}): TopicBet {
  return {
    topic: "The bridge collapse that doomed a nation in 1907",
    angle: "Engineering hubris meets a public catastrophe",
    betType: "hero",
    provisionalTitle: "The bridge collapse that doomed a nation in 1907",
    thumbnailMoment: "A crowd watches in horror as the bridge deck buckles and falls",
    hookPromise: "You will see exactly how one overlooked flaw doomed the crossing",
    evidence: "outlier: bridge that doomed footage",
    ...overrides,
  };
}

const lintOpts = {
  evidence,
  identityGiven: true,
  bannedWords: ["shocking secret"],
  avoidNorm: new Set<string>(),
  avoidTokens: [] as Set<string>[],
  keptTokens: [] as Set<string>[],
  channelName: "History Channel",
};

/* ------------------------------ happy path -------------------------------- */

{
  const result = lintBet(baseBet(), lintOpts);
  assert.equal(result.pass, true, `a well-formed, evidence-cited bet must pass; issues=${JSON.stringify(result.issues)}`);
}

/* --------------------------- citation lint (real) -------------------------- */

// A citation tag that matches none of the supplied outlier signals must fail.
{
  const result = lintBet(baseBet({ evidence: "outlier: a completely unrelated fabricated claim about volcanoes" }), lintOpts);
  assert.equal(result.pass, false, "a citation that matches no supplied outlier evidence must be rejected");
  assert.ok(result.issues.some((i) => i.includes("matches none of the supplied outlier signals")));
}

// A citation tag for a category with zero supplied signals must fail.
{
  const noCompetitors: TopicEvidence = { ...evidence, competitors: [] };
  const result = lintBet(baseBet({ evidence: "competitor-gap: nobody covers this angle" }), { ...lintOpts, evidence: noCompetitors });
  assert.equal(result.pass, false, "citing competitor-gap evidence when zero competitors were supplied must be rejected");
  assert.ok(result.issues.some((i) => i.includes("no competitor-gap signals were supplied")));
}

// Malformed citation (no recognized tag prefix) must fail.
{
  const result = lintBet(baseBet({ evidence: "this has no tag prefix at all" }), lintOpts);
  assert.equal(result.pass, false, "evidence without a valid '<tag>: <signal>' prefix must be rejected");
  assert.ok(result.issues.some((i) => i.includes('evidence must be "<tag>: <signal>"')));
}

// "perf" citation with no perfContext supplied must fail.
{
  const result = lintBet(baseBet({ evidence: "perf: this channel's own retention data" }), lintOpts);
  assert.equal(result.pass, false, "citing perf evidence without a supplied perfContext must be rejected");
  assert.ok(result.issues.some((i) => i.includes("no performance context was supplied")));
}
// The same perf citation passes once perfContext is actually supplied.
{
  const result = lintBet(baseBet({ evidence: "perf: this channel's own retention data" }), { ...lintOpts, perfContext: "retention holds past 6 minutes on similar topics" });
  assert.equal(result.pass, true, `a perf citation with perfContext supplied must pass; issues=${JSON.stringify(result.issues)}`);
}

/* -------------------------------- dedupe lint ------------------------------ */

// Exact-duplicate topic (normalized) vs. the avoid set must fail.
{
  const dupeTopic = "The Bridge Collapse That Doomed A Nation In 1907";
  const result = lintBet(baseBet({ topic: dupeTopic }), { ...lintOpts, avoidNorm: new Set([normTopic(dupeTopic)]) });
  assert.equal(result.pass, false, "a topic that exactly normalizes to an already-done topic must be rejected");
  assert.ok(result.issues.some((i) => i.includes("duplicates an already-used topic")));
}

// Near-duplicate (high token-jaccard overlap) vs. the avoid set must fail.
{
  const avoidTopic = "bridge collapse that doomed nation 1907 disaster";
  const avoidTokenSet = new Set(normTopic(avoidTopic).split(" ").filter((w) => w.length > 2));
  const result = lintBet(baseBet(), { ...lintOpts, avoidTokens: [avoidTokenSet] });
  assert.equal(result.pass, false, "a topic with heavy token overlap against an already-done topic must be rejected as a near-duplicate");
  assert.ok(result.issues.some((i) => i.includes("near-duplicate of an already-used topic")));
}

// A topic sharing only a couple of common words with the avoid list must NOT
// be treated as a duplicate — proves the jaccard threshold is real, not a
// hair-trigger "any shared word" check.
{
  const avoidTopic = "the secret history of ancient roman aqueducts and their engineers";
  const avoidTokenSet = new Set(normTopic(avoidTopic).split(" ").filter((w) => w.length > 2));
  const result = lintBet(baseBet(), { ...lintOpts, avoidTokens: [avoidTokenSet] });
  assert.equal(result.pass, true, `a topic sharing only incidental words with an unrelated avoid entry must NOT be rejected; issues=${JSON.stringify(result.issues)}`);
}

// Duplicate within the SAME slate (keptTokens) must also fail.
{
  const keptTopic = "bridge collapse doomed nation 1907 engineering failure";
  const keptTokenSet = new Set(normTopic(keptTopic).split(" ").filter((w) => w.length > 2));
  const result = lintBet(baseBet(), { ...lintOpts, keptTokens: [keptTokenSet] });
  assert.equal(result.pass, false, "a bet that duplicates another bet already kept in the same slate must be rejected");
  assert.ok(result.issues.some((i) => i.includes("duplicates another bet in this slate")));
}

/* ------------------------------ other real gates --------------------------- */

// Banned word anywhere in the visible fields must fail.
{
  const result = lintBet(baseBet({ angle: "This reveals a shocking secret nobody expected" }), lintOpts);
  assert.equal(result.pass, false, "a banned phrase in the angle must be rejected");
  assert.ok(result.issues.some((i) => i.includes('contains banned term "shocking secret"')));
}

// Off-voice listicle format on a channel whose pool never uses listicles.
{
  const result = lintBet(
    baseBet({ provisionalTitle: "7 Secrets The Bridge Collapse Documentary Never Told You" }),
    { ...lintOpts, topicPool: ["The Bridge That Doomed A Nation", "The Ship That Vanished At Dawn", "The Fire That Ended An Empire"] },
  );
  assert.equal(result.pass, false, "a listicle-format title on a channel whose curated pool never uses listicles must be rejected");
  assert.ok(result.issues.some((i) => i.includes("listicle/hype format")));
}

// Category-not-topic guard: too short / too generic a topic must fail.
{
  const result = lintBet(baseBet({ topic: "Bridges" }), lintOpts);
  assert.equal(result.pass, false, "a bare category, not a specific topic, must be rejected");
  assert.ok(result.issues.some((i) => i.includes("is a category, not a specific topic")));
}

console.log("topicraftBetLint.test.ts: lintBet() citation + dedupe logic verified against realistic bets/evidence");

/* -------------------- craftTopics judge gate (>=7) -- pinned -------------- */
//
// craftTopics() ranks lint-surviving bets through a live Gemini judge and
// only accepts a winner when demand, fit, and packageability ALL clear 7 (and
// freshness clears 7, or 5 for music-niche channels). That round trip cannot
// run without network + GEMINI_API_KEY, so this pins the literal gate
// expression: a silent loosening of any of the four thresholds breaks this
// test instead of shipping unnoticed.

{
  const source = readFileSync(join(process.cwd(), "src/lib/topicraft.ts"), "utf8");
  const gateExpr =
    '(r.demand ?? 0) >= 7 && (r.freshness ?? 0) >= (isMusicNiche ? 5 : 7) && (r.fit ?? 0) >= 7 && (r.packageability ?? 0) >= 7';
  assert.ok(
    source.includes(gateExpr),
    "topicraft.ts: craftTopics' judge gate must still require demand/fit/packageability >=7 and freshness >=7 " +
      "(>=5 for music-niche channels) — literal expression not found, gate may have moved or weakened",
  );
  assert.ok(
    source.includes('lastIssues.push("no bet gated demand/freshness/fit/packageability ≥7")'),
    "topicraft.ts: the judge-rejection path must still exist so a fully-rejected slate triggers a real retry, not a silent pass",
  );
}

console.log("topicraftBetLint.test.ts: craftTopics demand/freshness/fit/packageability >=7 judge gate pinned against live source");
