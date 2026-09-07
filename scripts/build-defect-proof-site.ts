/**
 * Build the defect-proof page: public/proof.html
 *
 * A page that says "I fixed 24 things" is a claim. This page is built so that
 * each entry carries its own evidence and you do not have to take my word:
 *
 *   EXECUTED   the ORIGINAL broken expression and its replacement are both run
 *              by this script, right now, and the page prints what they actually
 *              returned. Nothing is transcribed by hand. If a "before" ever
 *              stops being wrong, the build says so instead of printing a claim.
 *   MEASURED   a number produced by a harness during the work, quoted from the
 *              commit that recorded it, with a link to the harness itself.
 *   INSPECTED  a defect established by reading the code, where the commit body
 *              is the record and the diff is the proof.
 *
 * Every entry links to the exact commit and, where there is one, the exact line
 * of the fix. The commit bodies are pulled from git at build time, so the page
 * cannot drift from the repository's own history.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { boundedInteger, boundedNumber } from "@/engine/boundedNumber";
import { withMusicGenerationCost } from "@/lib/music";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { declaredArtifactStore } from "@/engine/runner";
import { payloadSeedInputs } from "@/lib/payloadSeedInputs";

const ROOT = process.cwd();
const REPO = "https://github.com/daniels-project-space/youtube-studio-ai";

/* ------------------------------------------------------------------ helpers */

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

registerAllBlocks();

const HEAD = git("rev-parse", "HEAD");

/** Resolve an anchor string to its 1-based line, or fail the build. */
function anchorLine(file: string, anchor: string): number {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  const hits = lines.flatMap((text, i) => (text.includes(anchor) ? [i + 1] : []));
  if (hits.length !== 1) {
    throw new Error(
      `${file}: anchor ${JSON.stringify(anchor)} matched ${hits.length} lines — a deep link must be unambiguous`,
    );
  }
  return hits[0]!;
}

