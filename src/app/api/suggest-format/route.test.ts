import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POST } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";

function request(body: unknown): Request {
  return new Request("https://studio.test/api/suggest-format", {
    method: "POST",
    headers: {
      authorization: `Bearer ${INTERNAL_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function main() {
  const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;

  try {
    let remoteCalls = 0;
    globalThis.fetch = (async () => {
      remoteCalls += 1;
      throw new Error("format suggestion must not call a remote provider");
    }) as typeof fetch;

    const response = await POST(request({
      concept: "Illustrated graphic-novel history with motion-comic panels",
    }));
    assert.equal(response.status, 200);
    const recommendation = await response.json() as {
      family: string;
      fallback: boolean;
      reasoning: string;
      preflight: { validationRenderRequired: boolean };
      executableAlternatives: Array<{
        family: string;
        selectable: boolean;
        executable: boolean;
        certifiedFamilyAdmission: { automatic: boolean };
      }>;
    };
    assert.equal(recommendation.family, "comic");
    assert.equal(recommendation.fallback, true);
    assert.equal(recommendation.preflight.validationRenderRequired, true);
    assert.match(recommendation.reasoning, /Matched/i);
    assert.deepEqual(
      recommendation.executableAlternatives.map((alternate) => alternate.family),
      ["narrated_stock"],
      "the API must keep factual comic history on an evidence path and expose only its deliberate factual adaptation",
    );
    assert.equal(
      recommendation.executableAlternatives.every(
        (alternate) => alternate.selectable && alternate.executable && alternate.certifiedFamilyAdmission.automatic,
      ),
      true,
      "the API must never advertise a merely available or supervised family as an executable alternative",
    );
    assert.equal(remoteCalls, 0);

    const audienceLedChildren = await POST(request({
      concept: "Original animated bedtime stories",
      audience: "Preschool children ages 3 to 5",
      sampleTopics: ["A gentle toddler learning adventure"],
    }));
    assert.equal(audienceLedChildren.status, 200);
    const childrenRecommendation = await audienceLedChildren.json() as {
      family: string;
      available: boolean;
      preflight: { creativeCapabilities: Array<{ capability: string }> };
    };
    assert.equal(childrenRecommendation.family, "children_learning");
    assert.equal(childrenRecommendation.available, false);
    assert.equal(
      childrenRecommendation.preflight.creativeCapabilities.some((offer) => offer.capability === "children_show_bible"),
      true,
      "audience/sample-topic context must reach the deterministic selector and surface its private-review admission",
    );
    assert.equal(remoteCalls, 0);

    const missing = await POST(request({ concept: "   " }));
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "missing concept" });

    const unauthorized = await POST(new Request("https://studio.test/api/suggest-format", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concept: "A channel" }),
    }));
    assert.equal(unauthorized.status, 401);
    assert.equal(remoteCalls, 0);

    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /recommendFormatDeterministically\(body\)/);
    assert.doesNotMatch(source, /\bselectFormat\s*\(/);
    assert.doesNotMatch(source, /bootstrapSecrets|@\/lib\/gemini/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
  }

  console.log("Deterministic suggest-format route tests passed");
}

void main();
