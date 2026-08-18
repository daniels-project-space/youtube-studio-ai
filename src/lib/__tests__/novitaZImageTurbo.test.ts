import assert from "node:assert/strict";
import { generateNovitaZImageTurbo, novitaZImageTurboSize } from "@/lib/novitaZImageTurbo";

async function main() {
  assert.equal(novitaZImageTurboSize("9:16"), "864*1536");
  assert.equal(novitaZImageTurboSize("4:5"), "1024*1280");
  assert.equal(novitaZImageTurboSize("16:9"), "1536*864");

  const old = process.env.NOVITA_API_KEY;
  process.env.NOVITA_API_KEY = "test-key";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let polls = 0;
  try {
    const image = await generateNovitaZImageTurbo(
      { prompt: "A blank red envelope", aspectRatio: "9:16", seed: 42 },
      {
        fetchFn: async (input, init) => {
          calls.push({ url: String(input), init });
          if (String(input).endsWith("/z-image-turbo")) {
            return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
          }
          polls += 1;
          return new Response(
            JSON.stringify(
              polls === 1
                ? { task: { status: "TASK_STATUS_PROCESSING" } }
                : { task: { status: "TASK_STATUS_SUCCEED", images: [{ image_base64: Buffer.from("pixels").toString("base64") }] } },
            ),
            { status: 200 },
          );
        },
        sleep: async () => undefined,
      },
    );
    assert.equal(image.model, "z-image-turbo");
    assert.equal(image.taskId, "task-1");
    assert.equal(image.bytes.toString(), "pixels");
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.init?.headers && (calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
    assert.match(String(calls[0]?.init?.body), /"size":"864\*1536"/);
  } finally {
    if (old === undefined) delete process.env.NOVITA_API_KEY;
    else process.env.NOVITA_API_KEY = old;
  }
  console.log("novita z-image turbo adapter test passed");
}

void main();
