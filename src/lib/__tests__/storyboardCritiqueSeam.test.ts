import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { produceAndCritique } from "@/engine/critiqueLoop";
import {
  motionComicOpeningPanelDefect,
  projectMotionComicVisualCharacter,
  projectMotionComicVisualScene,
  type MotionComicStoryboard,
} from "@/lib/motionComic";
import type { WhiteboardStoryboard } from "@/lib/whiteboardSync";
import { motionComicStoryboardDefects } from "@/trigger/blocks/motionComicBlocks";
import { whiteboardStoryboardDefects } from "@/trigger/blocks/whiteboardScribeBlocks";

// Phase 51: motion_comic and whiteboard_scribe were the last two paid engines
// with NO quality feedback — one unreviewed storyboard decided how the
// whole art + voice + music budget was spent. Both now expose a plan/render
// seam (planMotionComicStoryboard / planWhiteboardStoryboard + an optional
// `plan` arg on cast*), and their blocks critique the CHEAP storyboard before
// the single paid render.
//
// The load-bearing invariant these tests defend is the COST one: a critique
// rejection must cost one text call and NEVER a second paid render.

const SOURCE_ROOT = join(process.cwd(), "src");
const read = (relativePath: string): string => readFileSync(join(SOURCE_ROOT, relativePath), "utf8");

for (const engineFile of ["lib/motionComic.ts", "lib/whiteboardSync.ts"]) {
  const engine = read(engineFile);
  assert.match(
    engine,
    /import\s*\{[\s\S]*\bagentJson\b[\s\S]*\}\s*from "@\/agents\/mastra"/,
    `${engineFile}: the storyboard boundary must use the Studio's structured non-Google planner`,
  );
  assert.match(
    engine,
    /hasAnthropicKey\(\)/,
    `${engineFile}: readiness must require the non-Google planner rather than a thumbnail-only credential`,
  );
  assert.doesNotMatch(
    engine,
    /geminiJsonPro/,
    `${engineFile}: a self-contained storyboard may not silently route creative planning through Gemini`,
  );
}

/* ══════════════════════════ 1. motion_comic defects ══════════════════════════ */
//
// The Director is never asked to count — critiqueLoop's design rule. These are
// the deterministic checks that actually drive `pass`, run against realistic
// malformed storyboards rather than tautological fixtures.

function comicPanel(overrides: {
  shot?: "wide" | "medium" | "close";
  scene?: Record<string, unknown>;
  lines?: { speaker: string; text: string }[];
  characters?: string[];
} = {}): MotionComicStoryboard["panels"][number] {
  return {
    visual: projectMotionComicVisualScene({
      environment: "interior",
      era: "modern",
      subjects: ["reference_characters"],
      action: "deliberate_work",
      mood: "tense",
      lighting: "interior_light",
      ...(overrides.scene ?? {}),
    }),
    characters: overrides.characters ?? ["ada"],
    shot: overrides.shot ?? "medium",
    lines: overrides.lines ?? [
      { speaker: "narrator", text: "The workshop had been quiet for three days when the letter finally arrived." },
      { speaker: "ada", text: "We are out of time." },
    ],
  };
}

function comicStoryboard(panels: MotionComicStoryboard["panels"]): MotionComicStoryboard {
  return {
    title: "The Quiet Workshop",
    logline: "An engineer races a deadline she did not set.",
    narratorVoiceId: "storyteller",
    characters: [
      { id: "ada", name: "Ada", visual: projectMotionComicVisualCharacter({}), voiceId: "storyteller" },
      { id: "rey", name: "Rey", visual: projectMotionComicVisualCharacter({ age: "older" }), voiceId: "storyteller" },
    ],
    panels,
  };
}

{
  // The viewer sees this panel before any narration. A bare atmospheric
  // default produces a paid empty comic template, not a story hook.
  const emptyOpening = comicStoryboard([
    comicPanel({ scene: { environment: "atmospheric_exterior", era: "timeless", subjects: [], objects: [], action: "poised_action", mood: "mysterious", lighting: "daylight" } }),
    comicPanel({ shot: "wide", scene: { environment: "forest", subjects: ["traveler"], action: "discovering" } }),
    comicPanel({ shot: "close", scene: { environment: "temple", subjects: ["philosopher"], action: "contemplating", mood: "calm" } }),
    comicPanel({ shot: "medium", scene: { environment: "mountain", subjects: ["traveler"], action: "watchful_pause", mood: "mysterious" } }),
  ]);
  const defect = motionComicOpeningPanelDefect(emptyOpening);
  assert.match(defect ?? "", /opening panel has no visible subject or concrete object/);
  assert.ok(
    motionComicStoryboardDefects(emptyOpening, 4, 0).some((issue) => issue.includes("opening panel has no visible subject")),
    "the text-only critique must reject an empty opening before any paid panel art is requested",
  );
}

