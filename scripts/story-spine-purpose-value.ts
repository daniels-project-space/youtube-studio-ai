/**
 * What is the Director's beat purpose actually WORTH to the shot plan?
 *
 * Context, and a correction worth keeping: the illustrated-explainer and
 * children-learning ARCHETYPES do not list director_brief, which reads at first
 * like two whole lanes planning their shots with no director. They are
 * templates, not pipelines. completePipelineForPolicy inserts director_brief,
 * dp_brief, editor_brief, composer_brief and critic_spec before a channel is
 * ever created (designChannelInception), and compilePipeline refuses the raw
 * archetype outright. So the purpose IS present on every lane that runs
 * story_spine — which is exactly why it mattered that story_spine was throwing
 * away the `intentSec` half of it.
 *
 * This measures the other half. The purpose reaches the render through two
 * paths in cinematicShotLanguage.ts:
 *
 *   classifyCinematicNarrativeIntent(literalContent, beatPurpose, isOpening)
 *       a keyword regex over the sentence AND the purpose, choosing the shot
 *       grammar. Observed here through shot.coveragePurpose, which is
 *       grammar.coveragePurpose and therefore one fixed string per intent.
 *   seed = `${literalContent}\n${beatPurpose}\n${chunk}`
 *       the deterministic selector for camera move and shot scale.
 *
 * Run with the real director briefs present and absent. If the sentence text
 * already carried the signal, the delta would be near zero and the purpose
 * would be decoration. It is not: 27% of shots change grammar, 51% on the
 * evidence-led casefile doctrine — and WITHOUT a purpose every channel
 * collapses onto the same dominant grammar ("advance the narrative"), which is
 * precisely the homogenisation a per-channel doctrine exists to prevent.
 *
 * REAL: planStorySpine, planCinematicShotLanguage (via the spine), the cached
 * briefDirector output from story-spine-pacing-harness.ts, and narration
 * written by claudeJson under the pipeline's own data-discipline clause —
 * placeholder sentences would defeat the measurement, since the classifier
 * reads the sentence text.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/story-spine-purpose-value.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { claudeJson } from "@/lib/anthropic";
import { dataDiscipline } from "@/lib/scriptGen";
import { planStorySpine } from "@/engine/storySpine";

const BRIEFS = "/tmp/story-spine-director-briefs.json";
const NARRATION = "/tmp/story-spine-narration.json";
const WPS = 2.6;

interface Brief { key: string; hook: string; beats: { name: string; intentSec: number; note: string }[] }

const TOPICS: ReadonlyArray<{ key: string; topic: string; voice: string }> = [
  { key: "illustrated-explainer", topic: "Why bridges are built to sway", voice: "bright, brisk, genuinely curious explainer" },
  { key: "casefile-cinematic", topic: "The 1971 skyjacking that was never solved", voice: "cold, procedural, evidence-led narrator" },
  { key: "lorecraft-watercolor", topic: "The drowned bell of Dunwich", voice: "hushed, unhurried folklore reader" },
  { key: "narrated-stoic", topic: "Marcus Aurelius on the people who will annoy you today", voice: "steady, grounded, adult" },
];

async function narrations(): Promise<Record<string, string[]>> {
  if (existsSync(NARRATION)) return JSON.parse(readFileSync(NARRATION, "utf8")) as Record<string, string[]>;
  const out: Record<string, string[]> = {};
  for (const t of TOPICS) {
    const res = await claudeJson<{ sentences?: string[] }>({
      prompt:
        `Write a YouTube narration script about: "${t.topic}".\nNarrator voice: ${t.voice}.\n` +
        dataDiscipline(true, false) +
        `\nReturn STRICT JSON {"sentences":[string]} with 40-60 spoken sentences, in order, ` +
        `each a complete spoken line with no stage directions and no numbering.`,
      maxTokens: 4000,
      temperature: 0.7,
    });
    out[t.key] = (res.sentences ?? []).map((s) => String(s).trim()).filter(Boolean);
    console.log(`  ${t.key}: ${out[t.key]!.length} sentences`);
  }
  writeFileSync(NARRATION, JSON.stringify(out, null, 2));
  return out;
}

/** Timings from the real sentence text at a measured speaking rate. */
function timings(sentences: string[]): { list: Array<{ text: string; start: number; end: number }>; duration: number } {
  let cursor = 0;
  const list = sentences.map((text) => {
    const secs = Math.max(1.2, text.split(/\s+/).filter(Boolean).length / WPS);
    const entry = { text, start: cursor, end: cursor + secs };
    cursor += secs;
    return entry;
  });
  return { list, duration: cursor };
}

function plan(sentences: string[], beats: Brief["beats"] | undefined) {
  const { list, duration } = timings(sentences);
  return planStorySpine({
    topic: "purpose value",
    narrationDurationSec: duration,
    sentenceTimings: list,
    targetShotSec: 6,
    ...(beats ? { structure: { beats } } : {}),
  });
}

const tally = (values: string[]): string =>
  [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");

async function main(): Promise<void> {
  if (!existsSync(BRIEFS)) {
    console.log("run scripts/story-spine-pacing-harness.ts first — it caches the real director briefs");
    return;
  }
  const briefs = JSON.parse(readFileSync(BRIEFS, "utf8")) as Brief[];
  const scripts = await narrations();

  console.log("\n=== does a real beat purpose change the shot plan? ===\n");
  let totalShots = 0;
  let intentChanged = 0;
  let cameraChanged = 0;
  let scaleChanged = 0;

  for (const brief of briefs) {
    const sentences = scripts[brief.key];
    if (!sentences?.length) continue;
    const without = plan(sentences, undefined);
    const with_ = plan(sentences, brief.beats);
    // Same sentences and same targetShotSec, so the two plans cut identically;
    // only the grammar chosen per shot can differ. Assert that, rather than
    // assuming it — a shot-count difference would make the comparison meaningless.
    if (without.shotList.length !== with_.shotList.length) {
      console.log(`  ${brief.key}: SHOT COUNTS DIFFER (${without.shotList.length} vs ${with_.shotList.length}) — skipped`);
      continue;
    }
    let i = 0;
    let localIntent = 0;
    for (const shot of without.shotList) {
      const other = with_.shotList[i++]!;
      totalShots++;
      if (shot.coveragePurpose !== other.coveragePurpose) { intentChanged++; localIntent++; }
      if (shot.cameraMove !== other.cameraMove) cameraChanged++;
      if (shot.shotScale !== other.shotScale) scaleChanged++;
    }
    console.log(`  ${brief.key}  ${without.shotList.length} shots, ${sentences.length} sentences`);
    console.log(`      intent without director: ${tally(without.shotList.map((s) => s.coveragePurpose.slice(0, 18)))}`);
    console.log(`      intent with    director: ${tally(with_.shotList.map((s) => s.coveragePurpose.slice(0, 18)))}`);
    console.log(`      intent differs on ${localIntent}/${without.shotList.length} shots`);
  }

  const pct = (n: number) => `${((n / Math.max(1, totalShots)) * 100).toFixed(1)}%`;
  console.log(
    `\n  across ${totalShots} shots: intent changed ${pct(intentChanged)}, ` +
      `camera move ${pct(cameraChanged)}, shot scale ${pct(scaleChanged)}`,
  );
  console.log(
    `\n  Reading: the intent number is the one that matters — camera and scale also\n` +
      `  move simply because beatPurpose is part of the selector SEED, which is\n` +
      `  variety, not correctness. A large intent delta means the director purpose\n` +
      `  is buying shot grammar the sentence alone does not supply.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
