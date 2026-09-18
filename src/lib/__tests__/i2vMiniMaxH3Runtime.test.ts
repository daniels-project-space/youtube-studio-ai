import assert from "node:assert/strict";
import Module from "node:module";

import { sha256BytesHex } from "@/lib/sha256";

const firstFrame = Buffer.from("immutable-first-frame-bytes");
let h3Calls: Array<Record<string, unknown>> = [];

const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function h3I2vRuntimeLoad(request, ...args) {
  if (request === "@/lib/minimaxH3" || request.endsWith("/minimaxH3")) {
    return {
      MINIMAX_H3_RUNTIME_ID: "minimax-h3-turbo8-5090/v1",
      MINIMAX_H3_PROFILE: { id: "minimax-h3-720p-124f", frames: 124, fps: 24 },
      renderMiniMaxH3: async (input: Record<string, unknown>) => {
        h3Calls.push(input);
        return {
          outputBytes: Buffer.from("validated-h3-take"),
          receipt: {
            jobId: "h3-job-1",
            output: { r2Key: (input.output as { r2Key: string }).r2Key },
            runtime: { costUsd: 0.19 },
          },
        };
      },
    };
  }
  if (request === "@/lib/storage" || request.endsWith("/storage")) {
    return {
      getObjectBytes: async (key: string) => {
        assert.equal(key, "owners/o/channels/c/accepted-first-frame.png");
        return firstFrame;
      },
      presignDownload: async (key: string) => `https://r2.example.test/${key}`,
    };
  }
  return originalLoad.call(this, request, ...args);
};

async function main(): Promise<void> {
  const { generateI2V } = await import("../i2v");
  const result = await generateI2V({
    prompt: "A moonlit archive slowly reveals its hidden ledger.",
    imageKey: "owners/o/channels/c/accepted-first-frame.png",
    durationSec: 5,
    motionPrompt: "The lamplight flickers while dust slowly drifts.",
    negativePrompt: "text, logos",
    maxCostUsd: 0.4,
    runId: "run-h3-i2v",
    keyPrefix: "owners/o/channels/c",
  });

  assert.equal(h3Calls.length, 1, "the active I2V primitive must dispatch exactly one H3 take");
  const request = h3Calls[0]!;
  assert.equal(request.provider, "novita");
  assert.equal(request.execution, "on-demand");
  assert.deepEqual(request.firstFrame, {
    r2Key: "owners/o/channels/c/accepted-first-frame.png",
    sha256: sha256BytesHex(firstFrame),
  }, "the exact immutable first-frame key and digest must bind the H3 request");
  assert.match((request.output as { r2Key: string }).r2Key, /\/minimax-h3-i2v\/clip-[a-f0-9]{20}\.mp4$/);
  assert.match(request.prompt as string, /lamplight flickers/i);
  assert.match(request.prompt as string, /Avoid: text, logos/i);
  assert.equal(result.jobId, "h3-job-1");
  assert.equal(result.model, "minimax-h3-turbo8-5090/v1");
  assert.equal(result.costUsd, 0.19);
  assert.deepEqual(result.outputBytes, Buffer.from("validated-h3-take"));
  assert.match(result.url, /^https:\/\/r2\.example\.test\/owners\/o\/channels\/c\/runs\/run-h3-i2v\/minimax-h3-i2v\//);

  await assert.rejects(
    generateI2V({
      prompt: "A moonlit archive slowly reveals its hidden ledger.",
      imageKey: "owners/o/channels/c/accepted-first-frame.png",
      endImageKey: "owners/o/channels/c/old-terminal-frame.png",
      maxCostUsd: 0.4,
    }),
    /retired video path/i,
    "a legacy terminal-frame request must fail before H3 dispatch",
  );
  assert.equal(h3Calls.length, 1, "legacy controls must not spend on a replacement H3 render");

  console.log("I2V MiniMax H3 runtime contract passed");
}

main().finally(() => {
  loader._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
