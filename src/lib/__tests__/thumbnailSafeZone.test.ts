import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT,
  resolveGoldenThumbnailTextZone,
} from "@/lib/thumbnailSafeZone";
import { renderThumbnail } from "@/lib/thumbnailRenderer";

const WIDTH = 160;
const HEIGHT = 90;

function lumaFrame(pixel: (x: number, y: number) => number): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      frame[y * WIDTH + x] = pixel(x, y);
    }
  }
  return frame;
}

function ppm(pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const header = Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, "ascii");
  const body = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [red, green, blue] = pixel(x, y);
      const index = (y * WIDTH + x) * 3;
      body[index] = red;
      body[index + 1] = green;
      body[index + 2] = blue;
    }
  }
  return Buffer.concat([header, body]);
}

function jpegHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(23);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08]);
  bytes.writeUInt16BE(height, 13);
  bytes.writeUInt16BE(width, 15);
  bytes.set([0x01, 0x01, 0x11, 0x00, 0xff, 0xd9], 17);
  return bytes;
}

function assertPureZoneResolution(): void {
  const brightLeft = resolveGoldenThumbnailTextZone({
    luma: lumaFrame((x) => x < WIDTH / 2 ? 238 : 24),
    width: WIDTH,
    height: HEIGHT,
    requestedZone: "left",
  });
  assert.equal(brightLeft.resolvedZone, "right");
  assert.equal(brightLeft.changed, true);
  assert.equal(brightLeft.reason, "safer-negative-space");
  assert.ok(brightLeft.riskImprovement >= 0.16);

  const occupiedUpperLeft = resolveGoldenThumbnailTextZone({
    luma: lumaFrame((x, y) => {
      if (x < WIDTH / 2 && y < HEIGHT * 0.6) return (x + y) % 2 ? 235 : 8;
      if (x >= WIDTH / 2 && y < HEIGHT * 0.58) return 22;
      return 145;
    }),
    width: WIDTH,
    height: HEIGHT,
    requestedZone: "upperLeft",
  });
  assert.equal(occupiedUpperLeft.resolvedZone, "upperRight");
  assert.equal(occupiedUpperLeft.changed, true);
  const requestedEvidence = occupiedUpperLeft.regions.find(({ zone }) => zone === "upperLeft");
  const resolvedEvidence = occupiedUpperLeft.regions.find(({ zone }) => zone === "upperRight");
  assert.ok((requestedEvidence?.occupancy ?? 0) > (resolvedEvidence?.occupancy ?? 1) + 0.18);

  const nearlyEven = resolveGoldenThumbnailTextZone({
    luma: lumaFrame((x) => x < WIDTH / 2 ? 92 : 78),
    width: WIDTH,
    height: HEIGHT,
    requestedZone: "left",
  });
  assert.equal(nearlyEven.resolvedZone, "left", "small improvements must not move typography");
  assert.equal(nearlyEven.changed, false);
  assert.equal(nearlyEven.riskImprovement, 0);

  const center = resolveGoldenThumbnailTextZone({
    luma: lumaFrame(() => 20),
    width: WIDTH,
    height: HEIGHT,
    requestedZone: "center",
  });
  assert.equal(center.resolvedZone, "center");
  assert.equal(center.reason, "unsupported-requested-zone");
  assert.equal(center.regions.length, 4);

  assert.throws(
    () => resolveGoldenThumbnailTextZone({
      luma: new Uint8Array(2),
      width: WIDTH,
      height: HEIGHT,
      requestedZone: "left",
    }),
    /luma length mismatch/,
  );
}

async function assertRendererUsesResolvedZone(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "thumbnail-safe-zone-"));
  try {
    const positions: string[] = [];
    const result = await renderThumbnail({
      spec: {
        scene: {
          description: "A marble philosopher against a quiet shadow field",
          textZone: "left",
        },
        typography: {
          lines: [{ text: "STAY QUIET", payoff: true }],
        },
      },
      outJpg: join(directory, "final.jpg"),
      tmpDir: directory,
      generateScene: async () => ppm((x) =>
        x < WIDTH / 2 ? [240, 240, 240] : [18, 18, 18]
      ),
      compositeTypography: async (args) => {
        positions.push(args.position);
        await writeFile(args.outJpg, jpegHeader(1_280, 720));
        return args.outJpg;
      },
    });

    assert.equal(result.requestedTextZone, "left");
    assert.equal(result.resolvedTextZone, "right");
    assert.equal(result.zoneResolution.contract, GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT);
    assert.deepEqual(positions, ["right"], "local typography must use the resolved safe zone");
    assert.equal(result.baseSource, "generated");
    assert.equal(result.request?.allowText, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assertPureZoneResolution();
  await assertRendererUsesResolvedZone();
  console.log("THUMBNAIL SAFE-ZONE PASS");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
