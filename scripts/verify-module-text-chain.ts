/** Text-only integration evidence. No production writes, renders or publishing. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { synthShowBible, inspectShowBibleQuality } from "@/engine/creative/showBible";
import type { ShowBible } from "@/engine/creative/types";
import { synthStyleDNA, styleDNAConfidence } from "@/engine/creative/styleDNA";
import { briefDirector, briefCinematographer, briefEditor, briefComposer } from "@/engine/creative/crew";
import { synthScript } from "@/lib/scriptGen";
import { craftMetadata } from "@/lib/metacraft";
import { createModelUsageScope } from "@/lib/modelUsage";
import { parseShowBibleVoice } from "@/engine/showBibleVoice";

const cases = {
  archive: {
    name: "The Small Machine Archive",
    family: "narrated_stock" as const,
    niche: "fictional mechanical mysteries, explicitly invented stories",
    persona: "A dry, patient archivist who explains one invented mechanism through concrete observations. Understatement, no hype, no supernatural explanations. Close the exact mechanical question opened at the start.",
    styleGrammar: "Precise ink cross-sections, graphite grey and teal enamel, a tiny brass inspection lamp. No glossy science-fiction interfaces.",
    topic: "An invented clock whose minute hand stops whenever the workshop door opens",
    motifHint: "a small brass inspection lamp",
    maxSeconds: 90,
  },
  quiet: {
    name: "A Little Room to Rest",
    family: "sleep" as const,
    niche: "gentle secular guided reflection, no medical or therapeutic promises",
    persona: "A warm, restrained companion speaking to one tired adult. Offer choices rather than commands. Eyes can remain open; no breath holding, forced deep breaths, spiritual doctrine, or promised health outcomes.",
    styleGrammar: "Soft green window light, a clear glass of water and a worn blue cushion. Still, ordinary and grounded rather than cosmic or luxurious.",
    topic: "Letting an unfinished chore remain unfinished for one quiet minute",
    motifHint: "a clear glass of water beside a blue cushion",
    maxSeconds: 90,
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || !args.includes("--live")) {
    console.log("Usage: verify-module-text-chain.ts --live --case archive|quiet --output DIRECTORY [--resume-from DIRECTORY] [--identity-only]");
    console.log("Uses the approved text models only; max 20 dispatches and $1 conservative exposure per invocation.");
    if (!args.includes("--help")) process.exitCode = 1;
    return;
  }
  const caseName = args[args.indexOf("--case") + 1] as keyof typeof cases;
  const outputArg = args.includes("--output") ? args[args.indexOf("--output") + 1] : undefined;
  if (!Object.hasOwn(cases, caseName) || !outputArg) throw new Error("explicit --case and --output required");
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY required");
  const directory = resolve(outputArg);
  const resumeDirectory = args.includes("--resume-from") ? args[args.indexOf("--resume-from") + 1] : undefined;
  if (args.includes("--resume-from") && !resumeDirectory) throw new Error("--resume-from requires a directory");
  // Refuse overwrites: a failed run remains evidence, not an implicit retry.
  await mkdir(directory, { recursive: false });
  const input = cases[caseName];
  const nativeFetch = globalThis.fetch;
  const catalogResponse = await nativeFetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
  if (!catalogResponse.ok) throw new Error(`model catalog HTTP ${catalogResponse.status}`);
  const catalog = await catalogResponse.json() as { data: Array<{ id: string; pricing: { prompt: string; completion: string } }> };
  const prices = new Map(catalog.data.map(model => [model.id, model.pricing]));
  const scope = createModelUsageScope();
  const dispatches: { model: string; maximumOutputTokens: number; reservedUsd: number }[] = [];
  const receipts: unknown[] = [];
  const pendingReceipts: Promise<void>[] = [];
  let reservedUsd = 0;
  let failure: string | undefined;
  const stages: Record<string, unknown> = {};
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") {
      throw new Error("text proof refuses unrelated network operations");
    }
    const body = JSON.parse(String(options?.body)) as { model: string; max_tokens: number; messages: unknown };
    const pricing = prices.get(body.model);
    const inputRate = Number(pricing?.prompt), outputRate = Number(pricing?.completion);
    if (!pricing || !Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate < 0 || outputRate < 0 ||
        !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1) throw new Error("unpriced or unbounded text request");
    // UTF-8 bytes conservatively bound input tokens, with chat-framing headroom.
    const reservation = (Buffer.byteLength(JSON.stringify(body.messages)) + 4096) * inputRate + body.max_tokens * outputRate;
    if (dispatches.length >= 20 || reservedUsd + reservation > 1) throw new Error("text proof dispatch/exposure limit reached");
    reservedUsd += reservation;
    dispatches.push({ model: body.model, maximumOutputTokens: body.max_tokens, reservedUsd: reservation });
    const response = await nativeFetch(url, options);
    const dispatchIndex = dispatches.length;
    pendingReceipts.push(response.clone().json().then(payload => {
      receipts.push({ dispatchIndex, status: response.status, id: payload.id, model: payload.model,
        usage: payload.usage, finishReasons: payload.choices?.map((choice: { finish_reason?: string }) => choice.finish_reason),
        error: payload.error });
    }).catch(() => { receipts.push({ dispatchIndex, status: response.status, unreadable: true }); }));
    return response;
  };
  const log = (message: string) => console.log(`[${caseName}] ${message}`);
  async function stage<T>(name: string, produce: () => Promise<T>): Promise<T> {
    log(`starting ${name}`);
    const output = await produce();
    assert.notEqual(output, undefined, `${name} returned no usable module output`);
    stages[name] = output;
    await writeFile(resolve(directory, `${name}.json`), JSON.stringify(output, null, 2), { flag: "wx" });
    log(`saved ${name}`);
    return output;
  }
  try {
    await scope.run(async () => {
      const identity = { ...input, now: Date.now(), log };
      const bible = await stage("show-bible", async () => {
        if (!resumeDirectory) return synthShowBible(identity);
        const prior = JSON.parse(await readFile(resolve(resumeDirectory, "report.json"), "utf8"));
        assert.deepEqual(prior.input, input, "reuse requires the identical authored channel and topic");
        assert.ok(prior.completedStages.includes("show-bible"), "only a completed show bible can be reused");
        const saved = JSON.parse(await readFile(resolve(resumeDirectory, "show-bible.json"), "utf8")) as ShowBible;
        assert.deepEqual(inspectShowBibleQuality(saved, input.family), [], "saved bible still satisfies the module's output contract");
        log(`reusing completed show bible from ${resolve(resumeDirectory)}`);
        return saved;
      });
      assert.ok(bible.worksInSpace.length && bible.avoidInSpace.length, "an empty fallback bible is not qualification");
      const dna = await stage("style-dna", () => synthStyleDNA(identity));
      assert.notEqual(dna.source, "ungrounded", "an ungrounded skeleton is not a usable channel identity");
      assert.ok(dna.confidence >= styleDNAConfidence({ hasVision: false, hasTitles: false, hasDatabank: false, accepted: true }),
        "identity must pass independent review, not merely return a filled object");
      assert.ok(dna.recurringSubject && dna.audio.instrumentation.length && dna.seo.titleFormula,
        "identity must be usable by visual, audio and packaging consumers");
      if (args.includes("--identity-only")) return;
      const ctx = { ...input, targetSeconds: input.maxSeconds, channelName: input.name,
        dnaDigest: JSON.stringify(dna), dnaAudio: JSON.stringify(dna.audio), log };
      const director = await stage("director", () => briefDirector(bible, ctx));
      await stage("cinematographer", () => briefCinematographer(bible, ctx));
      await stage("editor", () => briefEditor(bible, ctx));
      await stage("composer", () => briefComposer(bible, ctx));
      const script = await stage("script", () => synthScript({ ...input, channelName: input.name,
        channelVoice: parseShowBibleVoice(bible) ?? undefined, narrative: dna.narrative, structure: director ?? undefined,
        style: caseName === "quiet" ? "meditation" : "essay", language: "en" }, log));
      assert.ok(script.narrationText.trim() && script.sections.length, "script must contain actual spoken content");
      assert.ok(script.estDurationSec <= input.maxSeconds * 1.15,
        "spoken output must remain within 15% of its requested duration before packaging");
      const metadata = await stage("metadata", () => craftMetadata({ ...input, channelName: input.name,
        narrationText: script.narrationText, coldOpen: script.crafted?.coldOpen, hookLoop: script.hookLoop,
        quote: script.closingLine, competitorTitles: [], channelVoice: parseShowBibleVoice(bible) ?? undefined,
        titleFormula: dna.seo.titleFormula, descriptionStructure: dna.seo.descriptionStructure, language: "en", log }));
      assert.ok(metadata.judged, "unjudged packaging is not a passing chain");
    });
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = nativeFetch;
    await Promise.all(pendingReceipts);
    const report = { caseName, scope: args.includes("--identity-only") ? "identity" : "text-chain",
      input, completedStages: Object.keys(stages), passed: !failure,
      failure, dispatches, receipts, reusedShowBibleFrom: resumeDirectory ? resolve(resumeDirectory) : undefined,
      conservativeReservedUsd: reservedUsd, usage: scope.snapshot(),
      limitations: "Text-only standalone module integration; not production channel creation, render, or release qualification." };
    await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ passed: report.passed, completedStages: report.completedStages,
      failure, dispatchCount: dispatches.length, conservativeReservedUsd: reservedUsd, directory }));
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
