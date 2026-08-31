import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadTo } from "@/lib/files";
import {
  generateMureka,
  generateMusic,
  generateSuno,
  MusicError,
  withMusicGenerationCost,
} from "@/lib/music";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

async function acceptedMusicDownloadTimeoutIsTerminal(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "music-output-timeout-"));
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  try {
    let calls = 0;
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      observedSignal = init?.signal ?? undefined;
      assert.ok(observedSignal, "accepted music output download carries its bounded timeout signal");
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          // Keep this hermetic simulated body alive until the request-local
          // timeout aborts it; no provider or real clock-scale wait is needed.
          keepAlive = setInterval(() => undefined, 1_000);
          observedSignal!.addEventListener("abort", () => {
            if (keepAlive) clearInterval(keepAlive);
            controller.error(observedSignal!.reason);
          }, { once: true });
        },
      }), { status: 200 });
    };

    let failure: unknown;
    try {
      await downloadTo("https://music-output.example/accepted-track.mp3", join(directory, "track.mp3"), {
        timeoutMs: 25,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error, "a stalled accepted output must surface before task expiry");
    assert.equal(calls, 1, "a timed-out accepted output is never downloaded through a second provider request");
    assert.equal(observedSignal!.aborted, true, "the bounded music output transfer aborts locally");

    // This is exactly the catch behavior in `lofiBlocks.music` after one
    // accepted Mureka/Suno generation: retain spend and abort Trigger retries.
    const charged = withMusicGenerationCost(failure, 1, 0.12) as Error & {
      retryable?: boolean;
      additionalObservedCostUsd?: number;
    };
    assert.equal(charged.retryable, false);
    assert.equal(charged.additionalObservedCostUsd, 0.12);
    const taskOutcome = taskErrorForRetryPolicy(charged);
    assert.equal(taskOutcome.classification.kind, "deterministic");
    assert.ok(taskOutcome.error instanceof Error);
    assert.equal(taskOutcome.error.name, "AbortTaskRunError");
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
}

async function boundedCreateTimeoutIsTerminal(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    for (const [provider, create] of [
      ["mureka", () => generateMureka({ prompt: "bounded create", timeoutMs: 0 })],
      ["suno", () => generateSuno({ prompt: "bounded create", timeoutMs: 0 })],
    ] as const) {
      let calls = 0;
      globalThis.fetch = async (_input, init) => {
        calls += 1;
        assert.ok(init?.signal, `${provider} create carries a bounded request signal`);
        throw Object.assign(new Error("request aborted after submission timeout"), {
          name: "TimeoutError",
        });
      };
      let failure: unknown;
      try {
        await create();
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof MusicError, `${provider} hung create is typed as ambiguous paid work`);
      assert.equal(failure.retryable, false);
      assert.equal(failure.safeToFallback, false);
      assert.match(failure.message, /outcome is unknown.*not resubmitting/i);
      assert.equal(calls, 1, `${provider} hung create is never resubmitted or provider-failed-over`);
      const taskOutcome = taskErrorForRetryPolicy(failure);
      assert.equal(taskOutcome.classification.kind, "deterministic");
      assert.ok(taskOutcome.error instanceof Error);
      assert.equal(taskOutcome.error.name, "AbortTaskRunError");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function wavUpgradeAmbiguityKeepsReadyMp3(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    const urls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      assert.ok(init?.signal, "every Suno create/poll/upgrade request is locally bounded");
      if (url.endsWith("/wav/generate")) {
        // The optional upgrade may already be accepted. It must never be
        // resubmitted; the completed MP3 remains a valid successful result.
        throw Object.assign(new Error("WAV upgrade response timed out"), { name: "TimeoutError" });
      }
      if (url.includes("/generate/record-info")) {
        return Response.json({
          data: {
            status: "SUCCESS",
            response: {
              sunoData: [{ id: "suno-audio-1", audioUrl: "https://music-output.example/ready.mp3" }],
            },
          },
        });
      }
      if (url.endsWith("/generate")) {
        return Response.json({ data: { taskId: "suno-main-job" } });
      }
      assert.fail(`unexpected music request ${url}`);
    };

    const result = await generateSuno({
      prompt: "ready MP3 with optional WAV upgrade",
      preferWav: true,
      pollIntervalMs: 0,
      timeoutMs: 100,
    });
    assert.equal(result.jobId, "suno-main-job");
    assert.equal(result.url, "https://music-output.example/ready.mp3");
    assert.equal(result.tracks[0]?.wavUrl, undefined);
    assert.equal(
      urls.filter((url) => url.endsWith("/generate") && !url.includes("/wav/")).length,
      1,
      "main generation stays at one create",
    );
    assert.equal(urls.filter((url) => url.endsWith("/wav/generate")).length, 1, "ambiguous WAV upgrade stays at one create");
    assert.equal(urls.length, 3, "ready MP3 falls through without a poll or create retry for WAV");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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

    await acceptedMusicDownloadTimeoutIsTerminal();
    await boundedCreateTimeoutIsTerminal();
    await wavUpgradeAmbiguityKeepsReadyMp3();

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
