import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests, getManifest } from "@/engine/registry";
import { familyDurationContract, FAMILIES, type FamilyKey } from "@/engine/families";
import { designPipeline } from "@/engine/designer";
import { validatePipeline } from "@/engine/validate";
import {
  compilePipeline,
  completePipelineForPolicy,
  materializeRuntimePipelineParams,
  PRIVATE_PROBE_CONTRACT_POLICY,
  PipelinePolicyError,
} from "@/engine/pipelineCompiler";
import { declaredArtifactStore } from "@/engine/runner";
import { GOLDEN_MODULES, type GoldenModule } from "@/engine/golden";
import {
  CATALOG_EXECUTION_BINDINGS,
  catalogExecutionBinding,
  GOLDEN_PROMOTION_PROOFS,
  selectGoldenProductionModules,
  type GoldenPromotionProof,
} from "@/engine/goldenExecution";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import {
  PRICE,
  bananaUnitRate,
  qaVisualCost,
} from "@/engine/pricing";
import {
  assertThumbnailGate,
  assertThumbnailStrategy,
  assertVoiceGatePreconditions,
  type ThumbnailGateVerdict,
} from "@/engine/qualityPolicy";
import { makeVoicecraftAuditionEvidence } from "@/lib/voiceReadiness";
import {
  NARRATION_COLD_OPEN_MAX_CHARS,
  narrationChapterHeadingCharacterCeiling,
} from "@/lib/narrationBounds";

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (ts.isSpreadAssignment(node)) return null;
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (
    ts.isComputedPropertyName(name) &&
    ts.isIdentifier(name.expression) &&
    name.expression.text === "COST_PATCH_KEY"
  ) return "$costUsd";
  return null;
}