{
  // A healthy storyboard must produce NO deterministic defects — otherwise the
  // gate would reject everything and the loop would burn its whole cap.
  const healthy = comicStoryboard([
    comicPanel({ shot: "wide", scene: { environment: "urban_exterior", action: "purposeful_travel" } }),
    comicPanel({ shot: "close", scene: { environment: "interior", action: "examining", mood: "somber" } }),
    comicPanel({ shot: "medium", scene: { environment: "laboratory", action: "repairing", mood: "urgent" } }),
    comicPanel({ shot: "wide", scene: { environment: "waterfront", action: "reaching", mood: "hopeful" } }),
  ]);
  assert.deepEqual(
    motionComicStoryboardDefects(healthy, 4, 0),
    [],
    "a well-formed 4-panel storyboard must pass every deterministic check",
  );
}

{
  // Short return — the writer stopped early. Rendering it would buy a video
  // shorter than the operator asked for.
  const short = comicStoryboard([comicPanel(), comicPanel()]);
  const defects = motionComicStoryboardDefects(short, 6, 0);
  assert.ok(
    defects.some((issue) => issue.includes("only 2 of the 6 requested panels")),
    `a short storyboard must be caught deterministically, got: ${JSON.stringify(defects)}`,
  );
}

{
  // A line addressed to a non-cast speaker is SILENTLY re-voiced as the
  // narrator by the engine, so the bubble is bought in the wrong voice.
  const stray = comicStoryboard([
    comicPanel({ lines: [{ speaker: "ghost", text: "Who let you in here?" }] }),
    comicPanel({ shot: "wide", scene: { environment: "forest", action: "discovering" } }),
    comicPanel({ shot: "close", scene: { environment: "temple", action: "contemplating", mood: "calm" } }),
    comicPanel({ shot: "medium", scene: { environment: "mountain", action: "watchful_pause", mood: "mysterious" } }),
  ]);
  const defects = motionComicStoryboardDefects(stray, 4, 0);
  assert.ok(
    defects.some((issue) => issue.includes('"ghost"') && issue.includes("not in the cast")),
    `an uncast speaker must be caught before its voice is bought, got: ${JSON.stringify(defects)}`,
  );
}

{
  // Character bubbles over 12 words cover the art the engine just paid for.
  const wordy = comicStoryboard([
    comicPanel({
      lines: [
        { speaker: "narrator", text: "The letter sat unopened on the bench for a long while." },
        { speaker: "ada", text: "I have been telling you for weeks that this particular approach was never going to hold under load." },
      ],
    }),
    comicPanel({ shot: "wide", scene: { environment: "forest", action: "discovering" } }),
    comicPanel({ shot: "close", scene: { environment: "temple", action: "contemplating", mood: "calm" } }),
    comicPanel({ shot: "medium", scene: { environment: "mountain", action: "watchful_pause", mood: "mysterious" } }),
  ]);
  const defects = motionComicStoryboardDefects(wordy, 4, 0);
  assert.ok(
    defects.some((issue) => issue.includes("over 12 words")),
    `an oversized speech bubble must be caught, got: ${JSON.stringify(defects)}`,
  );
}

{
  // Consecutive panels identical in environment + action + mood + shot render
  // as duplicate art — two paid images for one visual.
  const duplicated = comicStoryboard([
    comicPanel({ shot: "medium", scene: { environment: "interior", action: "deliberate_work", mood: "tense" } }),
    comicPanel({ shot: "medium", scene: { environment: "interior", action: "deliberate_work", mood: "tense" } }),
    comicPanel({ shot: "close", scene: { environment: "temple", action: "contemplating", mood: "calm" } }),
    comicPanel({ shot: "wide", scene: { environment: "mountain", action: "watchful_pause", mood: "mysterious" } }),
  ]);
  const defects = motionComicStoryboardDefects(duplicated, 4, 0);
  assert.ok(
    defects.some((issue) => issue.includes("duplicate art")),
    `consecutive duplicate panels must be caught BEFORE both are rendered, got: ${JSON.stringify(defects)}`,
  );
}

