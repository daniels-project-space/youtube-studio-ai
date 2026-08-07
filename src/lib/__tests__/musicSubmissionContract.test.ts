import assert from "node:assert/strict";
import {
  generateMureka,
  generateMusic,
  generateSuno,
  MusicError,
  withMusicGenerationCost,
} from "@/lib/music";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalMurekaKey = process.env.MUREKA_API_KEY;
  const originalSunoKey = process.env.SUNO_API_KEY;
  process.env.MUREKA_API_KEY = "test-mureka";
  process.env.SUNO_API_KEY = "test-suno";

  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("socket reset after upload");
    };
    await assert.rejects(
      generateMureka({ prompt: "test", timeoutMs: 0 }),
      (error: unknown) =>
        error instanceof MusicError &&
        error.retryable === false &&
        error.safeToFallback === false &&
        /not resubmitting/i.test(error.message),
    );
    assert.equal(calls, 1, "Mureka transport ambiguity must submit once");

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ id: "mureka-job-1", status: "preparing" });
    };
    await assert.rejects(
      generateMureka({ prompt: "test", timeoutMs: 0 }),
      (error: unknown) =>
        error instanceof MusicError &&
        error.acceptedUnits === 1 &&
        error.acceptedJobId === "mureka-job-1",
    );
    assert.equal(calls, 1, "an accepted Mureka receipt must not create a second job");

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ msg: "upstream error" }, { status: 503 });
    };
    await assert.rejects(
      generateSuno({ prompt: "test", timeoutMs: 0 }),
      (error: unknown) =>
        error instanceof MusicError && error.status === 503 && error.safeToFallback === false,
    );
    assert.equal(calls, 1, "Suno 5xx must not trigger a legacy-shape resubmission");

    calls = 0;
    const createBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      createBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (calls === 1) return Response.json({ msg: "custom mode unsupported" }, { status: 400 });
      return Response.json({ data: { taskId: "suno-job-1" } });
    };
    await assert.rejects(
      generateSuno({ prompt: "test", timeoutMs: 0 }),
      (error: unknown) =>
        error instanceof MusicError &&
        error.acceptedUnits === 1 &&
        error.acceptedJobId === "suno-job-1",
    );
    assert.equal(calls, 2, "only an explicit schema rejection may use the legacy request shape");
    assert.equal(createBodies[0].customMode, true);
    assert.equal(createBodies[1].customMode, false);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("ambiguous preferred-provider submission");
    };
    await assert.rejects(generateMusic({ provider: "mureka", prompt: "test", timeoutMs: 0 }));
    assert.equal(calls, 1, "provider routing must not fall back after an ambiguous submission");

    calls = 0;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      calls += 1;
      if (url.includes("mureka")) return Response.json({ message: "quota exceeded" }, { status: 429 });
      return Response.json({ msg: "suno unavailable" }, { status: 503 });
    };
    await assert.rejects(generateMusic({ provider: "mureka", prompt: "test", timeoutMs: 0 }));
    assert.equal(calls, 2, "an explicit quota rejection may try the configured alternate once");
    assert(urls[0].includes("mureka"));
    assert(urls[1].includes("suno"));

    const acceptedFailure = new MusicError("accepted job later failed", { acceptedUnits: 1 });
    const charged = withMusicGenerationCost(acceptedFailure, 2, 0.12) as Error & {
      retryable?: boolean;
      additionalObservedCostUsd?: number;
    };
    assert.equal(charged.retryable, false);
    assert(Math.abs((charged.additionalObservedCostUsd ?? 0) - 0.36) < 1e-9);

    console.log("MUSIC SUBMISSION CONTRACT PASS: at-most-once create, bounded safe fallback, failed-spend carry");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMurekaKey === undefined) delete process.env.MUREKA_API_KEY;
    else process.env.MUREKA_API_KEY = originalMurekaKey;
    if (originalSunoKey === undefined) delete process.env.SUNO_API_KEY;
    else process.env.SUNO_API_KEY = originalSunoKey;
  }
}

void main();
