import assert from "node:assert/strict";
import { listDoctorStageSummariesForRuns } from "../../../convex/runStages";

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const largePrompt = "do-not-transfer ".repeat(1_000);
const stageRows = [
  { runId: "run-a", block: "metadata", status: "ok", inputs: { prompt: largePrompt }, outputs: { title: "Tight title", description: largePrompt } },
  { runId: "run-a", block: "qa_visual", status: "ok", outputs: {
    qaReport: {
      thumbnail: { score: 4, privateTrace: largePrompt },
      seo: { score: 5 },
      video: { score: 6 },
      watch: { defects: [{ severity: "major", category: "motion", issue: "x".repeat(300), evidence: largePrompt }] },
      fullFrames: largePrompt,
    },
  } },
  { runId: "run-b", block: "upload_draft", status: "ok", outputs: { youtubeVideoId: "yt-123", privateReceipt: largePrompt } },
  { runId: "run-b", block: "other", status: "ok", outputs: { secret: largePrompt } },
];

const ctx = {
  auth: {
    getUserIdentity: async () => ({ subject: "owner-a", role: "owner", owner_id: "owner-a" }),
  },
  db: {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => ({ _id: id, ownerId: "owner-a" }),
    query: () => ({
      withIndex: (_index: string, callback: (query: { eq: (_field: string, value: string) => unknown }) => unknown) => {
        let runId = "";
        callback({ eq: (_field, value) => { runId = value; return {}; } });
        return { collect: async () => stageRows.filter((row) => row.runId === runId) };
      },
    }),
  },
};

async function main() {
  const result = await (listDoctorStageSummariesForRuns as unknown as Handler)._handler(ctx, {
    ownerId: "owner-a",
    runIds: ["run-a", "run-b"],
  }) as Array<{ runId: string; stages: Array<{ block: string; outputs: Record<string, unknown> }> }>;

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]?.stages[0]?.outputs, { title: "Tight title" });
  const qa = result[0]?.stages[1]?.outputs.qaReport as Record<string, unknown>;
  assert.deepEqual(qa.thumbnail, { score: 4 });
  assert.deepEqual(qa.seo, { score: 5 });
  assert.equal((((qa.watch as Record<string, unknown>).defects as Array<Record<string, string>>)[0]?.issue.length), 240);
  assert.deepEqual(result[1]?.stages[0]?.outputs, { youtubeVideoId: "yt-123" });
  assert.deepEqual(result[1]?.stages[1]?.outputs, {});
  await assert.rejects(
    (listDoctorStageSummariesForRuns as unknown as Handler)._handler(ctx, { ownerId: "owner-a", runIds: ["run-a", "run-a"] }),
    /must be unique/,
  );
  await assert.rejects(
    (listDoctorStageSummariesForRuns as unknown as Handler)._handler(ctx, { ownerId: "owner-a", runIds: Array.from({ length: 101 }, (_, index) => `run-${index}`) }),
    /at most 100 runs/,
  );
  console.log("Pipeline Doctor stage projection passed");
}

void main();
