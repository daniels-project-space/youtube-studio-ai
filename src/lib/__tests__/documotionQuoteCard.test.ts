import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildShotSpecs, type DocuPlan } from "@/lib/documotion";
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
  assert.match(docuSource, /quoteEmphasis/, "emphasis must ride the already-required planning response");
  assert.match(remotionSource, /planQuoteCardLayout/, "the production component must use the tested responsive planner");
}

async function main(): Promise<void> {
  assertResponsiveLayout();
  await assertZeroProviderCardAssembly();
  await assertSourceContract();
  console.log("DOCUMOTION QUOTE CARD ROOT-CAUSE PASS");
}

void main();