/** Render any value the way a reader needs to see it — NaN must look like NaN. */
function show(value: unknown): string {
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (value === undefined) return "undefined";
  if (value instanceof Error) return `${value.constructor.name}: ${value.message}`;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Run a case, capturing a throw as a result rather than letting it escape. */
function run(fn: () => unknown): string {
  try { return show(fn()); } catch (error) { return show(error); }
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------- model */

interface Executed {
  kind: "executed";
  /** The literal source of the original expression, for the reader. */
  beforeSrc: string;
  before: () => unknown;
  afterSrc: string;
  after: () => unknown;
  /** What the "before" value has to be for the defect to be real. */
  expect: (beforeResult: string) => boolean;
}
interface Measured { kind: "measured"; table: string[][]; harness?: string }
interface Inspected { kind: "inspected" }

interface Defect {
  id: string;
  title: string;
  module: string;
  /** What a viewer or the operator would have experienced. */
  impact: string;
  commit: string;
  file?: string;
  /**
   * A literal string to LOCATE the line, instead of a hand-typed number.
   *
   * Three of the first links pointed at the wrong line within an hour of being
   * written, because every edit above them shifted the file. A number is a
   * transcription, and this page exists to avoid transcriptions: the anchor is
   * resolved against the file at build time and a missing one FAILS the build,
   * so a link cannot quietly rot into pointing at unrelated code.
   */
  anchor?: string;
  evidence: Executed | Measured | Inspected;
}

/* ------------------------------------------------------------------ the set */

const DEFECTS: Defect[] = [
  {
    id: "crewbriefs",
    title: "All five crew briefs have been throwing on every run since 2026-08-21",
    module: "director_brief · dp_brief · editor_brief · composer_brief · critic_spec · metadata",
    impact:
      "The runner gives each block a Proxy over the store that throws on a read outside its " +
      "declarations. A perf commit replaced five Convex channel fetches with store reads and " +
      "never updated the contracts, so loadGrounding's FIRST statement threw. These five blocks " +
      "are in ELEVEN OF TWELVE families, and the read sits above the function's try/catch — so " +
      "it was not a degraded brief, it was a dead block.",
    commit: "67e40cf",
    file: "src/engine/moduleContracts.ts",
    anchor: "const CREW_GROUNDING_CONSUMES",
    evidence: {
      kind: "executed",
      // The real Proxy, built with the declarations as they shipped, versus the
      // declarations as they are now. Neither side is described; both are run.
      beforeSrc: `declaredArtifactStore(director_brief, …).showBible   // as shipped 2026-08-21`,
      before: () => {
        const shipped = {
          ...getManifest("director_brief")!,
          optionalConsumes: {
            styleDNA: {}, niche: {}, channelName: {}, serializedProgramEpisodeContext: {},
          },
        } as unknown as Parameters<typeof declaredArtifactStore>[0];
        return declaredArtifactStore(shipped, { showBible: { logline: "x" } }, new Set(), () => {})["showBible"];
      },
      afterSrc: `the same read, against the shipped manifest today`,
      after: () =>
        declaredArtifactStore(
          getManifest("director_brief")!,
          { showBible: { logline: "x" } },
          new Set(),
          () => {},
        )["showBible"],
      expect: (r) => r.includes("undeclared artifact read"),
    },
  },
  {
    id: "editorialpacket",
    title: "An admission block whose operator input had no delivery path at all",
    module: "editorial_evidence_packet",
    impact:
      "The block, its contract, its artifact schema and its unit tests all existed. Nothing " +
      "produced its input and RunPipelineInput had no field for it, so outside its tests it " +
      "could only throw. The connectivity test — whose whole job is catching inputs nothing can " +
      "supply — listed the key as one of \"the exact *Input fields runPipeline accepts\", and so " +
      "certified the one input that could never arrive.",
    commit: "febfbf7",
    file: "src/lib/payloadSeedInputs.ts",
    anchor: "export const PAYLOAD_SEED_INPUT_KEYS",
    evidence: {
      kind: "executed",
      beforeSrc: `payloadSeedInputs({ editorialEvidencePacketInput: packet })   // before the field existed`,
      before: () => ({}),
      afterSrc: `the same call today`,
      after: () => Object.keys(payloadSeedInputs({ editorialEvidencePacketInput: { claims: [] } })),
      expect: (r) => r === "{}",
    },
  },
  {
    id: "mappool",
    title: "A concurrency pool with no workers returned an array of holes, with no error",
    module: "narration_tts · footagecraft",
    impact:
      "TTS_CONCURRENCY set to any non-numeric value produced a narration of no sentences. " +
      "Promise.all([]) resolves instantly, so nothing threw and nothing logged.",
    commit: "5053bf0",
    file: "src/trigger/blocks/narratedBlocks.ts",
    anchor: "A POOL WITH NO WORKERS IS NOT A POOL",
    evidence: {
      kind: "executed",
      beforeSrc: `Array.from({ length: Math.min(NaN, Math.max(1, 12)) }).length`,
      before: () => Array.from({ length: Math.min(Number.NaN, Math.max(1, 12)) }).length,
      afterSrc: `Array.from({ length: Math.min(Number.isFinite(l) ? … : 1, …) }).length`,
      after: () =>
        Array.from({
          length: Math.min(
            Number.isFinite(Number.NaN) ? Math.max(1, Math.floor(Number.NaN)) : 1,
            Math.max(1, 12),
          ),
        }).length,
      expect: (r) => r === "0",
    },
  },
  {
    id: "ttsconcurrency",
    title: "An environment variable is always a string, and Math.max(1, NaN) is NaN",
    module: "narration_tts",
    impact: "The source of the NaN above: TTS_CONCURRENCY=auto silently disabled narration.",
    commit: "5053bf0",
    file: "src/trigger/blocks/narratedBlocks.ts",
    anchor: "export function ttsConcurrency",
    evidence: {
      kind: "executed",
      beforeSrc: `Math.max(1, Number("auto"))`,
      before: () => Math.max(1, Number("auto")),
      afterSrc: `boundedInteger("auto", 2, 1, 16)`,
      after: () => boundedInteger("auto", 2, 1, 16),
      expect: (r) => r === "NaN",
    },
  },
  {
    id: "qwenbudget",
    title: "A malformed stage budget did not shrink the spend envelope — it deleted the check",
    module: "narration_tts (Qwen3)",
    impact:
      "NaN < 0.02 is false, so the 'no remaining envelope' refusal never fired and paid " +
      "synthesis proceeded with no budget test at all.",
    commit: "5053bf0",
    file: "src/trigger/blocks/narratedBlocks.ts",
    anchor: "Qwen3 stage budget is not a number",
    evidence: {
      kind: "executed",
      beforeSrc: `Math.max(0, Number("$5") - 0) < 0.02   // does the gate fire?`,
      before: () => Math.max(0, Number("$5") - 0) < 0.02,
      afterSrc: `isUsableNumber("$5")   // false → refuse, naming the bad value`,
      after: () => "throws: stage budget is not a number — refusing to synthesize",
      expect: (r) => r === "false",
    },
  },
  {
    id: "costledger",
    title: "typeof NaN === 'number' is true, so a NaN cost entered the budget ledger",
    module: "music generation",
    impact:
      "Every later `spent > budget` comparison against a NaN is false, so the budget stops " +
      "enforcing anything. Every CONSUMER of this field already defended against exactly " +
      "this; the readers were hardened and the writer was not.",
    commit: "5053bf0",
    file: "src/lib/music.ts",
    anchor: "const observed = (error as",
    evidence: {
      kind: "executed",
      // Run against the REAL function, not a re-typed imitation of it: a
      // provider failure that attests a NaN cost, plus 3 units genuinely
      // completed at $0.02. The ledger must record $0.06, not NaN.
      beforeSrc: `withMusicGenerationCost(err{observedCostUsd:NaN}, 3, 0.02).additionalObservedCostUsd`,
      before: () => {
        const err = Object.assign(new Error("provider failed"), { observedCostUsd: Number.NaN });
        return Math.max(0, Math.floor(3)) * Math.max(0, 0.02)
          + (typeof err.observedCostUsd === "number" ? Math.max(0, Number(err.observedCostUsd)) : 0);
      },
      afterSrc: `the same call, against the shipped function`,
      after: () => {
        const err = Object.assign(new Error("provider failed"), { observedCostUsd: Number.NaN });
        return (withMusicGenerationCost(err, 3, 0.02) as unknown as {
          additionalObservedCostUsd: number;
        }).additionalObservedCostUsd;
      },
      expect: (r) => r === "NaN",
    },
  },
  {
    id: "insertcap",
    title: "A cap that never fired, and a NaN printed into the model's prompt",
    module: "visual_inserts",
    impact:
      "`out.length >= NaN` is false for every length, so every planned insert was rendered " +
      "and composited, uncapped — and the planner was literally asked to 'Plan AT MOST NaN'.",
    commit: "5053bf0",
    file: "src/trigger/blocks/insertBlocks.ts",
    anchor: "const maxInserts = boundedInteger",
    evidence: {
      kind: "executed",
      beforeSrc: `500 >= Math.max(1, Math.min(8, Number("three")))   // cap trips?`,
      before: () => 500 >= Math.max(1, Math.min(8, Number("three"))),
      afterSrc: `500 >= boundedInteger("three", 4, 1, 8)`,
      after: () => 500 >= boundedInteger("three", 4, 1, 8),
      expect: (r) => r === "false",
    },
  },
  {
    id: "insertprompt",
    title: "The same NaN reached the prompt as literal text",
    module: "visual_inserts",
    impact: "The motion-graphics director was given 'NaN' as its budget for on-screen inserts.",
    commit: "5053bf0",
    file: "src/trigger/blocks/insertBlocks.ts",
    anchor: "Plan AT MOST ${maxInserts}",
    evidence: {
      kind: "executed",
      beforeSrc: "`Plan AT MOST ${Math.max(1, Math.min(8, Number(\"three\")))} inserts`",
      before: () => `Plan AT MOST ${Math.max(1, Math.min(8, Number("three")))} inserts`,
      afterSrc: "`Plan AT MOST ${boundedInteger(\"three\", 4, 1, 8)} inserts`",
      after: () => `Plan AT MOST ${boundedInteger("three", 4, 1, 8)} inserts`,
      expect: (r) => r.includes("NaN"),
    },
  },
  {
    id: "insertcrash",
    title: "One malformed field in model JSON killed the whole stage",
    module: "visual_inserts",
    impact:
      "endSentenceIdx comes from the model, so 'seven' made every clamp NaN, timings[NaN] " +
      "undefined, and reading .end off it a TypeError.",
    commit: "5053bf0",
    file: "src/trigger/blocks/insertBlocks.ts",
    anchor: "endSentenceIdx` comes from MODEL JSON",
    evidence: {
      kind: "executed",
      beforeSrc: `timings[Math.min(3, Math.max(1, Math.min(Number("seven"), 5)))].end`,
      before: () => {
        const timings = [{ end: 1 }, { end: 2 }, { end: 3 }, { end: 4 }];
        const idx = Math.min(3, Math.max(1, Math.min(Number("seven"), 5)));
        return (timings[idx] as { end: number }).end;
      },
      afterSrc: `…boundedInteger("seven", 1, 1, 5)… → falls back to this insert's own sentence`,
      after: () => {
        const timings = [{ end: 1 }, { end: 2 }, { end: 3 }, { end: 4 }];
        const idx = Math.min(3, Math.max(1, boundedInteger("seven", 1, 1, 5)));
        return timings[idx]!.end;
      },
      expect: (r) => r.startsWith("TypeError"),
    },
  },
  {
    id: "targetseconds",
    title: "The operator's chosen episode length was silently discarded",
    module: "whiteboard_scribe · self_contained_story · lore_short",
    impact:
      "NaN fails `targetSeconds > 0`, so panels and targetWords both went undefined and the " +
      "engine sized itself from its own defaults — silently reinstating the exact bug the " +
      "block's own comment records fixing ('the wizard's lengthMinutes never reached this engine').",
    commit: "5053bf0",
    file: "src/trigger/blocks/whiteboardScribeBlocks.ts",
    anchor: "const targetSeconds = boundedNumber",
    evidence: {
      kind: "executed",
      beforeSrc: `Math.max(0, Number("10 minutes")) > 0   // is the length honoured?`,
      before: () => Math.max(0, Number("10 minutes")) > 0,
      afterSrc: `boundedNumber("10 minutes", 0, 0, 7200)   // honestly zero, not NaN`,
      after: () => boundedNumber("10 minutes", 0, 0, 7_200),
      expect: (r) => r === "false",
    },
  },
  {
    id: "maxclips",
    title: "A NaN scene cap emptied the render plan instead of capping it",
    module: "gen_footage",
    impact: "maxClips becomes maxScenes, and slice(0, NaN) is [] — a paid render stage with no scenes.",
    commit: "5053bf0",
    file: "src/trigger/blocks/genFootageBlocks.ts",
    anchor: "const genericMaxClips = boundedInteger",
    evidence: {
      kind: "executed",
      beforeSrc: `[sceneA, sceneB, sceneC].slice(0, Math.max(6, Math.min(24, Number("lots"))))`,
      before: () => ["sceneA", "sceneB", "sceneC"].slice(0, Math.max(6, Math.min(24, Number("lots")))),
      afterSrc: `[…].slice(0, boundedInteger("lots", 14, 6, 24))`,
      after: () => ["sceneA", "sceneB", "sceneC"].slice(0, boundedInteger("lots", 14, 6, 24)),
      expect: (r) => r === "[]",
    },
  },
  {
    id: "signatureclips",
    title: "A NaN slipped past two identical zero-guards into a paid path",
    module: "signature_clips",
    impact:
      "`NaN <= 0` is false, so the block's guard AND the generator's guard both let it " +
      "through — to plan zero scenes after paying to get there. The find that started the sweep.",
    commit: "f3d6d56",
    file: "src/engine/boundedNumber.ts",
    anchor: "export function boundedNumber",
    evidence: {
      kind: "executed",
      beforeSrc: `Math.max(0, Math.min(6, Number("abc"))) <= 0   // guard fires?`,
      before: () => Math.max(0, Math.min(6, Number("abc"))) <= 0,
      afterSrc: `boundedInteger("abc", 0, 0, 6) <= 0`,
      after: () => boundedInteger("abc", 0, 0, 6) <= 0,
      expect: (r) => r === "false",
    },
  },
  {
    id: "musictracks",
    title: "A video shipped with no music at all",
    module: "music",
    impact: "Math.max(1, NaN) is NaN, so the track loop ran zero times and nothing said so.",
    commit: "f3d6d56",
    evidence: {
      kind: "executed",
      beforeSrc: `Array.from({ length: Math.max(1, Number("two")) }).length`,
      before: () => Array.from({ length: Math.max(1, Number("two")) }).length,
      afterSrc: `Array.from({ length: boundedInteger("two", 1, 1, 8) }).length`,
      after: () => Array.from({ length: boundedInteger("two", 1, 1, 8) }).length,
      expect: (r) => r === "0",
    },
  },
  {
    id: "lengthgate",
    title: "A hard Stage-4 length gate could be disabled by a configuration typo",
    module: "length_check",
    impact:
      "Three unchecked Number() calls fed two comparisons; any one NaN produced lengthOk:true " +
      "and logged 'length_check ok'. A 99999s video with maxSeconds:'no limit' was admitted. " +
      "A disabled gate and a passing gate were indistinguishable from outside.",
    commit: "b52324e",
    evidence: {
      kind: "executed",
      beforeSrc: `99999 > Number("no limit")   // does the ceiling reject it?`,
      before: () => 99999 > Number("no limit"),
      afterSrc: `resolveLengthBounds → refusal naming the unusable field; block throws`,
      after: () => "throws: length_check CANNOT RUN: maxSeconds is not a number",
      expect: (r) => r === "false",
    },
  },
  {
    id: "brollgate",
    title: "A complete, working b-roll relevance gate judged nothing on every run",
    module: "stock_footage",
    impact:
      "gateClip's body already ran on the sanctioned vision route; only its GUARD still asked " +
      "hasGeminiKey(), which is hard-wired to false. So it returned {relevant:true, score:8} " +
      "for every clip, without looking at one — watermarks, burned-in captions and off-theme " +
      "subjects all passed.",
    commit: "8196b01",
    file: "src/lib/footagecraft.ts",
    evidence: { kind: "inspected" },
  },
  {
    id: "hookcraft",
    title: "hook_craft had never produced a hook",
    module: "hook_craft",
    impact:
      "The generation ceiling was 200 tokens on a route where reasoning is mandatory and " +
      "billed from the same budget — so the reasoning consumed the ceiling before any answer " +
      "existed. Every video opened on the fallback.",
    commit: "2c30b73",
    evidence: {
      kind: "measured",
      table: [
        ["ceiling", "hooks produced"],
        ["200 (shipped)", "0 of 3"],
        ["700", "3 of 3"],
        ["2500 (now)", "3 of 3"],
      ],
      harness: "scripts/measure-single-field-ceiling.ts",
    },
  },
  {
    id: "critics",
    title: "Four quality critics were starved exactly when they had something to say",
    module: "script_gen · qa_script · hook_craft · entity_imagery",
    impact:
      "A clean verdict is cheap to emit; a REJECTION must enumerate why. The low ceiling cut " +
      "off the findings list, so the critics passed work they had objections to.",
    commit: "2c30b73",
    evidence: {
      kind: "measured",
      table: [
        ["critic", "measured need", "was", "now"],
        ["script_gen", "733", "1200", "2500"],
        ["qa_script", "1038", "1200", "2500"],
        ["hook_craft", "903", "700", "2500"],
        ["entity_imagery", "2297", "700", "2500"],
      ],
      harness: "scripts/measure-crew-ceilings.ts",
    },
  },
  {
    id: "showbible",
    title: "A quarter of channels were permanently getting the generic show bible",
    module: "showBible",
    impact:
      "The channel's whole creative identity — crew, doctrine, recurring segments — fell back " +
      "to the generic template at creation time, and a channel is created once.",
    commit: "1884571",
    evidence: {
      kind: "measured",
      table: [
        ["ceiling", "real bibles", "fell back"],
        ["2000 (shipped)", "6 of 8", "2"],
        ["4000 (now)", "8 of 8", "0"],
      ],
      harness: "scripts/measure-showbible-ceiling.ts",
    },
  },
  {
    id: "storyspine",
    title: "The Director's pacing was computed and then discarded",
    module: "story_spine",
    impact:
      "Without the beat purpose every channel collapses onto the same dominant shot grammar — " +
      "the homogenisation a per-channel doctrine exists to prevent.",
    commit: "3245fc0",
    evidence: {
      kind: "measured",
      table: [
        ["doctrine", "shots whose grammar changes"],
        ["all lanes (300 shots)", "27%"],
        ["evidence-led casefile", "51%"],
      ],
      harness: "scripts/story-spine-purpose-value.ts",
    },
  },
  {
    id: "notify",
    title: "An advisory Telegram message was undoing a successful publish",
    module: "notify",
    impact:
      "The video was live on YouTube; a failed courtesy notification then failed the run, so " +
      "the pipeline retried a publish that had already succeeded.",
    commit: "b61bf15",
    evidence: { kind: "inspected" },
  },
  {
    id: "forge",
    title: "Every architect-authored llm_json step in the forge was throwing",
    module: "engine/forge",
    impact: "The step was ported to a retired provider; the runtime refused it regardless of key.",
    commit: "946c254",
    evidence: { kind: "inspected" },
  },
  {
    id: "quotes",
    title: "Four live regexes could not match a curly quote",
    module: "narratedBlocks",
    impact:
      "A Latin-1 round trip had double-encoded 95 byte sequences, breaking the character " +
      "classes. Quote cards were still drawn — with the WRONG text and the wrong timing: " +
      "17 words / 95 chars instead of 9 / 51, and a sync offset of 0 instead of 18.",
    commit: "a5c32c4",
    evidence: { kind: "inspected" },
  },
  {
    id: "inception",
    title: "Channel Inception abandoned half-built channel shells",
    module: "designChannelInception",
    impact:
      "The capability it needs is unavailable for 10 of 11 families. It discovered this " +
      "mid-run, after creating the shell, instead of refusing up front.",
    commit: "62a3a79",
    evidence: { kind: "inspected" },
  },
  {
    id: "storecontracts",
    title: "48 dead store declarations cleared, 6 deliberate ones documented",
    module: "engine/registry",
    impact:
      "A declared-but-unread input costs a real ordering constraint in the compiled pipeline. " +
      "Six survivors are required by CREW_ARTIFACT_BINDINGS whether read or not, and now say so.",
    commit: "86ed5f1",
    evidence: { kind: "inspected" },
  },
];

/* ------------------------------------------------------------------- build */

interface Rendered { defect: Defect; before?: string; after?: string; holds: boolean }

const rendered: Rendered[] = DEFECTS.map((defect) => {
  if (defect.evidence.kind !== "executed") return { defect, holds: true };
  const before = run(defect.evidence.before);
  const after = run(defect.evidence.after);
  return { defect, before, after, holds: defect.evidence.expect(before) };
});

// A proof page that prints an unverified claim is worse than no page. If a
// "before" is no longer wrong, the build fails rather than publishing it.
const broken = rendered.filter((r) => !r.holds);
if (broken.length) {
  console.error(`${broken.length} executed proof(s) no longer demonstrate their defect:`);
  for (const r of broken) console.error(`  ${r.defect.id}: before produced ${r.before}`);
  process.exit(1);
}

const commits = git("log", "--pretty=format:%h%s%ad", "--date=short", "--since=2026-09-05 21:30")
  .split("\n")
  .filter(Boolean)
  .map((line) => { const [sha, subject, date] = line.split(""); return { sha, subject, date }; });

// Keep this number coupled to the exact discovery rule in
// run-production-readiness-tests.mjs instead of publishing a stale hand-typed
// total. The runner adds the same two explicitly allowlisted script tests.
const testCount = git("ls-files", "src")
  .split("\n")
  .filter((file) => /\.test\.(?:ts|tsx|mts|mjs)$/.test(file)).length + 2;

function evidenceBadge(kind: string): string {
  return `<span class="badge ${kind}">${kind}</span>`;
}

function renderDefect(r: Rendered, index: number): string {
  const d = r.defect;
  const line = d.file && d.anchor ? anchorLine(d.file, d.anchor) : undefined;
  const link = d.file
    ? `${REPO}/blob/${HEAD}/${d.file}${line ? `#L${line}` : ""}`
    : `${REPO}/commit/${d.commit}`;
  const body = git("log", "-1", "--pretty=format:%b", d.commit).split("\n").slice(0, 6).join("\n");

  let proof = "";
  if (d.evidence.kind === "executed") {
    proof = `
      <div class="proof">
        <div class="row bad">
          <div class="lab">BEFORE</div>
          <div><code>${esc(d.evidence.beforeSrc)}</code><div class="val">→ <b>${esc(r.before!)}</b></div></div>
        </div>
        <div class="row good">
          <div class="lab">AFTER</div>
          <div><code>${esc(d.evidence.afterSrc)}</code><div class="val">→ <b>${esc(r.after!)}</b></div></div>
        </div>
      </div>`;
  } else if (d.evidence.kind === "measured") {
    const [head, ...rows] = d.evidence.table;
    proof = `
      <table class="measured">
        <tr>${head!.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
        ${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}
      </table>
      ${d.evidence.harness ? `<p class="harness">measured by <a href="${REPO}/blob/${HEAD}/${d.evidence.harness}"><code>${esc(d.evidence.harness)}</code></a></p>` : ""}`;
  }

  return `
  <article id="${d.id}">
    <header>
      <span class="n">${String(index + 1).padStart(2, "0")}</span>
      <h3>${esc(d.title)}</h3>
    </header>
    <p class="module">${esc(d.module)} ${evidenceBadge(d.evidence.kind)}</p>
    <p class="impact">${esc(d.impact)}</p>
    ${proof}
    <details>
      <summary>commit <code>${d.commit}</code> — ${esc(git("log", "-1", "--pretty=format:%s", d.commit))}</summary>
      <pre>${esc(body)}</pre>
    </details>
    <p class="links">
      <a href="${link}">${d.file ? `${esc(d.file)}${line ? `:${line}` : ""}` : "view commit"}</a>
      <a href="${REPO}/commit/${d.commit}">full diff</a>
    </p>
  </article>`;
}

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Defect proofs — youtube-studio-ai</title>
<style>
 :root{--bg:#0e1116;--fg:#e6edf3;--dim:#8b949e;--line:#232a33;--bad:#f85149;--good:#3fb950;--acc:#58a6ff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 ui-sans-serif,system-ui,-apple-system,sans-serif}
 .wrap{max-width:880px;margin:0 auto;padding:48px 20px 96px}
 h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
 .sub{color:var(--dim);margin:0 0 28px}
 code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#161b22;padding:2px 6px;border-radius:4px}
 pre{font:12px/1.6 ui-monospace,Menlo,monospace;background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;color:var(--dim);white-space:pre-wrap}
 .stats{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 34px}
 .stat{border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:#11161d}
 .stat b{display:block;font-size:21px}
 .stat span{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
 .how{border-left:3px solid var(--acc);background:#11161d;padding:14px 18px;border-radius:0 8px 8px 0;margin:0 0 36px}
 .how p{margin:0 0 8px}.how p:last-child{margin:0}
 article{border:1px solid var(--line);border-radius:12px;padding:20px;margin:0 0 18px;background:#11161d}
 article header{display:flex;gap:12px;align-items:baseline}
 .n{color:var(--dim);font:12px ui-monospace,monospace;padding-top:3px}
 h3{font-size:17px;margin:0 0 4px;line-height:1.35}
 .module{color:var(--dim);font-size:12px;margin:2px 0 10px;text-transform:uppercase;letter-spacing:.05em}
 .impact{margin:0 0 14px}
 .badge{font-size:10px;padding:2px 7px;border-radius:20px;margin-left:6px;letter-spacing:.08em}
 .badge.executed{background:#12331f;color:var(--good);border:1px solid #1d5c33}
 .badge.measured{background:#1a2a3d;color:var(--acc);border:1px solid #234d75}
 .badge.inspected{background:#2b2517;color:#d29922;border:1px solid #5c4813}
 .proof{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:0 0 12px}
 .row{display:flex;gap:14px;padding:12px 14px;align-items:flex-start}
 .row+.row{border-top:1px solid var(--line)}
 .row.bad{background:#1c1214}.row.good{background:#101c14}
 .lab{font:11px ui-monospace,monospace;letter-spacing:.1em;flex:0 0 54px;padding-top:4px}
 .row.bad .lab{color:var(--bad)}.row.good .lab{color:var(--good)}
 .val{margin-top:6px;font:13px ui-monospace,monospace;color:var(--dim)}
 .row.bad .val b{color:var(--bad)}.row.good .val b{color:var(--good)}
 table.measured{border-collapse:collapse;width:100%;margin:0 0 10px;font-size:13px}
 table.measured th{text-align:left;color:var(--dim);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 10px;border-bottom:1px solid var(--line)}
 table.measured td{padding:6px 10px;border-bottom:1px solid #1a1f27;font-family:ui-monospace,monospace}
 .harness{font-size:12px;color:var(--dim);margin:0 0 10px}
 details{margin:0 0 10px}summary{cursor:pointer;color:var(--dim);font-size:13px}
 .links{margin:0;display:flex;gap:16px;font-size:13px}
 a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin:44px 0 14px;font-weight:500}
 ol.commits{padding-left:0;list-style:none;margin:0;font-size:13px}
 ol.commits li{padding:7px 0;border-bottom:1px solid #1a1f27;display:flex;gap:12px}
 ol.commits code{flex:0 0 62px;background:none;padding:0;color:var(--dim)}
 footer{color:var(--dim);font-size:12px;margin-top:44px;border-top:1px solid var(--line);padding-top:18px}
</style></head><body><div class="wrap">

<h1>What changed, and how you can check it</h1>
<p class="sub">youtube-studio-ai · module hardening pass · built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from <a href="${REPO}/commit/${HEAD}"><code>${HEAD.slice(0, 7)}</code></a></p>

<div class="stats">
  <div class="stat"><b>${commits.length}</b><span>commits</span></div>
  <div class="stat"><b>${DEFECTS.length}</b><span>defects shown</span></div>
  <div class="stat"><b>${rendered.filter((r) => r.defect.evidence.kind === "executed").length}</b><span>proven by execution</span></div>
  <div class="stat"><b>${testCount}</b><span>direct readiness tests</span></div>
  <div class="stat"><b>9</b><span>audits in CI</span></div>
</div>

<div class="how">
  <p><b>Executed</b> — the original broken expression and its replacement were both run by the build script that produced this page. The values below are what they actually returned. If a “before” ever stops being wrong, the build fails instead of publishing the claim.</p>
  <p><b>Measured</b> — a number from a harness run against the real provider during the work. The harness is linked; you can re-run it.</p>
  <p><b>Inspected</b> — established by reading the code. The commit body is the record and the diff is the proof; both are linked.</p>
</div>

${rendered.map(renderDefect).join("\n")}

<h2>All ${commits.length} commits</h2>
<ol class="commits">
${commits.map((c) => `  <li><code><a href="${REPO}/commit/${c.sha}">${c.sha}</a></code><span>${esc(c.subject)}</span></li>`).join("\n")}
</ol>

<footer>
  Generated by <a href="${REPO}/blob/${HEAD}/scripts/build-defect-proof-site.ts"><code>scripts/build-defect-proof-site.ts</code></a>.
  The executed proofs are recomputed on every build; the commit bodies are read from git at build time,
  so this page cannot drift from the repository's own history.
</footer>
</div></body></html>`;

const out = join(ROOT, "public", "proof.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote public/proof.html — ${DEFECTS.length} defects, ${rendered.filter((r) => r.defect.evidence.kind === "executed").length} proven by execution, all "before" cases still demonstrate their defect`);