{
  // A single-shot-scale story reads as a slideshow.
  const flat = comicStoryboard([
    comicPanel({ shot: "medium", scene: { environment: "interior", action: "deliberate_work" } }),
    comicPanel({ shot: "medium", scene: { environment: "forest", action: "discovering", mood: "hopeful" } }),
    comicPanel({ shot: "medium", scene: { environment: "temple", action: "contemplating", mood: "calm" } }),
    comicPanel({ shot: "medium", scene: { environment: "mountain", action: "watchful_pause", mood: "mysterious" } }),
  ]);
  assert.ok(
    motionComicStoryboardDefects(flat, 4, 0).some((issue) => issue.includes("vary wide/medium/close")),
    "a storyboard with one shot scale throughout must be flagged",
  );
}

{
  // Length drift: the engine budgets ~2.6 spoken words/second. A 180s target
  // against a handful of short lines would render a fraction of the ask.
  const thin = comicStoryboard([
    comicPanel({ lines: [{ speaker: "narrator", text: "It began." }] }),
    comicPanel({ shot: "wide", scene: { environment: "forest", action: "discovering" }, lines: [{ speaker: "narrator", text: "Then it ended." }] }),
    comicPanel({ shot: "close", scene: { environment: "temple", action: "contemplating", mood: "calm" }, lines: [{ speaker: "narrator", text: "Nothing more." }] }),
    comicPanel({ shot: "medium", scene: { environment: "mountain", action: "watchful_pause", mood: "mysterious" }, lines: [{ speaker: "narrator", text: "The end." }] }),
  ]);
  assert.ok(
    motionComicStoryboardDefects(thin, 4, 180).some((issue) => issue.includes("spoken words")),
    "a story far under the spoken-word budget for its target length must be flagged",
  );
  assert.deepEqual(
    motionComicStoryboardDefects(thin, 4, 0),
    [],
    "with NO target length the word-budget check must not fire — it is not a generic quality rule",
  );
}

console.log("storyboardCritiqueSeam.test.ts: motion_comic deterministic storyboard defects verified");

/* ═══════════════════════ 2. whiteboard_scribe defects ════════════════════════ */

function scribePanel(overrides: {
  narration?: string;
  layers?: WhiteboardStoryboard["panels"][number]["layers"];
  preserveNarrationLength?: boolean;
} = {}): WhiteboardStoryboard["panels"][number] {
  const rawNarration =
    overrides.narration ??
    "The railroads reached the coast in eighteen sixty nine, and the price of grain collapsed almost overnight.";
  // Healthy fixtures must have enough spoken time for the real visible hand
  // schedule. Short snippets are still available when a test is specifically
  // exercising word-budget behavior.
  const narration = overrides.preserveNarrationLength
    ? rawNarration
    : `${rawNarration} The new route connected farmers, warehouse clerks, shipping agents, price sheets, and distant buyers in a single visible chain, so every later drawing has a narrated reason to arrive before the board reaches its final hold. Viewers can follow the locomotive, the port ledger, the worried farmer, and the falling grain price as one causal sequence rather than a stack of unrelated icons.`;
  const words = narration.split(/\s+/).filter(Boolean);
  const cue = (start: number, count: number) => words.slice(start, start + count).join(" ");
  return {
    idx: 0,
    narration,
    layers: overrides.layers ?? [
      { kind: "art", role: "hero", draw: "a locomotive crossing a plain toward distant mountains with grain wagons and a rail signal", color: "black", cue: cue(0, 2), box: [0.12, 0.24, 0.42, 0.4] },
      { kind: "art", role: "evidence", draw: "a port crane loading a grain wagon beside a route ledger", color: "black", cue: cue(Math.max(2, Math.floor(words.length * 0.28)), 2), box: [0.62, 0.28, 0.18, 0.2] },
      { kind: "label", text: "1869", color: "red", cue: cue(Math.max(4, Math.floor(words.length * 0.50)), 2), box: [0.60, 0.62, 0.12, 0.08] },
      { kind: "art", role: "reaction", draw: "a worried farmer watching a grain price arrow fall beside the tracks", color: "black", cue: cue(Math.max(5, Math.floor(words.length * 0.58)), 2), box: [0.56, 0.52, 0.16, 0.22] },
      { kind: "art", role: "evidence", draw: "a sack of grain tipping over beside a price arrow and a competing market cart", color: "black", cue: cue(Math.max(6, Math.floor(words.length * 0.70)), 2), box: [0.74, 0.52, 0.17, 0.18] },
    ],
  };
}