function literalStrings(property: ts.ObjectLiteralElementLike | undefined): string[] {
  if (!property || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements
    .filter(ts.isStringLiteral)
    .map((element) => element.text);
}

function directContractAudit(): void {
  const blockDir = join(process.cwd(), "src/trigger/blocks");
  const extras: string[] = [];
  const ambientReads: string[] = [];
  for (const file of readdirSync(blockDir).filter((name) => name.endsWith(".ts"))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(blockDir, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const inspectObject = (object: ts.ObjectLiteralExpression) => {
      const idProperty = object.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "id" &&
          ts.isStringLiteral(property.initializer),
      );
      if (!idProperty || !ts.isStringLiteral(idProperty.initializer)) return;
      const id = idProperty.initializer.text;
      const manifest = getManifest(id);
      if (!manifest) return;
      const producesProperty = object.properties.find(
        (property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "produces",
      );
      const declaredOutputs = new Set(literalStrings(producesProperty));
      const allowedInputs = new Set([
        ...Object.keys(manifest.consumes),
        ...Object.keys(manifest.optionalConsumes),
      ]);
      const run = object.properties.find(
        (property) =>
          (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "run",
      );
      if (!run) return;
      let body: ts.ConciseBody | undefined;
      if (ts.isMethodDeclaration(run)) {
        body = run.body;
      } else if (
        ts.isPropertyAssignment(run) &&
        (ts.isArrowFunction(run.initializer) || ts.isFunctionExpression(run.initializer))
      ) {
        body = run.initializer.body;
      }
      if (!body) return;
      const visit = (node: ts.Node) => {
        if (node !== body && ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
          for (const property of node.expression.properties) {
            const key = propertyName(property);
            if (key && key !== "$costUsd" && !declaredOutputs.has(key)) {
              extras.push(`${id}.${key} (${file}:${source.getLineAndCharacterOfPosition(property.pos).line + 1})`);
            }
          }
        }
        if (
          ts.isElementAccessExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "ctx" &&
          node.expression.name.text === "store" &&
          node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression)
        ) {
          const key = node.argumentExpression.text;
          if (!allowedInputs.has(key)) ambientReads.push(`${id}.${key} (${file})`);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          ["str", "opt"].includes(node.expression.text) &&
          node.arguments.length >= 2 &&
          ts.isStringLiteral(node.arguments[1])
        ) {
          const key = node.arguments[1].text;
          if (!allowedInputs.has(key)) ambientReads.push(`${id}.${key} (${file}, helper)`);
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
    };
    const walk = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) inspectObject(node);
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  assert.deepEqual([...new Set(extras)].sort(), [], "module returned undeclared artifacts");
  assert.deepEqual([...new Set(ambientReads)].sort(), [], "module performed undeclared literal store reads");
}

function compileRepresentativeFamilies(): void {
  for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
    const design = designPipeline({
      family,
      nicheKey: "history",
      // Each format is compiled at its own authored cadence. A generic
      // three-minute probe is invalid for native Shorts and obscures a real
      // format contract violation behind a test fixture.
      lengthMinutes: familyDurationContract(family).defaultSeconds / 60,
      publishMode: "draft",
    });
    if (design.available) {
      assert.ok(design.compilation, `${family} must carry an exact production-contract compilation`);
      assert.equal(design.compilation?.policyId, "production-contract");
      assert.ok(
        Number.isFinite(design.compilation?.reservedMaxCostUsd) &&
          (design.compilation?.reservedMaxCostUsd ?? -1) >= 0,
        `${family} must compile a finite configuration-specific cost reservation`,
      );
    }
  }
}

function defaultBudgetsCoverCompilerReservations(): void {
  for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
    const design = designPipeline({ family, publishMode: "draft" });
    assert.ok(design.compilation, `${family} must compile its default production chain`);
    assert.ok(
      (FAMILIES[family].defaultRunBudgetUsd ?? 0) >= design.compilation.reservedMaxCostUsd,
      `${family}'s creator floor must cover its exact default compiler reservation`,
    );
  }
}

function privateProbeKeepsEveryNonPublishingQualityRequirement(): void {
  const production = designPipeline({ family: "cinematic", publishMode: "draft" });
  // Mirror the deliberately private probe shape: all delivery/post-processing
  // stages are excluded, while rendering and every QA/creative gate remain.
  const privateProbe = production.pipeline.filter(
    (entry) => !new Set([
      "upload_draft",
      "notify",
      "cleanup",
      "shorts_spinoff",
      "crosspost",
      "emit_bundle",
    ]).has(entry.block),
  );
  const compilation = compilePipeline(
    validatePipeline(privateProbe),
    PRIVATE_PROBE_CONTRACT_POLICY,
  );
  assert.equal(compilation.policyId, "private-probe-contract");
  assert.equal(privateProbe.some((entry) => entry.block === "upload_draft"), false);
  for (const capability of [
    "topic.researched",
    "topic.selected",
    "final.compliance_passed",
    "master.assembled",
    "master.quality_passed",
    "package.metadata",
    "package.thumbnail",
  ]) {
    assert(compilation.capabilities.includes(capability), `private probe must retain ${capability}`);
  }
  assert.throws(
    () => compilePipeline(validatePipeline(privateProbe)),
    /publish\.connector_bound/,
    "the ordinary production policy must continue to reject a non-uploading pipeline",
  );
}

function runtimeConfigurationIsCompiledBeforeSpendReservation(): void {
  const design = designPipeline({
    family: "music_loop",
    nicheKey: "lofi",
    lengthMinutes: 3,
    publishMode: "draft",
  });
  const base = compilePipeline(validatePipeline(design.pipeline));
  assert.match(
    base.fingerprint,
    /^[a-f0-9]{64}$/,
    "production compilation fingerprints must be durable SHA-256 identities",
  );
  const music = design.pipeline.find((entry) => entry.block === "music");
  assert.ok(music, "music-loop representative must contain the paid music module");
  const materialized = materializeRuntimePipelineParams(design.pipeline, {
    music: { ...(music.params ?? {}), trackCount: 8 },
  });
  const effective = materialized.find((entry) => entry.block === "music");
  const compiled = compilePipeline(validatePipeline(materialized));
  assert.equal(effective?.params?.trackCount, 8);
  assert.notEqual(
    compiled.fingerprint,
    base.fingerprint,
    "operator runtime params must alter the persisted production fingerprint",
  );
  assert.ok(
    compiled.reservedMaxCostUsd > base.reservedMaxCostUsd,
    "cost-increasing operator params must increase the pre-spend reservation",
  );
}

function legacyMusicLoopNormalization(): void {
  const legacy = [
    { block: "competitor_research" },
    { block: "topic_select" },
    { block: "scene_planner", params: { visualStyle: "lofi" } },
    { block: "keyframes" },
    { block: "loop_clips" },
    { block: "upscale" },
    { block: "music" },
    { block: "intro_card", params: { introSec: 5 } },
    { block: "assemble", params: { deblurIntro: true, durationSec: 90 } },
  ];
  const normalized = completePipelineForPolicy(legacy);
  assert.ok(
    !normalized.entries.some((entry) => entry.block === "intro_card"),
    "deblur-intro lofi must remove the dead legacy title-card render",
  );
  assert.doesNotThrow(() => validatePipeline(normalized.entries));

  const prepend = completePipelineForPolicy(
    legacy.map((entry) =>
      entry.block === "assemble"
        ? { ...entry, params: { ...entry.params, deblurIntro: false } }
        : entry,
    ),
  );
  assert.ok(
    prepend.entries.some((entry) => entry.block === "intro_card"),
    "prepend-card mode must retain its real intro producer",
  );
  assert.doesNotThrow(
    () => validatePipeline(prepend.entries),
    "assemble is the explicit authoritative replacement for introApplied",
  );
}

function crewRemovalAndOrderFail(): void {
  const design = designPipeline({
    family: "narrated_stock",
    nicheKey: "history",
    lengthMinutes: 3,
    publishMode: "draft",
  });
  const withoutDirector = design.pipeline.filter((entry) => entry.block !== "director_brief");
  assert.throws(
    () => compilePipeline(validatePipeline(withoutDirector)),
    (error) => error instanceof PipelinePolicyError && /director_treatment|structure/.test(error.message),
  );

  const reordered = [...design.pipeline];
  const dpIndex = reordered.findIndex((entry) => entry.block === "dp_brief");
  const [dp] = reordered.splice(dpIndex, 1);
  const stockIndex = reordered.findIndex((entry) => entry.block === "stock_footage");
  reordered.splice(stockIndex + 1, 0, dp);
  assert.throws(
    () => compilePipeline(validatePipeline(reordered)),
    (error) => error instanceof PipelinePolicyError && /visualBrief.*before/.test(error.message),
  );
}

function publicationNeedsApproval(): void {
  assert.throws(
    () => designPipeline({
      family: "music_loop",
      nicheKey: "lofi",
      lengthMinutes: 3,
      publishMode: "public",
    }),
    /approvedForPublish/,
  );
  assert.doesNotThrow(() => designPipeline({
    family: "music_loop",
    nicheKey: "lofi",
    lengthMinutes: 3,
    publishMode: "public",
    approvedForPublish: true,
  }));
  assert.throws(
    () => designPipeline({
      family: "music_loop",
      nicheKey: "lofi",
      lengthMinutes: 3,
      publishMode: "draft",
      toggles: { crosspost: true },
    }),
    /crosspost requires approvedForPublish/,
  );
  const design = designPipeline({
    family: "music_loop",
    nicheKey: "lofi",
    lengthMinutes: 3,
    publishMode: "draft",
  });
  const unsafe = design.pipeline.map((entry) =>
    entry.block === "upload_draft"
      ? { ...entry, params: { ...(entry.params ?? {}), publishMode: "public" } }
      : entry,
  );
  assert.throws(() => compilePipeline(validatePipeline(unsafe)), /approvedForPublish/);
}

function declaredStoreBoundary(): void {
  const manifest = getManifest("script_gen");
  assert.ok(manifest);
  const fallbacks = new Set<string>();
  const view = declaredArtifactStore(manifest!, { topic: "test" }, fallbacks);
  assert.equal(view.topic, "test");
  assert.equal(view.structure, undefined);
  assert.equal(fallbacks.has("structure"), true);
  assert.throws(() => view["secretAmbientKey"], /undeclared artifact read/);
  assert.throws(() => {
    (view as Record<string, unknown>).topic = "mutated";
  }, /read-only/);
}

function proofFor(module: GoldenModule, manifests: readonly ModuleManifest[]): GoldenPromotionProof {
  const binding = catalogExecutionBinding(module.key);
  const bound = binding.executableIds.map((id) => {
    const manifest = manifests.find((candidate) => candidate.id === id);
    assert.ok(manifest, `test fixture needs manifest ${id}`);
    return manifest;
  });
  return {
    schemaVersion: "1.0.0",
    catalogKey: module.key,
    sourceCommitSha: "a".repeat(40),
    artifactSha256: "b".repeat(64),
    executableIds: [...binding.executableIds],
    moduleVersions: Object.fromEntries(bound.map((manifest) => [manifest.id, manifest.version])),
    verifiedAt: "2026-08-06T00:00:00.000Z",
    testCommand: "npm run test:golden-promotion",
    operatorApproval: { approved: true, actor: "operator-test", evidence: "fixture approval" },
    gates: module.gates.map((gate) => ({ gate, passed: true as const, evidence: `fixture:${gate}` })),
  };
}

function goldenPromotionGuards(manifests: readonly ModuleManifest[]): void {
  assert.deepEqual(GOLDEN_PROMOTION_PROOFS, {}, "no proof may be silently grandfathered");
  assert.deepEqual(
    Object.keys(CATALOG_EXECUTION_BINDINGS).sort(),
    GOLDEN_MODULES.map((module) => module.key).sort(),
    "every catalog entry must have an explicit execution binding",
  );
  for (const candidate of GOLDEN_MODULES.filter((module) => module.status === "reference")) {
    assert.throws(
      () => selectGoldenProductionModules(candidate.key, manifests),
      /not production-Golden/,
      `${candidate.key} must remain unpromoted until a valid receipt is registered`,
    );
  }

  // motioncraft is still a genuine catalog-only reference (no executable ids).
  // loreshort used to hold this slot; it is now a real pipeline module bound to
  // `lore_short`, so the catalog-only guard moved to a module that still is one.
  assert.throws(
    () => selectGoldenProductionModules("motioncraft", manifests),
    /catalog-only|no module ids/,
    "catalog-only references must never be production-Golden",
  );
  // ...and the newly-wired loreshort must still refuse promotion: being
  // executable is NOT being Golden. Only a signed promotion receipt does that.
  assert.throws(
    () => selectGoldenProductionModules("loreshort", manifests),
    /contract-certified, not golden-certified/,
    "a wired module is still not Golden without a promotion receipt",
  );

  const thumbnail = GOLDEN_MODULES.find((module) => module.key === "thumbnail")!;
  const thumbnailManifest = getManifest("thumbnail_gen")!;
  const contractProof = proofFor(thumbnail, [thumbnailManifest]);
  assert.throws(
    () => selectGoldenProductionModules("thumbnail", manifests, contractProof),
    /contract-certified, not golden-certified/,
    "contract certification must never be presented as Golden",
  );

  const certified: ModuleManifest = {
    ...thumbnailManifest,
    certification: { status: "golden", evidence: "test promotion receipt" },
    qualityContract: { required: true, failClosed: true },
  };
  assert.throws(
    () => selectGoldenProductionModules("thumbnail", [certified]),
    /promotion proof is missing/,
    "Golden certification without an immutable proof receipt is insufficient",
  );

  const incompleteProof: GoldenPromotionProof = {
    ...proofFor(thumbnail, [certified]),
    gates: proofFor(thumbnail, [certified]).gates.slice(1),
  };
  assert.throws(
    () => selectGoldenProductionModules("thumbnail", [certified], incompleteProof),
    /proof is missing gate/,
    "a receipt must cover every catalog gate",
  );
  assert.deepEqual(
    selectGoldenProductionModules("thumbnail", [certified], proofFor(thumbnail, [certified])).map((manifest) => manifest.id),
    ["thumbnail_gen"],
    "only a registered, Golden-certified, fail-closed, fully proven binding is selectable",
  );
}

function failClosedQualityGuards(): void {
  const passingThumbnail: ThumbnailGateVerdict = {
    textOk: true,
    faceClear: true,
    punch: 7,
    styleMatch: 7,
    storyMatch: 7,
    uiClean: true,
    reason: "fixture pass",
  };
  assert.doesNotThrow(() => assertThumbnailGate("production", passingThumbnail, "fixture"));
  assert.throws(() => assertThumbnailGate("production", null, "fixture"), /no required production QA verdict/);
  assert.throws(
    () => assertThumbnailGate("production", { ...passingThumbnail, storyMatch: 6 }, "fixture"),
    /failed the production gate/,
  );
  // The BOOLEAN half of the gate is the text-integrity half: `textOk` is the
  // judge's "every visible word is correctly spelled and readable" verdict and
  // `uiClean` its "no broken glyphs / unreadable clutter" verdict. A provider
  // that ignores the text-free scene request and hallucinates garbled signage
  // must not be able to ship, so each boolean has to fail the gate on its own.
  for (const failing of ["textOk", "faceClear", "uiClean"] as const) {
    assert.throws(
      () => assertThumbnailGate("production", { ...passingThumbnail, [failing]: false }, "fixture"),
      /failed the production gate/,
      `a false ${failing} must fail the production thumbnail gate`,
    );
  }
  assert.doesNotThrow(() => assertThumbnailGate("draft", null, "fixture"));
  assert.throws(() => assertThumbnailStrategy("production", "playbook_belowbar"), /draft-only/);
  assert.throws(() => assertThumbnailStrategy("production", "title_card_fallback"), /draft-only/);

  const voice = {
    profile: "production" as const,
    gateEnabled: true,
    judgeAvailable: true,
    channelId: "channel-test",
    provider: "elevenlabs",
    voiceId: "cast-voice",
    castScore: 7,
    castEvidence: makeVoicecraftAuditionEvidence({
      channelId: "channel-test",
      provider: "elevenlabs",
      voiceId: "cast-voice",
      castScore: 7,
      castJudgedAt: 1_780_000_000_000,
    }),
  };
  assert.doesNotThrow(() => assertVoiceGatePreconditions(voice));
  assert.throws(() => assertVoiceGatePreconditions({ ...voice, gateEnabled: false }), /cannot be disabled/);
  assert.throws(() => assertVoiceGatePreconditions({ ...voice, judgeAvailable: false }), /requires the audio judge/);
  assert.throws(() => assertVoiceGatePreconditions({ ...voice, voiceId: undefined }), /explicitly cast voice/);
  assert.throws(() => assertVoiceGatePreconditions({ ...voice, castScore: 6.99 }), /audition score >= 7/);
  assert.throws(
    () => assertVoiceGatePreconditions({ ...voice, voiceId: "different-voice" }),
    /evidence rejected.*selected voice/,
  );
  assert.throws(
    () => assertVoiceGatePreconditions({ ...voice, castEvidence: "voicecraft-audition" }),
    /structured voice-quality evidence/,
  );
  assert.doesNotThrow(() => assertVoiceGatePreconditions({
    profile: "draft",
    gateEnabled: false,
    judgeAvailable: false,
  }));
}

function configurationSpecificCostEnvelopes(): void {
  const envelope = (
    block: keyof typeof MODULE_CONTRACTS,
    params: Readonly<Record<string, unknown>>,
  ): number => {
    const calculate = MODULE_CONTRACTS[block].maxCostUsdFor;
    assert.ok(calculate, `${block} must declare a configuration-specific cost envelope`);
    return calculate(params, { entries: [{ block, params }], index: 0 });
  };

  assert.equal(
    envelope("thumbnail_gen", {}),
    PRICE.thumbnailConceptUsd + bananaUnitRate("flash") + PRICE.visionGraderUsd,
    "thumbnail reservation must cover concept, one text-free scene, and one publishing alarm",
  );

  const narrationCharacters =
    180 * 20 +
    2 * NARRATION_COLD_OPEN_MAX_CHARS +
    narrationChapterHeadingCharacterCeiling();
  const narrationEnvelope = envelope("narration_tts", {
      targetSeconds: 180,
      ttsProvider: "elevenlabs",
      chapterCards: true,
    });
  const expectedNarrationEnvelope =
    (narrationCharacters / 1_000) * PRICE.ttsElevenPerKCharUsd +
    2 * PRICE.visionGraderUsd;
  assert.ok(
    Math.abs(narrationEnvelope - expectedNarrationEnvelope) < 1e-12,
    "narration reservation must cover both cold-open attempts and bounded chapter headings",
  );

  const whiteboardPanels = 6;
  const whiteboardCharacters = Math.ceil(Math.round(132 * 3.1)) * 12;
  const whiteboardArt = whiteboardPanels * 5 * PRICE.novitaImageMaxUsd;
  assert.equal(
    envelope("whiteboard_scribe", { targetSeconds: 132 }),
    whiteboardArt + (whiteboardCharacters / 1_000) * PRICE.ttsPerKCharUsd,
    "default whiteboard reservation must match its bounded Fish path",
  );
  assert.equal(
    envelope("whiteboard_scribe", {
      targetSeconds: 132,
      ttsProvider: "elevenlabs",
      elevenVoiceId: "voice-fixture",
    }),
    whiteboardArt + (whiteboardCharacters / 1_000) * PRICE.ttsElevenPerKCharUsd,
    "cast ElevenLabs whiteboards must reserve the premium narration path",
  );

  const comicPanels = 8;
  const comicCharacters = Math.ceil(180 * 16);
  assert.equal(
    envelope("motion_comic", { panels: comicPanels, targetSeconds: 180 }),
    2 * comicPanels * PRICE.novitaImageMaxUsd +
      (comicCharacters / 1_000) * PRICE.ttsElevenPerKCharUsd +
      PRICE.musicTrackUsd +
      2 * comicPanels * PRICE.visionGraderUsd,
    "motion-comic reservation must cover art, dialogue, music, and lettering graders",
  );

  const maxWhiteboardArt = 16 * 5 * PRICE.novitaImageMaxUsd;
  const maxWhiteboardPremiumTts = (16 * 120 * 12 / 1_000) * PRICE.ttsElevenPerKCharUsd;
  assert.ok(
    (MODULE_CONTRACTS.whiteboard_scribe.maxCostUsd ?? 0) >= maxWhiteboardArt + maxWhiteboardPremiumTts,
    "whiteboard hard cap must cover all 16 panels, five direct Novita art workers each, and premium narration",
  );

  assert.equal(
    envelope("novita_render_images", { shotCount: 10, generationProfile: "production" }),
    20 * PRICE.novitaImageMaxUsd,
    "every Novita still shot must reserve the high-risk two-candidate path",
  );
  assert.equal(
    envelope("novita_render_video", { shotCount: 10, generationProfile: "production" }),
    10 * PRICE.novitaVideoMaxUsd,
    "Novita video reservation must follow the pinned profile fanout",
  );
  assert.equal(
    envelope("visual_matter", { renderReferenceAssets: false }),
    0,
    "planning-only Visual Matter must not reserve or silently spend image money",
  );
  assert.equal(
    envelope("visual_matter", { renderReferenceAssets: true, maxReferenceImages: 8 }),
    8 * PRICE.falNanoBanana2Usd,
    "an explicit Visual Matter reference pack must reserve its bounded fal.ai Nano Banana 2 allowance",
  );
  assert.equal(
    envelope("gen_footage", { maxClips: 6 }),
    6 * (PRICE.novitaImageMaxUsd + PRICE.novitaVideoMaxUsd),
    "generated footage must reserve the pinned Novita image and video ceilings",
  );
  assert.equal(
    envelope("qa_visual", { nativeWatch: true, audioQa: true }),
    qaVisualCost({ nativeWatch: true, audioQa: true }),
    "QA reservation and runtime pricing must share one calculator",
  );
}

/**
 * A catalog entry citing "src/lib/foo.ts" as if it's present on disk, when it
 * was actually deleted, is exactly the P2-7 regression this test guards
 * against (lofi.ts / motioncraft.ts / imagecraft-novita.ts / videocraft-novita.ts
 * were deleted in commit 183ee6a but their golden.ts entries kept describing
 * them as live "pending decision" files for a full session afterward).
 *
 * Every literal src/lib/*.ts, src/engine/*.ts, or src/trigger/**\/*.ts path
 * named in a module's `engine` + `how` prose must exist on disk UNLESS that
 * same mention sits within a short window of an explicit deletion/retirement
 * marker (DELETED, RETIRED, "removed outright", "now-deleted", "is retired",
 * "hard-disabled") -- the vocabulary this catalog already uses for cinecraft.ts
 * (retired) and the corrected lofi/motioncraft/imagecraft-novita/videocraft-novita
 * entries (deleted). This intentionally does NOT try to parse English well
 * enough to know a path is "deleted" from arbitrary phrasing -- it only
 * recognizes this catalog's own small, consistent vocabulary, so a genuinely
 * new phrasing must adopt one of these words rather than silently passing.
 */
function catalogCitedFilePathsExistOrAreExplicitlyRetired(): void {
  const PATH_RE = /\bsrc\/(?:lib|engine|trigger)\/[A-Za-z0-9_.\/-]+\.ts\b/g;
  const DELETION_MARKERS = /\b(DELETED|RETIRED|removed outright|now-deleted|is retired|hard-disabled)\b/i;
  const WINDOW = 150;
  const root = process.cwd();
  const stale: string[] = [];

  for (const mod of GOLDEN_MODULES) {
    const text = `${mod.engine ?? ""} ${mod.how ?? ""}`;
    for (const match of text.matchAll(PATH_RE)) {
      const filePath = match[0];
      const idx = match.index ?? 0;
      const windowText = text.slice(Math.max(0, idx - WINDOW), Math.min(text.length, idx + filePath.length + WINDOW));
      const explicitlyRetired = DELETION_MARKERS.test(windowText);
      if (!explicitlyRetired && !existsSync(join(root, filePath))) {
        stale.push(`${mod.key} -> ${filePath}`);
      }
    }
  }

  assert.deepEqual(
    stale,
    [],
    `golden.ts cites file path(s) that do not exist on disk and are not flagged DELETED/RETIRED nearby: ${stale.join(", ")}`,
  );
}

function main(): void {
  registerAllBlocks();
  const manifests = allManifests();
  assert.equal(manifests.length, 56, "all 56 executable blocks must have manifests");
  assert.deepEqual(
    manifests.filter((manifest) => manifest.certification.status === "legacy").map((manifest) => manifest.id),
    [],
    "production registry must not contain implicit legacy manifests",
  );
  directContractAudit();
  compileRepresentativeFamilies();
  defaultBudgetsCoverCompilerReservations();
  privateProbeKeepsEveryNonPublishingQualityRequirement();
  runtimeConfigurationIsCompiledBeforeSpendReservation();
  legacyMusicLoopNormalization();
  crewRemovalAndOrderFail();
  publicationNeedsApproval();
  declaredStoreBoundary();
  goldenPromotionGuards(manifests);
  failClosedQualityGuards();
  configurationSpecificCostEnvelopes();
  catalogCitedFilePathsExistOrAreExplicitlyRetired();
  console.log("module ABI, production compiler, and Golden promotion guard tests passed");
}

main();
