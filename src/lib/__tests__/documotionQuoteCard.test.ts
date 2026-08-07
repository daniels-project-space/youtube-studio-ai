import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDocuAssetPrompt,
  buildShotSpecs,
  isAssetGateApproved,
  normalizeDocuPlan,
  type DocuPlan,
  validatePlan,
} from "@/lib/documotion";
import { renderDocuStills } from "@/lib/remotionRender";
import { DOCU_STYLES } from "@/remotion/docuStyles";
import { planQuoteCardLayout, resolveQuoteCardEmphasis } from "@/remotion/DocuMotion";

const LONG_QUOTE =
  "They promised the forest would become a perfect city, but when the roads disappeared beneath the rain, the river remembered every name and the families carried the unfinished map home.";

function assertResponsiveLayout(): void {
  const frames = [
    { width: 1_920, height: 1_080 },
    { width: 960, height: 540 },
    { width: 1_080, height: 1_920 },
  ];
  for (const style of Object.values(DOCU_STYLES)) {
    for (const frame of frames) {
      const layout = planQuoteCardLayout({
        quote: LONG_QUOTE,
        ...frame,
        displayCharWidth: style.theme.displayCharW,
        hasAttribution: true,
      });
      assert.ok(layout.panelWidth <= frame.width * 0.801, `${style.id} panel exceeds horizontal safe area`);
      assert.ok(layout.panelMaxHeight <= frame.height * 0.681, `${style.id} panel exceeds vertical safe area`);
      assert.ok(layout.quoteWidth > 0 && layout.fontSize >= 18, `${style.id} text remains readable`);
      assert.ok(layout.estimatedLines >= 2, `${style.id} long fixture must exercise wrapping`);
      assert.ok(
        layout.estimatedQuoteHeight <= layout.quoteMaxHeight + 0.01,
        `${style.id} long quote must fit the reserved text area at ${frame.width}x${frame.height}`,
      );
    }
  }

  assert.deepEqual(
    resolveQuoteCardEmphasis(LONG_QUOTE, ["river", "remembered", "families"]),
    ["river", "remembered", "families"],
    "the main plan's exact emphasis survives without a second model pass",
  );
  assert.deepEqual(
    resolveQuoteCardEmphasis("It was the end of the road"),
    ["end", "road"],
    "cached plans get stable non-filler tail emphasis",
  );
  assert.deepEqual(
    resolveQuoteCardEmphasis(LONG_QUOTE, "river remembered"),
    ["river", "remembered"],
    "a provider's string-shaped emphasis is normalized without a render crash",
  );
  assert.deepEqual(
    resolveQuoteCardEmphasis("It was the end of the road", { malformed: true }),
    ["end", "road"],
    "invalid non-array emphasis falls back deterministically",
  );
}

function assertPlanAndAssetContracts(): void {
  const normalized = normalizeDocuPlan({
    title: "Fixture",
    styleId: "archival_collage",
    shots: [
      {
        kind: "quote_card",
        narration: "The river remembers the promise.",
        scale: "close",
        beat: "The promise remains",
        durationSec: 6,
        camera: { move: "push_in", intensity: "subtle" },
        quote: "The river remembers the promise.",
        quoteEmphasis: "river remembers",
        attribution: "Archive",
        assets: [],
      },
    ],
  });
  assert.deepEqual(normalized.shots[0].quoteEmphasis, ["river", "remembers"]);

  const malformed = normalizeDocuPlan({
    ...normalized,
    shots: [{ ...normalized.shots[0], quoteEmphasis: { unexpected: true } }],
  });
  assert.equal(malformed.shots[0].quoteEmphasis, undefined, "object-shaped emphasis is removed before provider work");

  const overlong = {
    ...normalized,
    shots: [
      {
        ...normalized.shots[0],
        quote: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
      },
    ],
  };
  assert.ok(
    validatePlan(overlong, 6, DOCU_STYLES.archival_collage).some((problem) => problem.includes("quote_card quote must be <=14 words")),
    "the production plan rejects quote copy beyond the render contract before image or TTS spend",
  );

  const quoteSentinel = "NEVER PAINT THIS SENTINEL QUOTE";
  const picturePrompt = buildDocuAssetPrompt({
    framingPrefix: "Wide plate: ",
    pictureBrief: `Dark forest behind the exact words ${quoteSentinel}`,
    stillStyle: " archival collage.",
    quality: " sharp.",
    forbiddenCopy: [quoteSentinel],
  });
  assert.doesNotMatch(picturePrompt, new RegExp(quoteSentinel), "quote copy must never enter the provider image prompt");
  assert.match(picturePrompt, /PICTURE-ONLY CONTRACT/);
  assert.match(picturePrompt, /All readable typography is added later by Remotion/);

  assert.equal(
    isAssetGateApproved({ verdictValid: true, styleOk: true, briefOk: true, noText: true, framingOk: true }),
    true,
  );
  assert.equal(
    isAssetGateApproved({ verdictValid: true, styleOk: true, briefOk: true, framingOk: true }),
    false,
    "an omitted noText verdict must fail closed",
  );
  assert.equal(
    isAssetGateApproved({ verdictValid: true, styleOk: true, briefOk: true, noText: false, framingOk: true }),
    false,
    "a text-bearing final provider image must never be accepted",
  );
}

