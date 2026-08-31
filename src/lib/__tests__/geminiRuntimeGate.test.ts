import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";

import {
  GEMINI_RUNTIME_OPT_IN_ENV,
  GeminiRuntimeDisabledError,
  assertGeminiRuntimeAllowed,
  geminiJson,
  hasGeminiKey,
  isGeminiModelIdentifier,
  parseJsonLoose,
  sealedNanoBananaThumbnailPurpose,
  uploadGeminiVideo,
} from "@/lib/gemini";
import {
  generateBananaImage,
  generateNanoBananaImageWithReceipt,
  hasNanoBanana,
} from "@/lib/banana";
import { embedText, hasEmbedKey } from "@/lib/embeddings";
import { browserbaseStagehandModel, withStagehand } from "@/lib/browserbase";
import { hydrateEnv } from "@/lib/vault";

const GATE_ENV = [
  "GEMINI_API_KEY",
  GEMINI_RUNTIME_OPT_IN_ENV,
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "BROWSERBASE_STAGEHAND_MODEL",
  "BROWSERBASE_STAGEHAND_MODEL_API_KEY",
  "MASTRA_PRODUCER_MODEL",
  "FAL_KEY",
] as const;

function restoreEnv(snapshot: Record<(typeof GATE_ENV)[number], string | undefined>): void {
  for (const name of GATE_ENV) {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  }
}

function isDisabled(error: unknown): boolean {
  return error instanceof GeminiRuntimeDisabledError && error.code === "GEMINI_RUNTIME_DISABLED";
}

async function defaultDenyStopsEveryGeminiBoundaryBeforeNetwork(): Promise<void> {
  const snapshot = Object.fromEntries(GATE_ENV.map((name) => [name, process.env[name]])) as Record<
    (typeof GATE_ENV)[number],
    string | undefined
  >;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  let stagehandCallbackCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "fixture-key";
    process.env.BROWSERBASE_API_KEY = "fixture-browserbase-key";
    process.env.BROWSERBASE_PROJECT_ID = "fixture-browserbase-project";
    process.env.BROWSERBASE_STAGEHAND_MODEL = "google/gemini-2.5-flash";
    process.env.BROWSERBASE_STAGEHAND_MODEL_API_KEY = "fixture-stagehand-model-key";
    process.env.MASTRA_PRODUCER_MODEL = "google/gemini-2.5-flash";
    delete process.env[GEMINI_RUNTIME_OPT_IN_ENV];
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("Gemini gate test must not reach fetch");
    }) as typeof fetch;

    assert.equal(hasGeminiKey(), false, "a legacy key alone must not admit Gemini text calls");
    for (const identifier of ["gemini-2.5-flash", "models/gemini-2.5-flash", "google/gemini-2.5-flash", "google:gemini-2.5-flash"]) {
      assert.equal(isGeminiModelIdentifier(identifier), true, `${identifier} must be rejected outside thumbnails`);
    }
    assert.equal(hasNanoBanana(), false, "a legacy key alone must not admit Nano Banana");
    assert.equal(hasEmbedKey(), false, "a legacy key alone must not admit Gemini embeddings");
    assert.deepEqual(parseJsonLoose<{ pure: boolean }>("{\"pure\":true}"), { pure: true });

    await assert.rejects(geminiJson({ prompt: "blocked text request" }), isDisabled);
    // The upload guard must precede both file I/O and the File API request.
    await assert.rejects(uploadGeminiVideo("/definitely/missing-video.mp4"), isDisabled);
    await assert.rejects(
      generateNanoBananaImageWithReceipt({ prompt: "blocked image request" }),
      isDisabled,
    );
    await assert.rejects(embedText("blocked embedding request"), isDisabled);
    await assert.rejects(withStagehand(async () => {
      stagehandCallbackCalls += 1;
      return "unreachable";
    }), isDisabled);

    // Import after pinning the model env so this proves creative agents do not
    // inherit the thumbnail opt-in and cannot construct a Google route.
    const { agentJson } = await import("@/agents/mastra");
    await assert.rejects(
      agentJson({
        role: "producer",
        prompt: "blocked Mastra Gemini request",
        schema: z.object({ answer: z.string() }),
      }),
      /Gemini models are sealed-image-only/,
    );
    assert.equal(stagehandCallbackCalls, 0, "Stagehand callback must not run after the provider refusal");
    assert.equal(networkCalls, 0, "every Gemini boundary must stop before fetch");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(snapshot);
  }
}