function scribeStoryboard(panels: WhiteboardStoryboard["panels"]): WhiteboardStoryboard {
  const indexed = panels.map((panel, idx) => ({ ...panel, idx }));
  return {
    title: "How The Railroads Broke The Grain Market",
    panels: indexed,
    fullText: indexed.map((panel) => panel.narration).join(" "),
  };
}

{
  const healthy = scribeStoryboard([
    scribePanel(),
    scribePanel({ narration: "Freight costs fell by four fifths, so a farmer in Kansas suddenly competed with every farmer in Ohio." }),
    scribePanel({ narration: "Governments answered with tariffs, and the tariffs answered back with a decade of political fury." }),
    scribePanel({ narration: "By the end of the century the map of American agriculture had been redrawn by steel rails." }),
  ]);
  assert.deepEqual(
    whiteboardStoryboardDefects(healthy, 4, 0),
    [],
    "a well-formed 4-panel whiteboard storyboard must pass every deterministic check",
  );
}

{
  const sparse = scribeStoryboard([
    scribePanel({
      layers: [
        { kind: "art", draw: "one generic dollar icon", color: "black", cue: "The railroads reached", box: [0.18, 0.24, 0.42, 0.4] },
        { kind: "label", text: "1869", color: "red", cue: "eighteen sixty nine", box: [0.60, 0.62, 0.12, 0.08] },
      ],
    }),
    scribePanel(),
  ]);
  assert.ok(
    whiteboardStoryboardDefects(sparse, 2, 0).some((issue) => issue.includes("Golden whiteboard grammar")),
    "a single-icon board must be rejected before image generation rather than rationalized into a passing explainer",
  );
}

{
  // A panel with no art layers leaves the board BLANK while the voice speaks —
  // the exact failure mode the engine's own alignment backstop exists for.
  const blank = scribeStoryboard([
    scribePanel({ layers: [{ kind: "label", text: "1869", color: "red", cue: "eighteen sixty nine", box: [0.6, 0.62, 0.12, 0.08] }] }),
    scribePanel({ narration: "Freight costs fell by four fifths across the whole eastern network in under a decade." }),
  ]);
  const defects = whiteboardStoryboardDefects(blank, 2, 0);
  assert.ok(
    defects.some((issue) => issue.includes("no art layers")),
    `a panel with nothing to draw must be caught, got: ${JSON.stringify(defects)}`,
  );
}

{
  // Everything must clear the persistent title header (y >= 0.17) or it renders
  // on top of the header the python scribe draws every frame.
  const underHeader = scribeStoryboard([
    scribePanel({
      layers: [
        { kind: "art", draw: "a locomotive crossing a plain", color: "black", cue: "The railroads reached", box: [0.12, 0.05, 0.42, 0.4] },
        { kind: "art", draw: "a sack of grain tipping over", color: "black", cue: "price of grain", box: [0.62, 0.3, 0.18, 0.2] },
      ],
    }),
    scribePanel({ narration: "Freight costs fell by four fifths across the whole eastern network in under a decade." }),
  ]);
  assert.ok(
    whiteboardStoryboardDefects(underHeader, 2, 0).some((issue) => issue.includes("title header")),
    "a layer placed in the reserved header strip must be caught before its art is bought",
  );
}

{
  // The art prompt hard-forbids lettering; a draw instruction asking for words
  // buys an image that fights the engine's own hand-lettered labels.
  const lettered = scribeStoryboard([
    scribePanel({
      layers: [
        { kind: "art", draw: "a sign with the word STRIKE painted across it", color: "black", cue: "The railroads reached", box: [0.12, 0.24, 0.42, 0.4] },
        { kind: "art", draw: "a sack of grain tipping over", color: "black", cue: "price of grain", box: [0.62, 0.3, 0.18, 0.2] },
      ],
    }),
    scribePanel({ narration: "Freight costs fell by four fifths across the whole eastern network in under a decade." }),
  ]);
  assert.ok(
    whiteboardStoryboardDefects(lettered, 2, 0).some((issue) => issue.includes("draw words")),
    "art that asks for lettering must be caught — the renderer is hard-instructed to omit text",
  );
}