async function assertActualRenderedBounds(): Promise<string> {
  const outputDir = join(tmpdir(), "youtube-studio-ai-documotion-quote-regression");
  await mkdir(outputDir, { recursive: true });
  const resolutions = [
    { width: 960, height: 540 },
    { width: 1_920, height: 1_080 },
    { width: 1_080, height: 1_920 },
  ];

  for (const style of Object.values(DOCU_STYLES)) {
    for (const resolution of resolutions) {
      const output = join(outputDir, `${style.id}-${resolution.width}x${resolution.height}.jpg`);
      // QuoteCardShot measures the actual loaded browser font. renderStill
      // throws if the quote/panel DOM boxes still overflow after autofit, so
      // this is a real rendered-bounds regression rather than an estimate.
      await renderDocuStills({
        shots: [
          {
            kind: "quote_card",
            durationInFrames: 180,
            camera: { move: "drift", intensity: "subtle" },
            quote: LONG_QUOTE,
            quoteEmphasis: ["river", "remembered", "families"],
            attribution: "Archive testimony",
          },
        ],
        frames: [110],
        outPaths: [output],
        ...resolution,
        theme: style.theme,
        fontCss: style.fontCss,
        fontProbe: style.fontProbe,
      });
      assert.ok((await stat(output)).size > 10_000, `${style.id} ${resolution.width}x${resolution.height} render is empty`);
    }
  }
  return outputDir;
}

async function assertZeroProviderCardAssembly(): Promise<void> {
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("quote-card assembly attempted a provider call");
  }) as typeof fetch;
  try {
    const plan: DocuPlan = {
      title: "Fixture",
      styleId: "archival_collage",
      shots: [
        {
          kind: "quote_card",
          narration: "The river remembers the unfinished promise.",
          scale: "close",
          beat: "The promise remains",
          durationSec: 6,
          camera: { move: "push_in", intensity: "subtle" },
          quote: LONG_QUOTE,
          quoteEmphasis: ["river", "remembered", "families"],
          attribution: "Archive testimony",
          assets: [],
        },
      ],
    };
    const [spec] = await buildShotSpecs(plan, [], 6, {}, {}, [6]);
    assert.equal(providerCalls, 0, "building deterministic quote typography must make zero network/provider calls");
    assert.equal(spec.quote, LONG_QUOTE);
    assert.deepEqual(spec.quoteEmphasis, ["river", "remembered", "families"]);
    assert.equal("typeImage" in spec, false, "the render ABI must not accept model-painted quote text");
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function assertSourceContract(): Promise<void> {
  const docuSource = await readFile(join(process.cwd(), "src/lib/documotion.ts"), "utf8");
  const remotionSource = await readFile(join(process.cwd(), "src/remotion/DocuMotion.tsx"), "utf8");
  assert.doesNotMatch(docuSource, /bananaTypeCard|typeByShot|typeImage/, "DocuMotion orchestration must not generate typographic images");
  assert.doesNotMatch(remotionSource, /typeImage|BANANA-DESIGNED/, "Remotion must have one deterministic text path, not an image override");
  assert.doesNotMatch(docuSource, /shipping last attempt/, "a rejected final provider image must fail closed");
  assert.doesNotMatch(docuSource, /quote_card \/ closing card MAY be a fully DESIGNED TYPOGRAPHIC image/);
  assert.match(docuSource, /quoteEmphasis/, "emphasis must ride the already-required planning response");
  assert.match(remotionSource, /planQuoteCardLayout/, "the production component must use the tested responsive planner");
  assert.match(remotionSource, /data-docu-quote-text/, "the production card must expose its actual measured quote box");
  assert.match(docuSource, /maxProviderAttempts: 1/, "the outer quality loop must own the bounded provider retry budget");
  assert.ok(
    docuSource.indexOf("plan = normalizeDocuPlan(JSON.parse") < docuSource.indexOf("let assets = await generateDocuAssets"),
    "cached plans must normalize and validate before any downstream provider spend",
  );
}

async function main(): Promise<void> {
  assertResponsiveLayout();
  assertPlanAndAssetContracts();
  await assertZeroProviderCardAssembly();
  await assertSourceContract();
  const outputDir = await assertActualRenderedBounds();
  console.log(`DOCUMOTION QUOTE CARD ROOT-CAUSE PASS — actual renders: ${outputDir}`);
}

void main();