async function explicitOptInAdmitsOnlySealedImageAssetPurposes(): Promise<void> {
  const snapshot = Object.fromEntries(GATE_ENV.map((name) => [name, process.env[name]])) as Record<
    (typeof GATE_ENV)[number],
    string | undefined
  >;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "fixture-key";
    process.env[GEMINI_RUNTIME_OPT_IN_ENV] = "1";
    delete process.env.FAL_KEY;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("generic Gemini must remain blocked before network");
    }) as typeof fetch;

    assert.equal(hasGeminiKey(), false, "the thumbnail latch must never masquerade as a general Gemini key");
    assert.equal(hasNanoBanana(), true, "the sealed thumbnail capability remains opt-in");
    assert.equal(hasEmbedKey(), false, "thumbnail opt-in must not admit Gemini embeddings");
    assert.doesNotThrow(() => assertGeminiRuntimeAllowed(
      "sealed thumbnail fixture",
      sealedNanoBananaThumbnailPurpose(),
    ));
    assert.throws(
      () => assertGeminiRuntimeAllowed("forged thumbnail fixture", "sealed_thumbnail" as never),
      isDisabled,
      "a legacy string must not forge the opaque thumbnail capability at runtime",
    );
    await assert.rejects(geminiJson({ prompt: "still-blocked generic request" }), isDisabled);
    await assert.rejects(embedText("still-blocked embedding"), isDisabled);
    await assert.rejects(
      hydrateEnv("gemini"),
      isDisabled,
      "legacy scripts must not hydrate a Gemini key without the opaque thumbnail capability",
    );
    await assert.rejects(
      generateBananaImage({ prompt: "still-blocked generic image" }),
      /generic image generation requires FAL_KEY/,
    );
    assert.equal(networkCalls, 0, "thumbnail opt-in must not reach any generic Gemini endpoint");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(snapshot);
  }
}

