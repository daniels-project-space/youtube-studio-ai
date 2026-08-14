import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasNonGoogleVisionKey, hasVisionKey } from "@/lib/vision";

const source = readFileSync(new URL("../vision.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /geminiVisionBuffers|geminiVisionLocal/);
assert.match(source, /export type VisionProvider = "groq" \| "fal"/);

const saved = {
  providers: process.env.VISION_PROVIDERS,
  groq: process.env.GROQ_API_KEY,
  fal: process.env.FAL_KEY,
  gemini: process.env.GEMINI_API_KEY,
  disableGemini: process.env.VISION_DISABLE_GEMINI,
};

try {
  process.env.VISION_PROVIDERS = "gemini";
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GROQ_API_KEY;
  delete process.env.FAL_KEY;
  delete process.env.VISION_DISABLE_GEMINI;
  assert.equal(hasVisionKey(), false, "a Gemini-only environment is never an eligible vision-review route");
  assert.equal(hasNonGoogleVisionKey(), false, "a Gemini-only chain is not valid evidence for a certified independent review");

  process.env.VISION_PROVIDERS = "groq,gemini";
  process.env.GROQ_API_KEY = "test-key";
  assert.equal(hasNonGoogleVisionKey(), true);
} finally {
  for (const [key, value] of Object.entries({
    VISION_PROVIDERS: saved.providers,
    GROQ_API_KEY: saved.groq,
    FAL_KEY: saved.fal,
    GEMINI_API_KEY: saved.gemini,
    VISION_DISABLE_GEMINI: saved.disableGemini,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("vision provider-scope tests passed");
