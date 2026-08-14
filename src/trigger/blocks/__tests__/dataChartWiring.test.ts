/**
 * Chart-lane wiring + honesty regression lock (datachart + simstory).
 *
 * The two families share ONE renderer on purpose, and the whole design rests on
 * a small number of claims. This suite binds each of them so none can silently
 * regress:
 *
 *   1. both engines are REGISTERED and reachable from the pipeline
 *   2. family / lane / archetype plumbing exists and is self-consistent
 *   3. NO paid media provider is anywhere on either path — that is the cost story
 *   4. `datachart` really is the cheapest family in the catalog
 *   5. single responsibility: neither producer renders, and the renderer neither
 *      sources data nor writes a script nor synthesizes speech
 *   6. the honesty gate: sourced values must be cited, invented values must be
 *      declared and may never be cited, and the two may never mix
 *   7. the catalog entries claim exactly what is wired — no overclaim
 *   8. the Remotion bundle is genuinely ISOLATED (from the shared root AND the quiz)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FAMILIES, FAMILY_CREW, type FamilyKey } from "@/engine/families";
import { ARCHETYPES } from "@/engine/archetypes";
import {
  CONTENT_LANE_POLICIES,
  CONTENT_LANE_BY_FAMILY,
  LANE_QUALITY_POLICIES,
} from "@/engine/contentLane";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import { MODULE_CATALOG } from "@/engine/moduleCatalog";
import { GOLDEN_MODULES } from "@/engine/golden";
import { CATALOG_EXECUTION_BINDINGS } from "@/engine/goldenExecution";
import { designPipeline } from "@/engine/designer";
import {
  buildRankChartSpec,
  fitChartToNarration,
  rankChartBlocks,
  rankRowCount,
  resolveChartMode,
} from "../rankChartBlocks";
import { simNarrativeBlocks } from "../simNarrativeBlocks";
import { chartDurationSeconds, chartSpecDefects } from "@/lib/chartSpec";
import { rankSetDefects, RANK_TOPICS, resolveRankTopic, type RankedFact } from "@/lib/rankFacts";

const ROOT = join(__dirname, "../../../..");

const fact = (qid: string, label: string, value: number): RankedFact => ({
  wikidataQid: qid,
  label,
  description: "",
  value,
  sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
});

async function main(): Promise<void> {
  /* 1 — the blocks exist and declare the right shapes */
  assert.equal(rankChartBlocks.length, 2);
  const [rankData, chartRender] = rankChartBlocks;
  assert.equal(rankData.id, "rank_data");
  assert.equal(chartRender.id, "chart_render");
  assert.equal(simNarrativeBlocks.length, 1);
  const sim = simNarrativeBlocks[0];
  assert.equal(sim.id, "sim_narrative");

  // SINGLE RESPONSIBILITY, expressed as ABI: only the renderer emits a video,
  // and only the producers emit a spec.
  assert.ok(chartRender.produces.includes("videoKey"));
  assert.ok(chartRender.produces.includes("videoDurationSec"));
  for (const producer of [rankData, sim]) {
    assert.ok(
      producer.produces.includes("chartSpec"),
      `${producer.id} must emit the shared render contract`,
    );
    assert.ok(
      !producer.produces.some((key) => key.startsWith("video")),
      `${producer.id} must not emit a video — chart_render owns the master`,
    );
  }
  assert.ok(
    !chartRender.produces.includes("chartSpec") && !chartRender.produces.includes("script"),
    "the renderer must not author data or a script",
  );
  // rank_data spends nothing: no model, no media provider.
  assert.notEqual(rankData.paid, true, "rank_data reads a free CC0 endpoint and must not be a paid module");
  assert.notEqual(chartRender.paid, true, "chart_render is a local Remotion + ffmpeg module");
  assert.equal(sim.paid, true, "sim_narrative makes one real (tiny) model call and must be preflighted");

  /* 2 — family / lane / archetype plumbing */
  for (const [familyKey, laneKey, archetypeKey, engineBlock] of [
    ["datachart", "data_chart", "data-ranking", "rank_data"],
    ["simstory", "sim_story", "sim-story", "sim_narrative"],
  ] as const) {
    const family = FAMILIES[familyKey as FamilyKey];
    assert.ok(family, `${familyKey} family must exist`);
    assert.equal(family.visualEngine, "chart_render", "both families share ONE renderer");
    assert.equal(family.archetypeKey, archetypeKey);
    assert.equal(family.narrated, true);
    assert.equal(CONTENT_LANE_BY_FAMILY[familyKey as FamilyKey], laneKey);
    assert.ok(FAMILY_CREW[familyKey as FamilyKey].includes("critic"));
    assert.ok(
      !FAMILY_CREW[familyKey as FamilyKey].includes("cinematographer"),
      "there is no photography in a chart video — a DP brief would be an unread paid call",
    );

    const archetype = ARCHETYPES[archetypeKey];
    assert.ok(archetype, `${archetypeKey} archetype must exist`);
    const blocks = archetype.pipeline.map((entry) => entry.block);
    assert.ok(blocks.includes(engineBlock), "the archetype must run its own producer");
    assert.ok(blocks.includes("chart_render"), "the archetype must run the shared renderer");
    assert.ok(blocks.includes("compliance_check"), "compliance gates before the engine runs");
    assert.ok(blocks.includes("narration_tts"), "the voice is the SHARED module, not a private copy");
    for (const forbidden of ["timeline_assemble", "assemble", "story_spine", "visual_inserts"]) {
      assert.ok(!blocks.includes(forbidden), `chart lane must not chain ${forbidden}`);
    }

    const lane = CONTENT_LANE_POLICIES[laneKey];
    assert.ok(lane, `${laneKey} lane must exist`);
    assert.equal(lane.primaryRenderer, "chart_render");
    assert.ok(lane.requiredBlocks.includes(engineBlock), "the data/authoring block is part of the lane, not a garnish");
    assert.ok(lane.requiredBlocks.includes("chart_render"));
    // 3/4 — exactly one renderer per video.
    for (const sibling of [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
      "quiz_year",
    ]) {
      assert.ok(
        lane.forbiddenRendererBlocks.includes(sibling),
        `${laneKey} must forbid the sibling renderer ${sibling}`,
      );
    }
    assert.ok(LANE_QUALITY_POLICIES[laneKey], "the lane needs a quality calibration");
  }

  // The simulation lane must not be able to pull a REAL cited dataset into a
  // chart it has already declared illustrative.
  assert.ok(
    (CONTENT_LANE_POLICIES.sim_story.forbiddenBlocks ?? []).includes("rank_data"),
    "an illustrative chart must never be able to mix in a sourced dataset",
  );

  /* 3 — the cost story: NO paid media provider anywhere on either path */
  for (const file of [
    "src/trigger/blocks/rankChartBlocks.ts",
    "src/trigger/blocks/simNarrativeBlocks.ts",
    "src/lib/rankFacts.ts",
    "src/lib/rankChartRender.ts",
  ]) {
    const source = await readFile(join(ROOT, file), "utf8");
    for (const banned of [
      "novitaRenderFarm",
      "novitaMedia",
      "novitaDirectRender",
      "generateI2V",
      "replicate",
      "elevenlabs",
      "falImage",
      "bananaImage",
      "musicTrack",
      "topaz",
    ]) {
      assert.ok(
        !source.includes(banned),
        `${file} must not reach a paid media provider (found ${banned}) — the lane's entire economic case is that it needs none`,
      );
    }
  }
  // The RENDERER must not source data or synthesize speech; the PRODUCERS must
  // not render. Enforced against the source, not just the declared ABI.
  const rankBlockSource = await readFile(join(ROOT, "src/trigger/blocks/rankChartBlocks.ts"), "utf8");
  assert.ok(
    !rankBlockSource.includes("synthNarration"),
    "chart_render must mux the narration narration_tts produced, never synthesize its own",
  );
  const simSource = await readFile(join(ROOT, "src/trigger/blocks/simNarrativeBlocks.ts"), "utf8");
  for (const rendererSymbol of ["renderRankChart", "@remotion", "putObjectFromFile"]) {
    assert.ok(
      !simSource.includes(rendererSymbol),
      `sim_narrative must not render (found ${rendererSymbol}) — reusing chart_render is the whole point`,
    );
  }

  /* 4 — datachart is genuinely the cheapest family in the catalog */
  const budgets = (Object.keys(FAMILIES) as FamilyKey[]).map((key) => ({
    key,
    budget: FAMILIES[key].defaultRunBudgetUsd,
  }));
  const dataChartBudget = FAMILIES.datachart.defaultRunBudgetUsd;
  assert.ok(typeof dataChartBudget === "number" && dataChartBudget > 0);
  for (const other of budgets) {
    if (other.key === "datachart" || other.key === "simstory") continue;
    if (typeof other.budget !== "number") continue;
    assert.ok(
      dataChartBudget < other.budget,
      `datachart claims to be the cheapest family but ${other.key} declares ${other.budget}`,
    );
  }
  // ...and the claim is VERIFIED against the compiler's own reservation, not
  // just asserted in a comment: the envelope must fit, and must beat quizyear's.
  const chartDesign = designPipeline({ family: "datachart", nicheKey: "history", lengthMinutes: 3, publishMode: "draft" });
  const quizDesign = designPipeline({ family: "quizyear", nicheKey: "history", lengthMinutes: 3, publishMode: "draft" });
  const chartReserved = chartDesign.compilation?.reservedMaxCostUsd ?? Number.POSITIVE_INFINITY;
  const quizReserved = quizDesign.compilation?.reservedMaxCostUsd ?? 0;
  assert.ok(
    chartReserved <= dataChartBudget,
    `datachart reserves $${chartReserved.toFixed(4)} but declares a $${dataChartBudget} envelope`,
  );
  assert.ok(
    chartReserved < quizReserved,
    `datachart ($${chartReserved.toFixed(4)}) must reserve less than quizyear ($${quizReserved.toFixed(4)})`,
  );
  // The designer/compiler must NOT re-add the blocks the lane forbids.
  const designedBlocks = chartDesign.pipeline.map((entry) => entry.block);
  for (const forbidden of ["story_spine", "visual_inserts", "timeline_assemble"]) {
    assert.ok(
      !designedBlocks.includes(forbidden),
      `the designed datachart pipeline re-added ${forbidden}: ${designedBlocks.join(" -> ")}`,
    );
  }

  /* 5 — module contracts */
  const rankContract = MODULE_CONTRACTS.rank_data;
  assert.ok(rankContract, "rank_data needs a module contract");
  for (const capability of rankContract.capabilities ?? []) {
    assert.ok(
      !String(capability).startsWith("visuals.") && !String(capability).startsWith("master."),
      `a data module must not claim ${String(capability)}`,
    );
  }
  const simContract = MODULE_CONTRACTS.sim_narrative;
  assert.ok(simContract);
  assert.ok(
    simContract.maxCostUsd !== undefined && simContract.maxCostUsd <= 0.05,
    "a dramatized run costing more than a few cents means the per-generation loop came back",
  );
  for (const capability of simContract.capabilities ?? []) {
    assert.ok(
      !String(capability).startsWith("master.") && !String(capability).startsWith("narration."),
      `the authoring module must not claim ${String(capability)}`,
    );
  }
  const renderContract = MODULE_CONTRACTS.chart_render;
  assert.ok(renderContract);
  assert.deepEqual(renderContract.requiredConsumes, ["chartSpec"], "the renderer takes ONE input shape");
  assert.equal(renderContract.qualityRequired, true);
  assert.ok(
    (MODULE_CONTRACTS.script_gen.optionalConsumes ?? []).includes("chartBrief"),
    "script_gen must be allowed to read the cited figures it has to speak",
  );

  /* 6 — the honesty gate */
  const sourced = buildRankChartSpec({
    topic: "tallest_buildings",
    facts: [fact("Q1", "Burj Khalifa", 828), fact("Q2", "Merdeka 118", 678.9), fact("Q3", "Shanghai Tower", 632)],
    mode: "count_up",
    secondsPerRow: 6,
    outroSeconds: 4,
  });
  assert.deepEqual(chartSpecDefects(sourced), [], "a clean sourced set must validate");
  assert.equal(sourced.speculative, false);
  for (const row of sourced.rows) {
    assert.equal(row.provenance, "dataset-sourced");
    assert.ok(row.sourceUrl?.startsWith("https://"));
  }

  // A sourced chart that loses a citation must FAIL, not degrade.
  const uncited = { ...sourced, rows: sourced.rows.map((r, i) => (i === 1 ? { ...r, sourceUrl: undefined } : r)) };
  assert.ok(
    chartSpecDefects(uncited).some((d) => d.includes("no resolvable https source URL")),
    "an uncited row in a non-speculative chart must be a defect",
  );
  // A model-invented value smuggled into a sourced chart must FAIL.
  const smuggled = {
    ...sourced,
    rows: sourced.rows.map((r, i) => (i === 2 ? { ...r, provenance: "speculative-illustrative" as const } : r)),
  };
  assert.ok(
    chartSpecDefects(smuggled).some((d) => d.includes("may only render dataset-sourced")),
    "an invented value must not be renderable inside a sourced chart",
  );
  // A speculative chart that tries to cite a source must FAIL.
  const citedFiction = {
    ...sourced,
    speculative: true,
    disclosure: "ILLUSTRATIVE",
    rows: sourced.rows.map((r) => ({ ...r, provenance: "speculative-illustrative" as const })),
  };
  assert.ok(
    chartSpecDefects(citedFiction).some((d) => d.includes("cites a source for an invented number")),
    "you cannot cite a number you invented",
  );
  // A speculative chart with no disclosure must FAIL.
  const undisclosed = {
    ...citedFiction,
    disclosure: undefined,
    rows: citedFiction.rows.map((r) => ({ ...r, sourceUrl: undefined })),
  };
  assert.ok(
    chartSpecDefects(undisclosed).some((d) => d.includes("MUST carry an on-screen disclosure")),
    "an illustrative chart with no disclosure must be unrenderable",
  );

  /* rank sizing + set integrity */
  assert.equal(rankRowCount(64, 6), 10);
  assert.equal(rankRowCount(0, 6), 10, "no target → engine default");
  assert.ok(rankRowCount(10_000, 6) <= 12, "row count is capped so the query stays bounded");
  assert.ok(rankRowCount(1, 6) >= 3, "row count has a floor so the video is watchable");
  assert.equal(resolveChartMode("bar_race"), "bar_race");
  assert.equal(resolveChartMode("nonsense"), "count_up", "unknown modes fall back safely");
  assert.equal(resolveRankTopic("longest_rivers"), "longest_rivers");
  assert.equal(resolveRankTopic("not_a_topic"), "tallest_buildings");

  assert.deepEqual(rankSetDefects([fact("Q1", "A", 3), fact("Q2", "B", 2), fact("Q3", "C", 1)]), []);
  assert.ok(
    rankSetDefects([fact("Q1", "A", 3), fact("Q1", "A", 3), fact("Q3", "C", 1)]).some((d) => d.includes("duplicate subject")),
  );
  assert.ok(
    rankSetDefects([fact("Q1", "A", 5), fact("Q2", "B", 5), fact("Q3", "C", 5)]).some((d) => d.includes("not a ranking")),
  );
  assert.ok(
    rankSetDefects([fact("Q1", "A", 1), fact("Q2", "B", 9), fact("Q3", "C", 3)]).some((d) => d.includes("out of rank order")),
  );

  /* bar-race series must land exactly on the sourced value */
  const race = buildRankChartSpec({
    topic: "longest_rivers",
    facts: [fact("Q1", "Nile", 6650), fact("Q2", "Amazon", 6400), fact("Q3", "Yangtze", 6300)],
    mode: "bar_race",
    secondsPerRow: 5,
    outroSeconds: 3,
  });
  assert.deepEqual(chartSpecDefects(race), [], "a bar race must validate");
  for (const row of race.rows) {
    const last = row.series?.[row.series.length - 1];
    assert.equal(last?.value, row.value, "every bar must finish on its true sourced value");
  }

  /* narration fitting: the picture stretches, the voice is never cut */
  const natural = chartDurationSeconds(sourced);
  const fitted = fitChartToNarration(sourced, natural + 60);
  assert.ok(chartDurationSeconds(fitted) >= natural + 55, "the chart must stretch to cover a longer narration");
  assert.equal(fitChartToNarration(sourced, 1), sourced, "a shorter narration must not compress the chart");

  /* 7 — the catalog claims exactly what is wired */
  for (const [catalogKey, executables] of [
    ["data-chart", ["rank_data", "chart_render"]],
    ["sim-story", ["sim_narrative"]],
  ] as const) {
    const entry = GOLDEN_MODULES.find((m) => m.key === catalogKey);
    assert.ok(entry, `${catalogKey} catalog entry must exist`);
    assert.equal(entry.status, "active", "wired-but-unproven is `active`, never `golden`");
    const binding = CATALOG_EXECUTION_BINDINGS[catalogKey];
    assert.ok(binding, `${catalogKey} needs an execution binding`);
    assert.equal(binding.kind, "pipeline-module");
    assert.deepEqual(binding.executableIds, executables);
  }
  // ONE owner per executable — a duplicated renderer would let one entry's
  // promotion silently imply the other's.
  const owners = Object.entries(CATALOG_EXECUTION_BINDINGS).filter(([, b]) =>
    b.executableIds.includes("chart_render"),
  );
  assert.equal(owners.length, 1, "chart_render must have exactly one catalog owner");

  for (const block of ["rank_data", "sim_narrative", "chart_render"]) {
    assert.ok(
      MODULE_CATALOG.some((spec) => spec.block === block),
      `${block} must be visible in the operator module catalog`,
    );
  }

  /* 8 — the Remotion bundle is genuinely isolated */
  const chartRenderSource = await readFile(join(ROOT, "src/lib/rankChartRender.ts"), "utf8");
  assert.ok(
    chartRenderSource.includes("src/remotion/chart/index.ts"),
    "the chart renderer must bundle its OWN entry point",
  );
  for (const foreign of ['"src/remotion/index.ts"', "src/remotion/quiz/index.ts"]) {
    assert.ok(!chartRenderSource.includes(foreign), `the chart renderer must not reuse ${foreign}`);
  }
  const sharedRoot = await readFile(join(ROOT, "src/remotion/Root.tsx"), "utf8");
  assert.ok(
    !sharedRoot.includes("RankChart"),
    "registering RankChart in the shared root would defeat the isolation gate",
  );

  // ...and the isolated bundle only helps if the CLOUD IMAGE contains it.
  // @remotion/bundler compiles src/remotion/chart/index.ts from source at
  // runtime, so the raw .ts/.tsx must be baked in by additionalFiles. This lock
  // fires if the glob is ever narrowed: the chart bundle would vanish from the
  // image and EVERY cloud render would fail while local renders kept passing.
  const triggerConfig = await readFile(join(ROOT, "trigger.config.ts"), "utf8");
  const filesBlock = /additionalFiles\(\{\s*files:\s*\[([\s\S]*?)\]/.exec(triggerConfig);
  assert.ok(filesBlock, "trigger.config.ts must bake files in via additionalFiles({ files: [...] })");
  const bakedGlobs = [...filesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const chartFile of [
    "src/remotion/chart/index.ts",
    "src/remotion/chart/Root.tsx",
    "src/remotion/chart/RankChart.tsx",
  ]) {
    assert.ok(
      bakedGlobs.some(
        (glob) => glob === chartFile || (glob.endsWith("/**") && chartFile.startsWith(glob.slice(0, -2))),
      ),
      `${chartFile} is not covered by any additionalFiles glob [${bakedGlobs.join(", ")}] — ` +
        "the Trigger image would ship without the chart Remotion bundle and every cloud chart render would fail",
    );
  }

  // Every curated ranking topic must be structurally usable.
  for (const key of Object.keys(RANK_TOPICS)) {
    const topic = RANK_TOPICS[key as keyof typeof RANK_TOPICS];
    assert.ok(topic.title.length > 0 && topic.measure.length > 0, `${key} needs a title and a measure`);
    const query = topic.sparql(10);
    assert.ok(query.includes("wikibase:quantityAmount"), `${key} must read a structured quantity, not a label`);
    assert.ok(
      query.includes("wikibase:quantityUnit"),
      `${key} must expose the unit so the unit gate can drop mismatches instead of converting them`,
    );
    assert.ok(query.includes("LIMIT"), `${key} must bound its query`);
  }

  console.log(
    "dataChartWiring: registration, lane policy, single-responsibility, cost floor, honesty gate, catalog honesty and bundle isolation locks passed",
  );
}

void main();