function productionRunnersDoNotRequireThumbnailCredentials(): void {
  const nonThumbnailWorkers = [
    "../../trigger/runPipeline.ts",
    "../../trigger/architectPipelineTask.ts",
    "../../trigger/retentionAnalyst.ts",
    "../../trigger/verifyMastra.ts",
  ];
  for (const worker of nonThumbnailWorkers) {
    const source = readFileSync(new URL(worker, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /required:\s*\[\s*["']GEMINI_API_KEY["']\s*\]/,
      `${worker} must not make thumbnail-only Gemini credentials a production dependency`,
    );
  }

  const bootstrap = readFileSync(new URL("../bootstrap.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    bootstrap,
    /^\s*["']gemini["']\s*,/m,
    "generic worker bootstrap must never hydrate the thumbnail-only Gemini credential",
  );
  assert.doesNotMatch(
    bootstrap,
    /GOOGLE(?:_GENERATIVE_AI)?_API_KEY\s*=\s*process\.env\.GEMINI_API_KEY/,
    "bootstrap must not promote thumbnail-only Gemini credentials to global Google SDK keys",
  );
}

function walkProductionSource(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return walkProductionSource(path);
    }
    return entry.isFile() && /\.(?:ts|tsx|[cm]?js)$/.test(entry.name) ? [path] : [];
  });
}

function directGoogleRuntimeOwnersStaySealed(): void {
  const root = process.cwd();
  const allowedRestOwners = new Set([
    "src/lib/banana.ts",
    "src/lib/gemini.ts",
  ]);
  const sourceFiles = walkProductionSource(join(root, "src"));
  for (const file of sourceFiles) {
    const relativePath = relative(root, file);
    const source = readFileSync(file, "utf8");
    if (/generativelanguage\.googleapis\.com/.test(source)) {
      assert(allowedRestOwners.has(relativePath),
        `${relativePath} must not create a direct Google REST boundary`);
    }
  }

  const banana = readFileSync(join(root, "src/lib/banana.ts"), "utf8");
  assert.match(banana, /sealedNanoBananaThumbnailPurpose\(\)/,
    "the sealed thumbnail boundary must present its opaque capability");
  assert.match(banana, /hydrateEnv\(["']gemini["']\s*,\s*\{/,
    "the sealed thumbnail adapter, not generic bootstrap, must hydrate its own credential");
  const whiteboardAdapter = banana.slice(
    banana.indexOf("export async function generateNanoBananaProWhiteboardArtWithReceipt"),
    banana.indexOf("export async function generateBananaImage"),
  );
  assert.match(whiteboardAdapter, /hydrateSealedNanoBananaWhiteboardArtCredential\(\)/,
    "the Whiteboard Pro-art adapter must keep its own credential boundary");
  assert.match(whiteboardAdapter, /https:\/\/fal\.run\//,
    "the Whiteboard Pro-art adapter must use Fal");
  assert.doesNotMatch(whiteboardAdapter, /GEMINI_API_KEY|generativelanguage\.googleapis\.com|generateGeminiImage/,
    "the Whiteboard Pro-art adapter must not retain a direct Google boundary");
  assert.doesNotMatch(banana, /["']sealed_thumbnail["']/,
    "a string literal must never forge the sealed thumbnail capability");

  const browserbase = readFileSync(join(root, "src/lib/browserbase.ts"), "utf8");
  assert.match(browserbase, /assertNonGeminiModelIdentifier/,
    "Browserbase must reject Google model-router selections before Stagehand is imported");
  for (const relativePath of [
    "src/lib/browserbase.ts",
    "src/trigger/provisionYoutube.ts",
    "src/trigger/youtubeCreateChannel.ts",
  ]) {
    assert.doesNotMatch(readFileSync(join(root, relativePath), "utf8"), /google\/gemini/i,
      `${relativePath} must inherit the non-Google Browserbase policy rather than pin Gemini`);
  }
}

function legacyOperatorScriptsCannotCreateRawGoogleRuntime(): void {
  const root = process.cwd();
  const rawGoogleModelBoundary = /(?:generativelanguage|aiplatform|vertexai)\.googleapis\.com|@google\/generative-ai|google\.genai/;
  const scripts = walkProductionSource(join(root, "scripts"));
  for (const file of scripts) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      rawGoogleModelBoundary,
      `${relative(root, file)} must not create a raw Google model boundary; use the sealed thumbnail module instead`,
    );
  }
}

function browserAutomationGoogleModelIsRejectedBeforeImport(): void {
  const snapshot = Object.fromEntries(GATE_ENV.map((name) => [name, process.env[name]])) as Record<
    (typeof GATE_ENV)[number],
    string | undefined
  >;
  try {
    process.env.BROWSERBASE_STAGEHAND_MODEL = "google/gemini-2.5-flash";
    process.env.BROWSERBASE_STAGEHAND_MODEL_API_KEY = "fixture-stagehand-model-key";
    assert.throws(() => browserbaseStagehandModel(), isDisabled,
      "a browser agent must reject a Google model before its dynamic SDK import");
  } finally {
    restoreEnv(snapshot);
  }
}

async function main(): Promise<void> {
  await defaultDenyStopsEveryGeminiBoundaryBeforeNetwork();
  await explicitOptInAdmitsOnlySealedImageAssetPurposes();
  productionRunnersDoNotRequireThumbnailCredentials();
  directGoogleRuntimeOwnersStaySealed();
  legacyOperatorScriptsCannotCreateRawGoogleRuntime();
  browserAutomationGoogleModelIsRejectedBeforeImport();
  console.log("GEMINI RUNTIME GATE TESTS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