{
  // No hero scene (every art layer below the engine's own w >= 0.32 scene
  // threshold) means the panel is scattered icons with no composed visual.
  const noHero = scribeStoryboard([
    scribePanel({
      layers: [
        { kind: "art", draw: "a small locomotive icon", color: "black", cue: "The railroads reached", box: [0.12, 0.24, 0.18, 0.2] },
        { kind: "art", draw: "a sack of grain tipping over", color: "black", cue: "price of grain", box: [0.62, 0.3, 0.18, 0.2] },
      ],
    }),
    scribePanel({ narration: "Freight costs fell by four fifths across the whole eastern network in under a decade." }),
  ]);
  assert.ok(
    whiteboardStoryboardDefects(noHero, 2, 0).some((issue) => issue.includes("no hero scene")),
    "a panel with no larger composed scene must be flagged against the engine's own 0.32 scene threshold",
  );
}

{
  const blankLabel = scribeStoryboard([
    scribePanel({
      layers: [
        { kind: "art", draw: "a locomotive crossing a plain", color: "black", cue: "The railroads reached", box: [0.12, 0.24, 0.42, 0.4] },
        { kind: "label", text: "   ", color: "red", cue: "eighteen sixty nine", box: [0.6, 0.62, 0.12, 0.08] },
      ],
    }),
    scribePanel({ narration: "Freight costs fell by four fifths across the whole eastern network in under a decade." }),
  ]);
  assert.ok(
    whiteboardStoryboardDefects(blankLabel, 2, 0).some((issue) => issue.includes("no text")),
    "a label layer with nothing to letter must be flagged",
  );
}

{
  const thin = scribeStoryboard([scribePanel({ preserveNarrationLength: true }), scribePanel({ narration: "Then prices fell across every grain town at once for years.", preserveNarrationLength: true })]);
  assert.ok(
    whiteboardStoryboardDefects(thin, 2, 600).some((issue) => issue.includes("spoken words")),
    "a script far under the requested word budget must be flagged",
  );
  assert.ok(
    !whiteboardStoryboardDefects(thin, 2, 0).some((issue) => issue.includes("spoken words")),
    "with NO target word count the script-length budget must not fire (the independent hand-capacity gate may still reject the board)",
  );
}

console.log("storyboardCritiqueSeam.test.ts: whiteboard_scribe deterministic storyboard defects verified");

/* ═════════════ 3. COST SAFETY — rejection never buys a second render ═════════ */
//
// The real produceAndCritique loop, driven exactly the way both blocks drive
// it: N cheap planning candidates, then ONE paid render of the settled plan.
// A render spy counts every simulated paid call; a Director that rejects
// everything must not move that counter until the loop has already returned.

async function renderOnceAfterCritique(args: {
  maxIters: number;
  alwaysReject: boolean;
}): Promise<{ plans: number; renders: number; rendersDuringLoop: number; iterations: number }> {
  let plans = 0;
  let renders = 0;
  let rendersDuringLoop = 0;
  let loopRunning = false;

  // Stands in for castMotionComic / castWhiteboardSync — the ONLY paid call.
  const paidRender = async (): Promise<string> => {
    renders++;
    if (loopRunning) rendersDuringLoop++;
    return "final.mp4";
  };

  loopRunning = true;
  const loop = await produceAndCritique<{ id: number }>({
    label: "storyboard-cost-safety",
    threshold: 0.8,
    maxIters: args.maxIters,
    produce: async () => {
      plans++;
      return { id: plans };
    },
    critique: async () =>
      args.alwaysReject
        ? { score: 0.2, pass: false, issues: ["panel 1 restates panel 0 — advance the story"] }
        : { score: 0.95, pass: true, issues: [] },
  });
  loopRunning = false;

  assert.ok(loop.value, "the loop must always hand back a candidate, accepted or best-of");
  await paidRender();
  return { plans, renders, rendersDuringLoop, iterations: loop.iterations };
}

