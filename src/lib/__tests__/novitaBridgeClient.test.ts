import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { generationProfile } from "@/engine/generationProfiles";
import {
  getNovitaRenderStatus,
  launchImages,
  toNovitaPhaseProfile,
} from "@/lib/novitaRenderFarm";

const TOKEN = "novita-test-token-that-is-longer-than-thirty-two-characters";
const JOB_ID = "image-0123456789abcdef0123456789abcdef";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("undefined contract value");
  return encoded;
}

async function main() {
  process.env.NOVITA_RENDER_FARM_API = "https://render.test/render";
  process.env.NOVITA_RENDER_FARM_TOKEN = TOKEN;
  const profile = toNovitaPhaseProfile(generationProfile("production"), "image");
  const originalFetch = globalThis.fetch;
  let launchBody = "";
  let launchCalls = 0;
  let statusCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://render.test/render/image") {
      launchCalls += 1;
      assert.equal(init?.method, "POST");
      launchBody = String(init?.body);
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, `Bearer ${TOKEN}`);
      assert.match(headers["x-render-timestamp"], /^\d+$/);
      assert.equal(
        headers["x-render-signature"],
        createHmac("sha256", TOKEN)
          .update(`${headers["x-render-timestamp"]}.image.${launchBody}`)
          .digest("hex"),
      );
      return Response.json({ jobId: JOB_ID });
    }
    if (url === `https://render.test/render/status?jobId=${JOB_ID}`) {
      statusCalls += 1;
      const payload = JSON.parse(launchBody) as Record<string, unknown>;
      const outputPrefix = `imagecraft/${payload.prefix}/${JOB_ID}/stills`;
      const expectedKey = `${outputPrefix}/shot-01-c01.png`;
      return Response.json({
        ok: true,
        jobId: JOB_ID,
        phase: "image",
        status: "done",
        outputs: [expectedKey],
        n_outputs: 1,
        n_jobs: 1,
        outputPrefix,
        expectedKeys: [expectedKey],
        missingKeys: [],
        failedIds: [],
        stillKeys: [expectedKey],
        profile,
        profileSha256: createHash("sha256").update(canonicalJson(profile)).digest("hex"),
        manifestSha256: "b".repeat(64),
        requestSha256: createHash("sha256").update("image\0").update(launchBody).digest("hex"),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const launch = await launchImages({
      prefix: "console/test-run",
      profile,
      shots: [{
        id: "shot-01",
        prompt: "A blacksmith working beside a glowing forge",
        cameraMove: "static",
        shotScale: "medium",
        lens: "35mm",
        seconds: 5,
        motion: "sparks rise from the anvil",
      }],
      nshard: 1,
      maxConcurrent: 1,
      jobs: "full",
    });
    assert.equal(launch.jobId, JOB_ID);
    assert.equal(launch.phase, "image");
    assert.deepEqual(launch.expectedJobIds, ["shot-01-c01"]);
    assert.equal(launchCalls, 1);

    const status = await getNovitaRenderStatus(launch.jobId);
    assert.equal(status.status, "done");
    assert.equal(status.profileSha256, launch.profileSha256);
    assert.equal(status.requestSha256, launch.requestSha256);
    assert.equal(statusCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("novita bridge client tests passed");
}

void main();
