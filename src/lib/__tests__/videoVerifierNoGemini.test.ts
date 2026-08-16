import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateIdentity, evaluateSeo } from "@/lib/videoVerifier";

async function main(): Promise<void> {
  const verifierSource = readFileSync(new URL("../videoVerifier.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    verifierSource,
    /@\/lib\/gemini|\b(?:geminiJson|hasGeminiKey|parseJsonLoose)\b/,
    "video verification must never borrow the sealed thumbnail-only Gemini runtime",
  );
  assert.match(
    verifierSource,
    /providers:\s*\["groq", "fal"\]/,
    "frame grading must pin the independent Groq/FAL provider scope",
  );

  const strongSeo = await evaluateSeo({
    title: "Amelia Earhart's Disappearance: The Evidence Still Unsolved",
    description:
      "This evidence-led aviation history investigation follows Amelia Earhart's disappearance, " +
      "the clues left by her final flight, and the archival evidence that still shapes the case. " +
      "We compare contemporary reports, radio signals, search records, and the unanswered questions " +
      "behind one of aviation history's most enduring mysteries.",
    tags: [
      "Amelia Earhart",
      "Amelia Earhart disappearance",
      "aviation history",
      "historical evidence",
      "unsolved case",
    ],
    niche: "aviation history",
  });
  assert.ok(strongSeo.score >= 8, `complete literal SEO evidence should score strongly (received ${strongSeo.score})`);
  assert.equal(strongSeo.skipped, undefined, "deterministic metadata review must run without a cloud model key");

  const emptySeo = await evaluateSeo({ title: "", description: "", tags: [] });
  assert.equal(emptySeo.score, 0, "missing metadata must never receive a pass-like score");
  assert.match(emptySeo.issues.join(" "), /Title is missing/);

  const alignedIdentity = await evaluateIdentity({
    title: "Amelia Earhart's Disappearance: The Evidence Still Unsolved",
    topic: "An aviation history investigation into Amelia Earhart's disappearance and the evidence left behind",
    persona: "Evidence-led aviation history investigator",
    niche: "aviation history",
    styleGrammar: "cinematic evidence-led documentary",
  });
  assert.ok(alignedIdentity.score >= 5, `literal identity continuity should clear the release floor (received ${alignedIdentity.score})`);
  assert.equal(alignedIdentity.skipped, undefined);

  const unprovenIdentity = await evaluateIdentity({
    title: "The Budget Pasta Method That Saves Dinner",
    topic: "A fast tomato pasta dinner for busy parents",
    persona: "Evidence-led aviation history investigator",
    niche: "aviation history",
    styleGrammar: "cinematic evidence-led documentary",
  });
  assert.ok(unprovenIdentity.score < 5, "no literal brand continuity must stay below the release floor");
  assert.match(unprovenIdentity.issues.join(" "), /deterministic on-brand evidence is insufficient/);

  const missingPersona = await evaluateIdentity({ title: "A documented mystery", topic: "A documented mystery" });
  assert.equal(missingPersona.skipped, true, "missing channel identity must remain explicitly unmeasured");
  assert.equal(missingPersona.score, 0, "an unmeasured identity must not carry a pass-like score");

  const qaSource = readFileSync(new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url), "utf8");
  assert.match(qaSource, /export const qaVisual/, "live qa_visual block must remain registered");
  assert.match(qaSource, /const seo = await evaluateSeo\(/, "qa_visual must retain SEO QA");
  assert.match(qaSource, /const identity = await evaluateIdentity\(/, "qa_visual must retain channel-identity QA");

  console.log("videoVerifier deterministic no-Gemini QA tests passed");
}

void main();
