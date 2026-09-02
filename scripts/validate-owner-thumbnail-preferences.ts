/**
 * Blind regression for the two owner-reviewed Nano Banana Pro A/B pairs.
 *
 * The judge receives candidates in alternating order and is never told which
 * render the owner selected. This exercises the production tournament itself,
 * including the durable golden and owner-preference rules.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { judgeTournament } from "@/lib/thumbnailLab";

type Pair = {
  key: string;
  title: string;
  selected: string;
  rejected: string;
};

const PAIRS: Pair[] = [
  {
    key: "comic",
    title: "The Medic Who Saved 75 Men At Hacksaw Ridge",
    selected: "/tmp/ysa-fal-pro-native-v8/comic/comic-attempt-1.jpg",
    rejected: "/tmp/ysa-fal-pro-native-v8/comic/comic-attempt-2.jpg",
  },
  {
    key: "history",
    title: "The Plague That Made People Dance",
    selected: "/tmp/ysa-fal-pro-native-v8/history/history-attempt-2.jpg",
    rejected: "/tmp/ysa-fal-pro-native-v8/history/history-attempt-1.jpg",
  },
];

async function runPair(pair: Pair): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `thumbnail-blind-${pair.key}-`));
  let selectedWins = 0;
  try {
    // Three independent judgments, with the selected candidate appearing in
    // both positions, make a cached or position-biased pass impossible.
    for (let trial = 0; trial < 3; trial++) {
      const selectedFirst = trial !== 1;
      const ordered = selectedFirst
        ? [pair.selected, pair.rejected]
        : [pair.rejected, pair.selected];
      const trialDir = join(root, `trial-${trial + 1}`);
      await mkdir(trialDir, { recursive: true });
      const result = await judgeTournament({
        candidates: ordered.map((path) => ({ path, pattern: basename(path) })),
        refs: [],
        title: pair.title,
        tmpDir: trialDir,
        noCache: true,
        tier: "final",
      });
      const selectedIndex = selectedFirst ? 0 : 1;
      const won = result.winnerIdx === selectedIndex;
      if (won) selectedWins++;
      const scores = result.candidates
        .map((candidate, index) => `${index === 0 ? "A" : "B"}=${candidate.clickScore ?? "?"}`)
        .join(" ");
      console.log(
        `${pair.key} trial ${trial + 1}: selected=${selectedFirst ? "A" : "B"} ` +
        `winner=${result.winnerIdx === 0 ? "A" : "B"} ${scores} ${won ? "PASS" : "FAIL"}`,
      );
      console.log(`  ${result.judgeWhy}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.ok(
    selectedWins >= 2,
    `${pair.key}: blind production selector chose the owner-selected render only ${selectedWins}/3 times`,
  );
  console.log(`${pair.key}: majority ${selectedWins}/3 PASS\n`);
}

async function main(): Promise<void> {
  for (const pair of PAIRS) await runPair(pair);
  console.log("BLIND OWNER THUMBNAIL PREFERENCE VALIDATION PASS");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