async function verifyCostSafety(): Promise<void> {
  {
    // Every candidate rejected: the loop burns its full cap in TEXT calls and
    // the paid render still happens exactly once, after the loop.
    const rejected = await renderOnceAfterCritique({ maxIters: 2, alwaysReject: true });
    assert.equal(rejected.plans, 2, "a rejection must trigger exactly one informed re-plan within the 2-iteration cap");
    assert.equal(rejected.iterations, 2, "the loop must report both attempts");
    assert.equal(
      rejected.rendersDuringLoop,
      0,
      "COST INVARIANT: a critique rejection must NEVER reach the paid render path",
    );
    assert.equal(
      rejected.renders,
      1,
      "COST INVARIANT: two rejected storyboards must still cost exactly ONE paid render, not two",
    );
  }

  {
    // Accepted on the first candidate: one plan, one render — a passing
    // storyboard must not cost more than it did before the loop existed.
    const accepted = await renderOnceAfterCritique({ maxIters: 2, alwaysReject: false });
    assert.equal(accepted.plans, 1, "an accepted first candidate must not trigger a second planning call");
    assert.equal(accepted.renders, 1, "an accepted storyboard costs exactly one render");
    assert.equal(accepted.rendersDuringLoop, 0, "no render may happen inside the loop even on the happy path");
  }

  {
    // Raising the iteration cap must scale TEXT calls only — never renders.
    const deep = await renderOnceAfterCritique({ maxIters: 5, alwaysReject: true });
    assert.equal(deep.plans, 5, "more iterations must buy more cheap storyboards");
    assert.equal(
      deep.renders,
      1,
      "COST INVARIANT: iteration count must scale text spend ONLY — the paid render stays at exactly one",
    );
  }

  console.log("storyboardCritiqueSeam.test.ts: rejection→re-plan costs text only; exactly ONE paid render regardless of iterations");
}

/* ═══════════ 4. STRUCTURAL — the loop and the paid render are disjoint ═══════ */
//
// The counting test above proves the SHAPE is safe. These assertions prove both
// blocks are actually wired in that shape: the critique loop lives entirely in
// the helper region ABOVE the exported Block, and the single paid cast* call
// lives entirely inside the Block's run(). Nothing can regress one into the
// other without failing here.

function splitAtBlock(source: string, blockMarker: string): { helpers: string; blockBody: string } {
  const index = source.indexOf(blockMarker);
  assert.ok(index > 0, `expected to find the exported block declaration "${blockMarker}"`);
  return { helpers: source.slice(0, index), blockBody: source.slice(index) };
}

const SEAMS = [
  {
    label: "motion_comic",
    blockFile: "trigger/blocks/motionComicBlocks.ts",
    blockMarker: "export const motionComicBlock: Block = {",
    castCall: "castMotionComic({",
    engineFile: "lib/motionComic.ts",
    planFn: "export async function planMotionComicStoryboard(",
    castFn: "export async function castMotionComic(args: {",
  },
  {
    label: "whiteboard_scribe",
    blockFile: "trigger/blocks/whiteboardScribeBlocks.ts",
    blockMarker: "export const whiteboardScribe: Block = {",
    castCall: "castWhiteboardSync({",
    engineFile: "lib/whiteboardSync.ts",
    planFn: "export async function planWhiteboardStoryboard(",
    castFn: "export async function castWhiteboardSync(args: {",
  },
] as const;

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

for (const seam of SEAMS) {
  const source = read(seam.blockFile);
  const { helpers, blockBody } = splitAtBlock(source, seam.blockMarker);

  assert.equal(
    countOf(source, "produceAndCritique<"),
    1,
    `${seam.label}: exactly one critique loop must exist`,
  );
  assert.equal(
    countOf(helpers, "produceAndCritique<"),
    1,
    `${seam.label}: the critique loop must live in the planning helpers, above the block`,
  );
  assert.equal(
    countOf(blockBody, "produceAndCritique"),
    0,
    `${seam.label}: no critique loop may run inside the block's paid run()`,
  );

  assert.equal(
    countOf(source, seam.castCall),
    1,
    `${seam.label}: the paid engine must be invoked exactly once in the whole file`,
  );
  assert.equal(
    countOf(helpers, seam.castCall),
    0,
    `COST INVARIANT (${seam.label}): the paid render must be unreachable from the critique loop's helpers`,
  );
  assert.equal(
    countOf(blockBody, seam.castCall),
    1,
    `${seam.label}: the single paid render must sit inside the block's run()`,
  );

  // The accepted storyboard must actually be handed to the engine — otherwise
  // the loop would be decorative and the engine would re-plan at full price.
  assert.ok(
    /\bplan:\s*storyboard\b/.test(blockBody),
    `${seam.label}: the critique-approved storyboard must be passed to the engine as \`plan\``,
  );

  // Content-addressed freeze: a healer replay must reload the same storyboard
  // rather than re-planning (and thus re-rendering different art).
  assert.ok(
    helpers.includes("createHash(\"sha256\")") && helpers.includes("STORYBOARD_CHECKPOINT_VERSION"),
    `${seam.label}: the accepted storyboard must be frozen into a content-addressed checkpoint`,
  );
  assert.ok(
    /loadStoryboardCheckpoint\(checkpointKey\)/.test(helpers),
    `${seam.label}: the frozen storyboard must be reloaded before any planning call`,
  );

  // Channel doctrine must reach the critique, like the rest of the pipeline.
  assert.ok(
    helpers.includes("channelCritiqueBrief(") && helpers.includes("criticDoctrine"),
    `${seam.label}: the Director must be grounded in this channel's doctrine`,
  );
}

