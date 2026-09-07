/**
 * Do the five crew briefs fit in their ceilings?
 *
 * All five were raised to 2500 earlier in this pass by CONVENTION — the measured
 * list floor — not by measurement. synthShowBible then proved convention is not
 * enough: its contract is heavier than the floor was measured on, and at 2000 it
 * fell back on 2 of 8 attempts. These five deserve the same question, because
 * their contracts are also structured, not flat:
 *
 *   director     hook + beats[{name, intentSec, note}]
 *   dp           footageQueries[] + promptStyle + palette[] + motion + avoid[]
 *   editor       sections[{name, cutsPerMin}] + transitions + pacingNote
 *   composer     cue-sheet fields
 *   critic       assertions[{...}] — a findings-shaped list
 *
 * WHAT A FAILURE COSTS, and why it is not the same as the Show Bible. Each of
 * these catches, logs "BRIEF UNAVAILABLE — this video gets no <what>", and
 * returns undefined. That degradation is correct and it is loud. But it is
 * PER VIDEO rather than per channel: a starved director ceiling means this
 * video has no structure and no beats, and the next one might. A silently
 * intermittent brief is harder to notice than a permanently missing one.
 *
 * This runs the REAL brief functions against a real Show Bible, counts how often
 * each returns undefined, and reports the list sizes when it succeeds — a brief
 * that "succeeds" with an empty beats array is starved in a way a null check
 * would not catch.
 *
 * RESULT (3 trials each, at the current 2500):
 *
 *   director         3/3 usable, 0 undefined, 0 empty   mean 7.3 beats
 *   cinematographer  3/3 usable, 0 undefined, 0 empty   mean 11.3 footage queries
 *   editor           3/3 usable, 0 undefined, 0 empty   mean 5.0 sections
 *   composer         3/3 usable, 0 undefined, 0 empty
 *   critic           3/3 usable, 0 undefined, 0 empty   mean 9.3 assertions
 *
 * So 2500 holds for all five, and the convention that set it was right — here.
 * It was NOT right for synthShowBible, whose heavier contract fell back on 2 of
 * 8 attempts at 2000 and needed 4000. That is the whole reason to run this: a
 * convention that happens to be correct and a convention that is merely
 * unexamined look identical until someone measures.
 *
 * Re-run it after changing any crew prompt or schema. A brief that grows a field
 * eats the same budget the reasoning does.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/measure-crew-ceilings.ts
 */
import {
  briefDirector,
  briefCinematographer,
  briefEditor,
  briefComposer,
  briefCritic,
} from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const BIBLE: ShowBible = {
  positioning: "Evidence-led reconstructions of real unresolved cases, sourced and dated on screen.",
  vibe: "Cold, procedural, controlled. The facts carry the tension.",
  iconicMotif: "Desaturated reconstruction intercut with documentary evidence cards.",
  worksInSpace: [
    "a timeline the viewer can follow without a map",
    "naming what is not known",
    "a single sourced document held on screen long enough to read",
  ],
  avoidInSpace: ["speculation presented as fact", "true-crime melodrama", "gore"],
  activeCrew: [],
  directorDoctrine: "Front-load the unresolved question. Withhold the strongest evidence for the final third.",
  dpDoctrine: "Reconstruction is muted and handheld; evidence is locked-off and clinical.",
  editorDoctrine: "Cut on new information, never on rhythm alone.",
  composerDoctrine: "Sparse, low, and absent whenever a document is being read.",
  criticDoctrine: "Reject anything that reads as stock photography or a 3D render.",
  refreshedAt: 0,
};

const TRIALS = 3;

const ROLES = [
  {
    name: "director",
    run: () => briefDirector(BIBLE, ctx()),
    size: (out: unknown) => (out as { beats?: unknown[] })?.beats?.length ?? 0,
    what: "beats",
  },
  {
    name: "cinematographer",
    run: () => briefCinematographer(BIBLE, ctx()),
    size: (out: unknown) => (out as { footageQueries?: unknown[] })?.footageQueries?.length ?? 0,
    what: "footage queries",
  },
  {
    name: "editor",
    run: () => briefEditor(BIBLE, ctx()),
    size: (out: unknown) => (out as { sections?: unknown[] })?.sections?.length ?? 0,
    what: "sections",
  },
  {
    name: "composer",
    run: () => briefComposer(BIBLE, ctx()),
    size: () => 1,
    what: "cue sheet",
  },
  {
    name: "critic",
    run: () => briefCritic(BIBLE, ctx()),
    size: (out: unknown) => (out as { assertions?: unknown[] })?.assertions?.length ?? 0,
    what: "assertions",
  },
] as const;

const ctx = () => ({
  topic: "The 1971 skyjacking that was never solved",
  family: "narrated_stock",
  niche: "unsolved cases, evidence-led",
  channelName: "Casefile",
  targetSeconds: 600,
  log: () => {},
});

async function main(): Promise<void> {
  console.log("=== crew briefs at their current ceilings ===");
  console.log("undefined = the video gets NO brief for that role (logged, but per-video).\n");
  for (const role of ROLES) {
    let ok = 0;
    let empty = 0;
    const sizes: number[] = [];
    for (let trial = 0; trial < TRIALS; trial++) {
      const out = await role.run();
      if (!out) continue;
      const size = role.size(out);
      if (size === 0) empty++;
      else { ok++; sizes.push(size); }
    }
    const mean = sizes.length ? (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) : "-";
    console.log(
      `  ${role.name.padEnd(16)} ${ok}/${TRIALS} usable, ${TRIALS - ok - empty} undefined, ` +
        `${empty} empty   mean ${role.what}: ${mean}`,
    );
  }
  console.log(
    `\nAn "empty" result is the one to watch: the call SUCCEEDED and returned a brief\n` +
      `with no beats, no queries or no sections, which no null check catches and which\n` +
      `reads downstream exactly like a channel that wanted none.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
