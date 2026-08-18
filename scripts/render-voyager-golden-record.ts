import { mkdir } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  const output = process.env.OUT_PATH ?? path.join(
    process.cwd(),
    "output",
    "documotion",
    "voyager-golden-record-original-15s-visual.mp4",
  );
  await mkdir(path.dirname(output), { recursive: true });

  const [{ bundle }, { ensureBrowser, renderMedia, selectComposition }] = await Promise.all([
    import("@remotion/bundler"),
    import("@remotion/renderer"),
  ]);
  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: path.join(process.cwd(), "src/remotion/index.ts") });
  const composition = await selectComposition({
    serveUrl,
    id: "VoyagerGoldenRecordShort",
    inputProps: {},
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps: {},
    codec: "h264",
    outputLocation: output,
    concurrency: 3,
    chromiumOptions: { gl: "angle" },
    timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => {
      const percent = Math.round(progress * 100);
      if (percent % 10 === 0) console.log(`voyager render ${percent}%`);
    },
  });
  console.log(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