console.log("storyboardCritiqueSeam.test.ts: both blocks wire critique on the plan, render once, and freeze the accepted storyboard");

/* ═══════════ 5. STRUCTURAL — the engines' plan half spends nothing ═══════════ */
//
// planXStoryboard is only safe to call in a loop if it is genuinely text-only.
// These assertions pin that: no image generator, no TTS, no music, no renderer
// may be reachable from the planning function's body.

const PAID_SYMBOLS = [
  "generateImage",
  "synthNarration",
  "elevenDialogue",
  "runPy(",
  "run(\"ffmpeg\"",
  "preflightPythonRenderer",
  "musicTrack",
  "sunoTrack",
];

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start > 0, `expected to find "${signature}"`);
  // Bodies here are top-level declarations, so the next line that is exactly
  // "}" at column zero closes them.
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  assert.ok(end > 0, `expected a top-level close for "${signature}"`);
  return rest.slice(0, end);
}

for (const seam of SEAMS) {
  const engine = read(seam.engineFile);
  const planBody = functionBody(engine, seam.planFn);
  for (const symbol of PAID_SYMBOLS) {
    assert.ok(
      !planBody.includes(symbol),
      `COST INVARIANT (${seam.label}): the planning half must not reach "${symbol}" — it is called repeatedly inside a critique loop`,
    );
  }

  // The seam itself: cast* must accept an optional pre-approved plan and, when
  // given one, must not fall through to the planner.
  const castSignature = engine.slice(engine.indexOf(seam.castFn), engine.indexOf(seam.castFn) + 900);
  assert.ok(
    /plan\?:\s*(?:MotionComicStoryboard|WhiteboardStoryboard);/.test(castSignature),
    `${seam.label}: cast* must accept an optional pre-approved storyboard`,
  );
  assert.ok(
    engine.includes("legacyPlan: args.plan,") && engine.includes("if (approvedPlan) {"),
    `${seam.label}: a supplied storyboard must short-circuit the engine's own planning branch through the sealed-plan resolver`,
  );
}

{
  // Zero behaviour change for callers that do NOT supply a plan: both engines
  // must still contain their original self-planning fallback branch.
  const comic = read("lib/motionComic.ts");
  assert.ok(
    comic.includes("plan = await planMotionComicStoryboard(brief, log);"),
    "motion_comic: a caller that supplies no plan must still get the engine's own storyboard",
  );
  const scribe = read("lib/whiteboardSync.ts");
  assert.ok(
    scribe.includes("await buildStoryboard(brief, log)"),
    "whiteboard_scribe: a caller that supplies no plan must still get the engine's own storyboard",
  );
  // The revision clause must be inert when no critique issues are carried, so
  // an un-critiqued call sends the byte-identical original prompt.
  for (const source of [comic, scribe]) {
    assert.ok(
      source.includes("if (!notes.length) return \"\";"),
      "an empty revision note list must render an empty clause — no prompt drift for un-critiqued callers",
    );
    assert.ok(
      source.includes("revisionNotes: readonly string[] = []"),
      "revisionNotes must default to empty so existing call sites are unchanged",
    );
  }
}

console.log("storyboardCritiqueSeam.test.ts: plan half is provably text-only; cast* keeps its original self-planning path");

// The cost-safety loop is async; tsx transpiles these tests to CJS, so it runs
// here rather than at top level.
verifyCostSafety()
  .then(() => {
    console.log("storyboardCritiqueSeam.test.ts: all storyboard plan/critique seam checks passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
